/**
 * scripts/buildCorplist.js
 *
 * 실행: node scripts/buildCorplist.js
 * 출력: public/corplist.json  (KOSPI + KOSDAQ 전 종목)
 *
 * GitHub Actions cron (매일 08:00 KST) 또는
 * Vercel Build Command 앞에 "node scripts/buildCorplist.js &&" 로 추가
 *
 * package.json 예시:
 *   "build": "node scripts/buildCorplist.js && react-scripts build"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = path.join(__dirname, "..", "public", "corplist.json");

const KRX_URL = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

async function fetchMarket(mktId, market) {
  const body = `bld=dbms/MDC/STAT/standard/MDCSTAT01901&mktId=${mktId}&share=1&csvxls_isNo=false`;
  const res = await fetch(KRX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "http://data.krx.co.kr/",
      "User-Agent": "Mozilla/5.0 (compatible; SEQUOIA-bot/1.0)",
    },
    body,
  });
  if (!res.ok) throw new Error(`KRX ${mktId} 실패: ${res.status}`);
  const data = await res.json();
  return (data?.OutBlock_1 || [])
    .map((item) => ({
      name:   (item.ISU_ABBRV || "").trim(),
      ticker: (item.ISU_SRT_CD || "").trim(),
      market,
    }))
    .filter((s) => s.name && s.ticker && /^\d{6}$/.test(s.ticker));
}

async function main() {
  console.log("📋 KRX 전 종목 목록 다운로드 중...");
  const [kospi, kosdaq] = await Promise.all([
    fetchMarket("STK", "KS"),
    fetchMarket("KSQ", "KQ"),
  ]);
  const all = [...kospi, ...kosdaq];
  console.log(`✅ KOSPI: ${kospi.length}개 / KOSDAQ: ${kosdaq.length}개 / 합계: ${all.length}개`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(all, null, 0), "utf-8");
  console.log(`💾 저장 완료: ${OUT_PATH}`);
}

main().catch((e) => { console.error("❌ 실패:", e.message); process.exit(1); });
