/**
 * api/price.js — Yahoo Finance 주가 중계
 * GET /api/price?ticker=005930
 * 한국 주식: .KS (KOSPI) / .KQ (KOSDAQ) 자동 판별
 * 10년치 월봉 한 번에 수신 — adjclose 사용으로 액면분할 소급 보정
 */

function getYahooTicker(ticker, market) {
  if (market === "KQ") return `${ticker}.KQ`;
  return `${ticker}.KS`;
}


async function fetchKISAccessToken() {
  const appKey = process.env.KIS_APP_KEY || process.env.KIS_APPKEY || process.env.KOREA_INVESTMENT_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET || process.env.KIS_APPSECRET || process.env.KOREA_INVESTMENT_APP_SECRET;
  if (!appKey || !appSecret) return null;

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
  return { accessToken: tokenJson.access_token, appKey, appSecret };
}

async function fetchKISMarketCap(ticker) {
  const auth = await fetchKISAccessToken();
  if (!auth) return null;

  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/search-stock-info?PRDT_TYPE_CD=300&PDNO=${ticker}`;
  const r = await fetch(url, {
    headers: {
      "authorization": `Bearer ${auth.accessToken}`,
      "appkey": auth.appKey,
      "appsecret": auth.appSecret,
      "tr_id": "CTPF1002R",
      "custtype": "P",
    },
  });
  if (!r.ok) throw new Error(`KIS marketCap ${r.status}`);
  const json = await r.json();
  const out = json?.output || {};

  const shares = Number(String(out.lstg_stqt || out.lstg_st_cnt || "0").replace(/,/g, ""));
  const htsAvls = Number(String(out.hts_avls || "0").replace(/,/g, ""));

  // KIS hts_avls는 보통 억원 단위 시가총액입니다.
  const marketCapWon = htsAvls > 0 ? htsAvls * 100000000 : 0;

  return {
    shares: Number.isFinite(shares) && shares > 0 ? shares : null,
    marketCapWon: Number.isFinite(marketCapWon) && marketCapWon > 0 ? marketCapWon : null,
    marketCap: Number.isFinite(marketCapWon) && marketCapWon > 0 ? marketCapWon : null,
    kisRaw: out,
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
  // adjclose: 액면분할·배당 소급 보정된 수정주가 — 분할 종목 차트 연속성 보장
  const adjCloses  = result.indicators?.adjclose?.[0]?.adjclose || [];
  const closes     = quotes.close  || [];
  const opens      = quotes.open   || [];
  const highs      = quotes.high   || [];
  const lows       = quotes.low    || [];
  const vols       = quotes.volume || [];

  // 분할 비율 계산용: adjclose / close 비율로 open/high/low도 보정
  const monthly = [];
  for (let i = 0; i < timestamps.length; i++) {
    const rawClose = closes[i];
    const adjClose = adjCloses[i] || rawClose;
    if (!adjClose || isNaN(adjClose)) continue;

    // open/high/low도 같은 비율로 보정
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
      // 자동 판별: KS 먼저, 실패 시 KQ
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

    // 현재가는 실제 시장가 (adjclose 아님 — 분할 후 실제 호가 기준)
    const meta         = result.meta || {};
    const currentPrice = Math.round(meta.regularMarketPrice || monthly[monthly.length - 1].price);
    const prevClose    = Math.round(meta.previousClose || meta.chartPreviousClose || 0);
    const change       = currentPrice - prevClose;
    const changePct    = prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : null;

    const now = new Date();
    const priceDateStr = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,"0")}.${String(now.getDate()).padStart(2,"0")} 기준`;

    // 장중(9~16시 KST) 1분, 그 외 1시간 캐시
    const kstHour = (now.getUTCHours() + 9) % 24;
    res.setHeader("Cache-Control",
      (kstHour >= 9 && kstHour < 16)
        ? "s-maxage=60, stale-while-revalidate=30"
        : "s-maxage=3600, stale-while-revalidate=300"
    );

    const kisMarket = await fetchKISMarketCap(ticker).catch((e) => {
      console.warn("[api/price] KIS market cap fallback:", e?.message || e);
      return null;
    });

    return res.status(200).json({
      monthly,
      currentPrice,
      prevClose,
      change,
      changePct,
      priceDateStr,
      source: kisMarket?.marketCapWon ? "yahoo+kis" : "yahoo",
      yahooTicker: usedTicker,
      marketCapWon: kisMarket?.marketCapWon || null,
      marketCap: kisMarket?.marketCapWon || null,
      shares: kisMarket?.shares || null,
    });

  } catch (err) {
    console.error("[api/price] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
