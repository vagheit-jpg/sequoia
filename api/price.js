/**
 * api/price.js — Yahoo Finance 주가 + Naver 시가총액 중계
 * GET /api/price?ticker=005930
 * 한국 주식: .KS (KOSPI) / .KQ (KOSDAQ) 자동 판별
 * 10년치 월봉 한 번에 수신 — adjclose 사용으로 액면분할 소급 보정
 *
 * 시가총액:
 * - Naver Finance _market_sum 파싱
 * - 조/억원 문자열 자동 변환
 *
 * 중요:
 * - 삼성전자·SK하이닉스처럼 1000조를 넘는 초대형주는 정상값입니다.
 * - 시가총액 상한 cap을 두지 않습니다.
 * - 숫자가 양수이면 표시하고, 실패 시에만 null 처리합니다.
 */

function getYahooTicker(ticker, market) {
  if (market === "KQ") return `${ticker}.KQ`;
  return `${ticker}.KS`;
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseKoreanMarketCapToWon(raw) {
  if (raw == null) return null;

  const s = String(raw)
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return null;

  // 예:
  // "1,669조 2,345억원"
  // "1,669조"
  // "4,451,783억원"

  const joMatch = s.match(/([0-9,]+(?:\.\d+)?)\s*조/);
  const eokMatch = s.match(/([0-9,]+(?:\.\d+)?)\s*억/);

  let won = 0;

  if (joMatch) {
    won += toNumber(joMatch[1]) * 1_000_000_000_000;

    if (eokMatch) {
      won += toNumber(eokMatch[1]) * 100_000_000;
    }

  } else if (eokMatch) {
    won += toNumber(eokMatch[1]) * 100_000_000;

  } else {
    // _market_sum 값은 대개 '억원' 단위 숫자
    const n = toNumber(s);

    if (n > 0) {
      won = n * 100_000_000;
    }
  }

  return Number.isFinite(won) && won > 0
    ? Math.round(won)
    : null;
}

async function fetchNaverMarketCap(ticker) {
  const url = `https://finance.naver.com/item/main.naver?code=${ticker}`;

  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",

      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

      "Accept-Language":
        "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",

      "Referer":
        "https://finance.naver.com/",
    },
  });

  if (!r.ok) {
    throw new Error(`Naver marketCap ${r.status}`);
  }

  const html = await r.text();

  let raw = null;

  // 1순위: _market_sum 영역
  const idMatch = html.match(
    /id=["']_market_sum["'][^>]*>\s*([^<]+)\s*</i
  );

  if (idMatch) {
    raw = idMatch[1];
  }

  // 2순위: 시가총액 문자열 전체 탐색
  if (!raw) {
    const compact = html.replace(/\s+/g, " ");

    const m = compact.match(
      /시가총액[\s\S]{0,700}?([0-9,]+(?:\.\d+)?\s*조(?:\s*[0-9,]+(?:\.\d+)?\s*억원?)?|[0-9,]+(?:\.\d+)?\s*억원?)/i
    );

    if (m) {
      raw = m[1];
    }
  }

  const marketCapWon = parseKoreanMarketCapToWon(raw);

  if (!marketCapWon) {
    return null;
  }

  return {
    marketCapWon,
    marketCap: marketCapWon,
    shares: null,
    marketCapSource: "naver",
    naverRawMarketCap: raw,
  };
}

async function fetchYahoo(yahooTicker) {
  const now = Math.floor(Date.now() / 1000);
  const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}` +
    `?interval=1mo&period1=${tenYearsAgo}&period2=${now}&includePrePost=false&events=splits`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",

      "Accept": "application/json",

      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo ${yahooTicker} ${res.status}`);
  }

  const data = await res.json();

  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(`No data for ${yahooTicker}`);
  }

  return result;
}

function buildMonthly(result) {
  const timestamps = result.timestamps || result.timestamp || [];

  const quotes = result.indicators?.quote?.[0] || {};

  const adjCloses =
    result.indicators?.adjclose?.[0]?.adjclose || [];

  const closes = quotes.close || [];
  const opens = quotes.open || [];
  const highs = quotes.high || [];
  const lows = quotes.low || [];
  const vols = quotes.volume || [];

  const monthly = [];

  for (let i = 0; i < timestamps.length; i++) {
    const rawClose = closes[i];

    const adjClose = adjCloses[i] || rawClose;

    if (!adjClose || isNaN(adjClose)) {
      continue;
    }

    const ratio =
      rawClose && rawClose > 0
        ? adjClose / rawClose
        : 1;

    const adjOpen = Math.round(
      (opens[i] || rawClose) * ratio
    );

    const adjHigh = Math.round(
      (highs[i] || rawClose) * ratio
    );

    const adjLow = Math.round(
      (lows[i] || rawClose) * ratio
    );

    const d = new Date(timestamps[i] * 1000);

    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    const label =
      `${year}.${String(month).padStart(2, "0")}`;

    monthly.push({
      dt: `${year}${String(month).padStart(2, "0")}01`,
      year,
      month,
      label,

      price: Math.round(adjClose),

      open: adjOpen,
      high: adjHigh,
      low: adjLow,

      volume: Math.round(vols[i] || 0),
    });
  }

  return monthly.sort((a, b) =>
    a.dt > b.dt ? 1 : -1
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const { ticker, market } = req.query;

  if (!ticker || !/^\d{6}$/.test(ticker)) {
    return res.status(400).json({
      error: "ticker 파라미터 필요 (6자리 숫자)",
    });
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
      return res.status(404).json({
        error: "주가 데이터 없음",
      });
    }

    const meta = result.meta || {};

    const currentPrice = Math.round(
      meta.regularMarketPrice ||
      monthly[monthly.length - 1].price
    );

    const prevClose = Math.round(
      meta.previousClose ||
      meta.chartPreviousClose ||
      0
    );

    const change = currentPrice - prevClose;

    const changePct =
      prevClose > 0
        ? +((change / prevClose) * 100).toFixed(2)
        : null;

    const now = new Date();

    const priceDateStr =
      `${now.getFullYear()}.` +
      `${String(now.getMonth() + 1).padStart(2, "0")}.` +
      `${String(now.getDate()).padStart(2, "0")} 기준`;

    const kstHour = (now.getUTCHours() + 9) % 24;

    res.setHeader(
      "Cache-Control",
      (kstHour >= 9 && kstHour < 16)
        ? "s-maxage=60, stale-while-revalidate=30"
        : "s-maxage=3600, stale-while-revalidate=300"
    );

    const marketInfo =
      await fetchNaverMarketCap(ticker).catch((e) => {
        console.warn(
          "[api/price] Naver market cap fallback:",
          e?.message || e
        );

        return null;
      });

    return res.status(200).json({
      monthly,

      currentPrice,
      prevClose,
      change,
      changePct,

      priceDateStr,

      source: marketInfo?.marketCapWon
        ? "yahoo+naver"
        : "yahoo",

      yahooTicker: usedTicker,

      marketCapWon:
        marketInfo?.marketCapWon || null,

      marketCap:
        marketInfo?.marketCapWon || null,

      shares: null,

      kisSource: null,

      marketCapSource:
        marketInfo?.marketCapSource || null,

      naverRawMarketCap:
        marketInfo?.naverRawMarketCap || null,
    });

  } catch (err) {
    console.error("[api/price] error:", err.message);

    return res.status(500).json({
      error: err.message,
    });
  }
};
