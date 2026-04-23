/**
 * api/corplist.js — KRX 전종목 목록 (CommonJS)
 * GET /api/corplist
 */

const fs = require("fs");
const path = require("path");

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function fetchKRXMarket(mktId, market) {
  const body = `bld=dbms/MDC/STAT/standard/MDCSTAT01901&mktId=${mktId}&share=1&csvxls_isNo=false`;
  const res = await fetch("http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "http://data.krx.co.kr/",
      "User-Agent": "Mozilla/5.0",
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`KRX ${mktId} 실패 ${res.status}`);
  const data = await res.json();
  return (data?.OutBlock_1 || [])
    .map(item => ({
      name:   (item.ISU_ABBRV || "").trim(),
      ticker: (item.ISU_SRT_CD || "").trim(),
      market,
    }))
    .filter(s => s.name && s.ticker && /^\d{6}$/.test(s.ticker));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // 빌드타임 생성 파일 우선
    const staticPath = path.join(process.cwd(), "public", "corplist.json");
    if (fs.existsSync(staticPath)) {
      const data = JSON.parse(fs.readFileSync(staticPath, "utf-8"));
      if (data?.length > 100) {
        res.setHeader("Cache-Control", "s-maxage=86400");
        return res.status(200).json(data);
      }
    }

    // 메모리 캐시
    if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
      res.setHeader("Cache-Control", "s-maxage=3600");
      return res.status(200).json(_cache);
    }

    // KRX 실시간 fetch
    const [kospi, kosdaq] = await Promise.all([
      fetchKRXMarket("STK", "KS"),
      fetchKRXMarket("KSQ", "KQ"),
    ]);
    const all = [...kospi, ...kosdaq];
    if (all.length < 100) throw new Error("KRX 데이터 불충분");

    _cache = all;
    _cacheTime = Date.now();

    res.setHeader("Cache-Control", "s-maxage=3600");
    return res.status(200).json(all);
  } catch (err) {
    console.error("[api/corplist] error:", err.message);
    if (_cache) return res.status(200).json(_cache);
    return res.status(500).json({ error: err.message });
  }
};
