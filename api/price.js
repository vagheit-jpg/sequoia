/**
 * api/price.js  —  키움 REST API 주가 중계
 *
 * GET /api/price?ticker=005930
 *
 * 흐름:
 *  1. 토큰 발급 (POST /oauth/token) → 메모리 캐시 (23시간)
 *  2. 현재가 조회 (ka10001 주식기본정보요청)
 *  3. 월봉 조회  (ka10083 주식월봉차트조회요청) — 최대 10년치
 *  4. 정규화하여 App.jsx fetchYahoo 리턴 포맷과 동일하게 반환
 *
 * Vercel 환경변수:
 *   KIWOOM_APP_KEY    — 앱 키
 *   KIWOOM_APP_SECRET — 앱 시크릿
 */

const BASE = "https://openapi.kiwoom.com";

// ── 토큰 메모리 캐시 (Vercel 워커 재사용 시 유효)
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIWOOM_APP_KEY,
      secretkey: process.env.KIWOOM_APP_SECRET,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`토큰 발급 실패 (${res.status}): ${txt}`);
  }

  const data = await res.json();
  _token = data.token;
  // 만료 23시간으로 보수적 설정 (키움 기본 24h)
  _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return _token;
}

// ── 키움 API 공통 호출
async function kiwoomApi(trCode, body, token) {
  const res = await fetch(`${BASE}/api/dostrade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Authorization: `Bearer ${token}`,
      trnm: trCode,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${trCode} 실패 (${res.status}): ${txt}`);
  }
  return res.json();
}

// ── 날짜 문자열 "YYYYMMDD" → Date
function parseDate(s) {
  if (!s || s.length < 8) return null;
  return new Date(
    parseInt(s.slice(0, 4)),
    parseInt(s.slice(4, 6)) - 1,
    parseInt(s.slice(6, 8))
  );
}

// ── 10년 전 날짜 문자열
function tenYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 10);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// ── 오늘 날짜 문자열
function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { ticker } = req.query;
  if (!ticker || !/^\d{6}$/.test(ticker)) {
    return res.status(400).json({ error: "ticker 파라미터 필요 (6자리 숫자)" });
  }

  try {
    const token = await getToken();

    // ── 1. 현재가 조회 (ka10001)
    const basicRes = await kiwoomApi(
      "ka10001",
      { stk_cd: ticker },
      token
    );

    const basic = basicRes?.output || {};
    const currentPrice = Math.abs(parseInt(basic.cur_prc || "0"));
    const prevClose   = Math.abs(parseInt(basic.base_pric || basic.pred_pric || "0"));
    const change      = currentPrice - prevClose;
    const changePct   = prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : null;
    const priceDateStr = `${today().slice(0,4)}.${today().slice(4,6)}.${today().slice(6,8)} (장중/종가)`;

    // ── 2. 월봉 조회 (ka10083) — 연속조회로 10년치 수집
    const allCandles = [];
    let nextKey = "";
    const startDt = tenYearsAgo();
    const endDt   = today();

    for (let page = 0; page < 20; page++) {
      const body = {
        stk_cd: ticker,
        base_dt: endDt,
        mod_yn: "1",           // 수정주가 사용
      };
      if (nextKey) body.next_key = nextKey;

      const chartRes = await kiwoomApi("ka10083", body, token);
      const items = chartRes?.output2 || chartRes?.output || [];

      if (!Array.isArray(items) || items.length === 0) break;

      for (const item of items) {
        const dt = item.dt || item.stk_bsop_date || "";
        if (dt < startDt) { nextKey = ""; break; }   // 10년 이전이면 중단
        const priceRaw = Math.abs(parseInt(item.cls_prc || item.cur_prc || "0"));
        if (!priceRaw) continue;
        const d = parseDate(dt);
        if (!d) continue;
        allCandles.push({
          dt,
          year:  d.getFullYear(),
          month: d.getMonth() + 1,
          label: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`,
          price:  priceRaw,
          open:   Math.abs(parseInt(item.opn_prc  || "0")),
          high:   Math.abs(parseInt(item.high_prc || "0")),
          low:    Math.abs(parseInt(item.low_prc  || "0")),
          volume: parseInt(item.trde_qty || item.acc_trde_qty || "0"),
        });
      }

      nextKey = chartRes?.next_key || "";
      if (!nextKey) break;
    }

    // 날짜 오름차순 정렬
    allCandles.sort((a, b) => (a.dt > b.dt ? 1 : -1));

    // ── 응답 — App.jsx fetchYahoo 리턴 포맷과 동일
    const result = {
      monthly:      allCandles,
      currentPrice: currentPrice || (allCandles.length ? allCandles.at(-1).price : 0),
      prevClose,
      change,
      changePct,
      priceDateStr,
    };

    // 캐시: 장중(09~15:30 KST)은 60초, 장외는 1시간
    const kstHour = (new Date().getUTCHours() + 9) % 24;
    const isMarketHour = kstHour >= 9 && kstHour < 16;
    res.setHeader("Cache-Control", isMarketHour ? "s-maxage=60" : "s-maxage=3600");

    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/price] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
