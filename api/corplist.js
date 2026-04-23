/**
 * api/corplist.js — 한국투자증권 REST API 전종목 목록
 * GET /api/corplist
 * KOSPI + KOSDAQ 전종목 반환
 * 한투 API: 국내주식 기본조회 - 주식현재가 시세 (전종목)
 */

const KIS_BASE = "https://openapi.koreainvestment.com:9443";

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`토큰 발급 실패 ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("access_token 없음");
  _token = data.access_token;
  _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return _token;
}

// 한투 국내주식 전종목 조회
// tr_id: FHKST01010100 (주식현재가 시세) — 전종목 루프
// 실제 전종목 리스트 API: /uapi/domestic-stock/v1/quotations/inquire-stock-list
async function fetchAllStocks(mktDiv, mktLabel, token) {
  const stocks = [];
  let fid_input_iscd = "0000"; // 전체
  let ctxAreaFk100 = "";
  let ctxAreaNk100 = "";

  for (let page = 0; page < 30; page++) {
    const params = new URLSearchParams({
      PRDT_TYPE_CD: mktDiv,     // J=KOSPI, Q=KOSDAQ
      PDNO: "",
      CTX_AREA_FK100: ctxAreaFk100,
      CTX_AREA_NK100: ctxAreaNk100,
    });

    const res = await fetch(
      `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-stock-list?${params}`,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "appkey": process.env.KIS_APP_KEY,
          "appsecret": process.env.KIS_APP_SECRET,
          "tr_id": mktDiv === "J" ? "FHKST01010400" : "FHKST01010500",
          "custtype": "P",
        },
      }
    );

    if (!res.ok) break;
    const data = await res.json();
    if (data.rt_cd !== "0") break;

    const items = data.output || [];
    items.forEach(item => {
      const ticker = item.pdno || item.mksc_shrn_iscd || "";
      const name   = item.prdt_abrv_name || item.hts_kor_isnm || "";
      if (ticker && name && /^\d{6}$/.test(ticker)) {
        stocks.push({ ticker, name, market: mktLabel });
      }
    });

    // 다음 페이지
    ctxAreaFk100 = data.ctx_area_fk100 || "";
    ctxAreaNk100 = data.ctx_area_nk100 || "";
    if (!ctxAreaFk100 && !ctxAreaNk100) break;
    if (items.length === 0) break;
  }

  return stocks;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = await getToken();

    // KOSPI + KOSDAQ 병렬 조회
    const [kospi, kosdaq] = await Promise.all([
      fetchAllStocks("J", "KS", token),
      fetchAllStocks("Q", "KQ", token),
    ]);

    const all = [...kospi, ...kosdaq];

    if (all.length < 10) {
      throw new Error(`종목 수 부족: ${all.length}개 — API 응답 확인 필요`);
    }

    // 하루 캐시 (종목 목록은 자주 안 바뀜)
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json(all);

  } catch (err) {
    console.error("[api/corplist] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
