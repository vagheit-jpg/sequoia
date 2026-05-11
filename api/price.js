/**
 * api/price.js — Yahoo Finance 주가 + KIS 시가총액 중계
 * GET /api/price?ticker=005930
 * 한국 주식: .KS (KOSPI) / .KQ (KOSDAQ) 자동 판별
 * 10년치 월봉 한 번에 수신 — adjclose 사용으로 액면분할 소급 보정
 *
 * 시가총액은 KIS REST API에서 1순위로 가져옵니다.
 * - inquire-price: hts_avls 우선
 * - search-stock-info: hts_avls/lstg_stqt 보조
 * - 실패 시 shares × currentPrice fallback, 단 비정상 범위는 null 처리
 */

let KIS_TOKEN_CACHE = null;

function getYahooTicker(ticker, market) {
  if (market === "KQ") return `${ticker}.KQ`;
  return `${ticker}.KS`;
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeMarketCapWon(value) {
  const n = toNumber(value);
  if (!n || n <= 0) return null;

  // KIS hts_avls는 보통 억원 단위입니다. 이미 원 단위로 온 경우도 방어합니다.
  const won = n > 10_000_000_000 ? n : n * 100_000_000;

  // 한국 상장사 현실 범위 방어: 0.01조 미만 또는 1,500조 초과는 비정상으로 간주.
  if (won < 10_000_000_000 || won > 1_500 * 1_000_000_000_000) return null;
  return Math.round(won);
}

function normalizeShares(value) {
  const n = toNumber(value);
  if (!n || n <= 0) return null;
  // 보통 발행주식수는 수백만~수십억 주. 100억주 초과면 단위 오류 가능성.
  if (n < 100_000 || n > 10_000_000_000) return null;
  return Math.round(n);
}

async function fetchKISAccessToken() {
  const appKey = process.env.KIS_APP_KEY || process.env.KIS_APPKEY || process.env.KOREA_INVESTMENT_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET || process.env.KIS_APPSECRET || process.env.KOREA_INVESTMENT_APP_SECRET;
  if (!appKey || !appSecret) return null;

  if (KIS_TOKEN_CACHE?.accessToken && KIS_TOKEN_CACHE.expiresAt > Date.now() + 60_000) {
    return { accessToken: KIS_TOKEN_CACHE.accessToken, appKey, appSecret };
  }

  const tokenRes = await fetch("https://openapi.koreainvestment.com:9443/oauth2/tokenP", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  if (!tokenRes.ok) throw new Error(`KIS token ${tokenRes.status}`);
  const tokenJson = await tokenRes.json();
  if (!tokenJson?.access_token) throw new Error("KIS access_token 없음");

  const expiresIn = Number(tokenJson.expires_in || 86400);
  KIS_TOKEN_CACHE = {
    accessToken: tokenJson.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000,
  };

  return { accessToken: tokenJson.access_token, appKey, appSecret };
}

async function kisGet(url, trId) {
  const auth = await fetchKISAccessToken();
  if (!auth) return null;

  const r = await fetch(url, {
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      appkey: auth.appKey,
      appsecret: auth.appSecret,
      tr_id: trId,
      custtype: "P",
    },
  });

  if (!r.ok) throw new Error(`KIS ${trId} ${r.status}`);
  const json = await r.json();
  return json?.output || null;
}

async function fetchKISMarketCap(ticker, currentPrice) {
  const result = {
    shares: null,
    marketCapWon: null,
    marketCap: null,
    kisSource: null,
  };

  // 1순위: 국내주식 현재가 조회. hts_avls가 시가총액으로 가장 안정적입니다.
  try {
    const out = await kisGet(
      `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}`,
      "FHKST01010100"
    );
    const cap = normalizeMarketCapWon(out?.hts_avls || out?.stck_avls || out?.mktcap);
    const shares = normalizeShares(out?.lstn_stcn || out?.lstg_stqt || out?.stck_sdpr);
    if (cap) {
      result.marketCapWon = cap;
      result.marketCap = cap;
      result.shares = shares;
      result.kisSource = "inquire-price";
      return result;
    }
    if (shares) result.shares = shares;
  } catch (e) {
    console.warn("[api/price] KIS inquire-price fallback:", e?.message || e);
  }

  // 2순위: 상품기본정보. 일부 계정/환경에서는 이쪽에 hts_avls 또는 상장주식수가 들어옵니다.
  try {
    const out = await kisGet(
      `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/search-stock-info?PRDT_TYPE_CD=300&PDNO=${ticker}`,
      "CTPF1002R"
    );
    const cap = normalizeMarketCapWon(out?.hts_avls || out?.stck_avls || out?.mktcap);
    const shares = normalizeShares(out?.lstg_stqt || out?.lstg_st_cnt || out?.lstn_stcn);
    if (shares) result.shares = shares;
    if (cap) {
      result.marketCapWon = cap;
      result.marketCap = cap;
      result.kisSource = "search-stock-info";
      return result;
    }
  } catch (e) {
    console.warn("[api/price] KIS search-stock-info fallback:", e?.message || e);
  }

  // 3순위: KIS 상장주식수 × 현재가. 삼성전기 5100조 같은 오류를 막기 위해 sanity check를 강하게 적용합니다.
  if (result.shares && currentPrice > 0) {
    const fallbackCap = result.shares * currentPrice;
    if (fallbackCap >= 10_000_000_000 && fallbackCap <= 1_500 * 1_000_000_000_000) {
      result.marketCapWon = Math.round(fallbackCap);
      result.marketCap = result.marketCapWon;
      result.kisSource = "shares*price-fallback";
    }
  }

  return result.marketCapWon ? result : null;
}


async function fetchNaverMarketCap(ticker) {
  const url = `https://finance.naver.com/item/main.naver?code=${ticker}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Referer": "https://finance.naver.com/",
    },
  });
  if (!r.ok) throw new Error(`Naver marketCap ${r.status}`);
  const html = await r.text();

  // Naver 종목 페이지의 시가총액은 보통 <em id="_market_sum">... </em> 형태이며 단위는 억원입니다.
  let raw = null;
  const idMatch = html.match(/id=["']_market_sum["'][^>]*>\s*([^<]+)\s*</i);
  if (idMatch) raw = idMatch[1];

  // 구조 변경 대비: "시가총액" 주변 숫자 추출 fallback
  if (!raw) {
    const compact = html.replace(/\s+/g, " ");
    const m = compact.match(/시가총액[\s\S]{0,400}?([0-9,]+)\s*억원/i);
    if (m) raw = m[1];
  }

  const eok = toNumber(raw);
  const marketCapWon = eok > 0 ? eok * 100_000_000 : null;
  if (!marketCapWon || marketCapWon < 10_000_000_000 || marketCapWon > 1_500 * 1_000_000_000_000) return null;
  return {
    marketCapWon: Math.round(marketCapWon),
    marketCap: Math.round(marketCapWon),
    shares: null,
    marketCapSource: "naver",
  };
}

async function fetchYahoo(yahooTicker) {
  const now = Math.floor(Date.now() / 1000);
  const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}` +
    `?interval=1mo&period1=${tenYearsAgo}&period2=${now}&includePrePost=false&events=splits`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  if (!res.ok) throw new Error(`Yahoo ${yahooTicker} ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${yahooTicker}`);
  return result;
}

function buildMonthly(result) {
  const timestamps = result.timestamps || result.timestamp || [];
  const quotes     = result.indicators?.quote?.[0] || {};
  const adjCloses  = result.indicators?.adjclose?.[0]?.adjclose || [];
  const closes     = quotes.close  || [];
  const opens      = quotes.open   || [];
  const highs      = quotes.high   || [];
  const lows       = quotes.low    || [];
  const vols       = quotes.volume || [];

  const monthly = [];
  for (let i = 0; i < timestamps.length; i++) {
    const rawClose = closes[i];
    const adjClose = adjCloses[i] || rawClose;
    if (!adjClose || isNaN(adjClose)) continue;

    const ratio = (rawClose && rawClose > 0) ? adjClose / rawClose : 1;
    const adjOpen  = Math.round((opens[i]  || rawClose) * ratio);
    const adjHigh  = Math.round((highs[i]  || rawClose) * ratio);
    const adjLow   = Math.round((lows[i]   || rawClose) * ratio);

    const d = new Date(timestamps[i] * 1000);
    const year  = d.getFullYear();
    const month = d.getMonth() + 1;
    const label = `${year}.${String(month).padStart(2, "0")}`;

    monthly.push({
      dt: `${year}${String(month).padStart(2,"0")}01`,
      year, month, label,
      price:  Math.round(adjClose),
      open:   adjOpen,
      high:   adjHigh,
      low:    adjLow,
      volume: Math.round(vols[i] || 0),
    });
  }

  return monthly.sort((a, b) => a.dt > b.dt ? 1 : -1);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { ticker, market } = req.query;
  if (!ticker || !/^\d{6}$/.test(ticker)) {
    return res.status(400).json({ error: "ticker 파라미터 필요 (6자리 숫자)" });
  }

  try {
    let result = null;
    let usedTicker = "";

    if (market === "KQ") {
      usedTicker = `${ticker}.KQ`;
      result = await fetchYahoo(usedTicker);
    } else if (market === "KS") {
      usedTicker = `${ticker}.KS`;
      result = await fetchYahoo(usedTicker);
    } else {
      try {
        usedTicker = `${ticker}.KS`;
        result = await fetchYahoo(usedTicker);
      } catch {
        usedTicker = `${ticker}.KQ`;
        result = await fetchYahoo(usedTicker);
      }
    }

    const monthly = buildMonthly(result);
    if (!monthly.length) {
      return res.status(404).json({ error: "주가 데이터 없음" });
    }

    const meta         = result.meta || {};
    const currentPrice = Math.round(meta.regularMarketPrice || monthly[monthly.length - 1].price);
    const prevClose    = Math.round(meta.previousClose || meta.chartPreviousClose || 0);
    const change       = currentPrice - prevClose;
    const changePct    = prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : null;

    const now = new Date();
    const priceDateStr = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,"0")}.${String(now.getDate()).padStart(2,"0")} 기준`;

    const kstHour = (now.getUTCHours() + 9) % 24;
    res.setHeader("Cache-Control",
      (kstHour >= 9 && kstHour < 16)
        ? "s-maxage=60, stale-while-revalidate=30"
        : "s-maxage=3600, stale-while-revalidate=300"
    );

    const kisMarket = await fetchKISMarketCap(ticker, currentPrice).catch((e) => {
      console.warn("[api/price] KIS market cap fallback:", e?.message || e);
      return null;
    });

    const naverMarket = kisMarket?.marketCapWon ? null : await fetchNaverMarketCap(ticker).catch((e) => {
      console.warn("[api/price] Naver market cap fallback:", e?.message || e);
      return null;
    });

    const marketInfo = kisMarket?.marketCapWon ? kisMarket : naverMarket;

    return res.status(200).json({
      monthly,
      currentPrice,
      prevClose,
      change,
      changePct,
      priceDateStr,
      source: marketInfo?.marketCapWon ? (marketInfo.marketCapSource === "naver" ? "yahoo+naver" : "yahoo+kis") : "yahoo",
      yahooTicker: usedTicker,
      marketCapWon: marketInfo?.marketCapWon || null,
      marketCap: marketInfo?.marketCapWon || null,
      shares: marketInfo?.shares || null,
      kisSource: marketInfo?.kisSource || null,
      marketCapSource: marketInfo?.marketCapSource || marketInfo?.kisSource || null,
    });

  } catch (err) {
    console.error("[api/price] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
