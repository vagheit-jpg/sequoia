// api/corplist.js — KRX 전종목 목록 (KOSPI + KOSDAQ)
// Vercel Serverless Function

const KRX_URL = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

async function fetchMarket(mktId, market) {
  const body = `bld=dbms/MDC/STAT/standard/MDCSTAT01901&mktId=${mktId}&share=1&csvxls_isNo=false`;
  const res = await fetch(KRX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "http://data.krx.co.kr/",
      "User-Agent": "Mozilla/5.0 (compatible; SEQUOIA/1.0)",
    },
    body,
  });
  if (!res.ok) throw new Error(`KRX ${mktId} ${res.status}`);
  const data = await res.json();
  return (data?.OutBlock_1 || [])
    .map(item => ({
      name:   (item.ISU_ABBRV  || "").trim(),
      ticker: (item.ISU_SRT_CD || "").trim(),
      market,
    }))
    .filter(s => s.name && s.ticker && /^\d{6}$/.test(s.ticker));
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const [kospi, kosdaq] = await Promise.all([
      fetchMarket("STK", "KS"),
      fetchMarket("KSQ", "KQ"),
    ]);
    const all = [...kospi, ...kosdaq];
    if (all.length < 100) throw new Error(`종목 수 부족: ${all.length}`);

    // 24시간 캐시
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json(all);
  } catch (e) {
    console.error("[corplist] KRX 실패:", e.message);
    // KRX 실패 시 빈 배열 반환 → App.jsx가 FALLBACK_STOCKS 유지
    return res.status(200).json([]);
  }
}
