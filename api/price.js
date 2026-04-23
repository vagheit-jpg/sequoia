/**
 * api/price.js — 키움 REST API 주가 중계 (CommonJS)
 * GET /api/price?ticker=005930
 */

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await fetch("https://openapi.kiwoom.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIWOOM_APP_KEY,
      secretkey: process.env.KIWOOM_APP_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`토큰 발급 실패 ${res.status}`);
  const data = await res.json();
  _token = data.token;
  _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return _token;
}

async function kiwoomApi(trCode, body, token) {
  const res = await fetch("https://openapi.kiwoom.com/api/dostrade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Authorization: `Bearer ${token}`,
      trnm: trCode,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${trCode} 실패 ${res.status}`);
  return res.json();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

function tenYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 10);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

module.exports = async function handler(req, res) {
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

    const basicRes = await kiwoomApi("ka10001", { stk_cd: ticker }, token);
    const basic = basicRes?.output || {};
    const currentPrice = Math.abs(parseInt(basic.cur_prc || "0"));
    const prevClose = Math.abs(parseInt(basic.base_pric || basic.pred_pric || "0"));
    const change = currentPrice - prevClose;
    const changePct = prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : null;
    const t = today();
    const priceDateStr = `${t.slice(0,4)}.${t.slice(4,6)}.${t.slice(6,8)} (장중/종가)`;

    const allCandles = [];
    let nextKey = "";
    const startDt = tenYearsAgo();
    const endDt = today();

    for (let page = 0; page < 20; page++) {
      const body = { stk_cd: ticker, base_dt: endDt, mod_yn: "1" };
      if (nextKey) body.next_key = nextKey;
      const chartRes = await kiwoomApi("ka10083", body, token);
      const items = chartRes?.output2 || chartRes?.output || [];
      if (!Array.isArray(items) || items.length === 0) break;
      let stop = false;
      for (const item of items) {
        const dt = item.dt || item.stk_bsop_date || "";
        if (dt < startDt) { stop = true; break; }
        const priceRaw = Math.abs(parseInt(item.cls_prc || item.cur_prc || "0"));
        if (!priceRaw) continue;
        const year = parseInt(dt.slice(0,4));
        const month = parseInt(dt.slice(4,6));
        allCandles.push({
          dt, year, month,
          label: `${year}.${String(month).padStart(2,"0")}`,
          price: priceRaw,
          open:  Math.abs(parseInt(item.opn_prc  || "0")),
          high:  Math.abs(parseInt(item.high_prc || "0")),
          low:   Math.abs(parseInt(item.low_prc  || "0")),
          volume: parseInt(item.trde_qty || item.acc_trde_qty || "0"),
        });
      }
      if (stop) break;
      nextKey = chartRes?.next_key || "";
      if (!nextKey) break;
    }

    allCandles.sort((a, b) => a.dt > b.dt ? 1 : -1);

    const kstHour = (new Date().getUTCHours() + 9) % 24;
    res.setHeader("Cache-Control", (kstHour >= 9 && kstHour < 16) ? "s-maxage=60" : "s-maxage=3600");

    return res.status(200).json({
      monthly: allCandles,
      currentPrice: currentPrice || (allCandles.length ? allCandles[allCandles.length-1].price : 0),
      prevClose, change, changePct, priceDateStr,
    });
  } catch (err) {
    console.error("[api/price] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
