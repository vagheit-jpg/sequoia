/**
 * SEQUOIA — SEFCON 과거 소급 스크립트 v1
 * scripts/backfill-sefcon.js
 *
 * 목적: 2006-01 ~ 2024-12 약 228개월치 SEFCON 과거 데이터를
 *       Supabase core_intelligence_snapshots 테이블에 소급 저장
 *
 * 데이터 소스 (FRED):
 *   T10Y2Y, BAMLH0A0HYM2, VIXCLS, USALOLITONOSTSAM,
 *   DRTSCILM, M2SL, UNRATE, ICSA, DTWEXBGS, DGS10,
 *   UMCSENT, DEXKOUS, INTDSRKRM193N
 * + Yahoo Finance: S&P500, NASDAQ, KOSPI
 *
 * 실행 (GitHub Actions):
 *   FRED_API_KEY=xxx SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx
 *   node scripts/backfill-sefcon.js --market ALL --start 2006-01 --end 2024-12
 */

// ── CLI 옵션
const args    = process.argv.slice(2);
const getArg  = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : def; };
const hasFlag = (flag) => args.includes(flag);

const MARKET   = getArg("--market", "ALL").toUpperCase();
const START_YM = getArg("--start",  "2000-01");
const END_YM   = getArg("--end",    "2026-04");
const DRY_RUN  = hasFlag("--dry-run");
const DELAY_MS = parseInt(getArg("--delay", "200"), 10);

// ── 환경변수
const FRED_KEY = process.env.FRED_API_KEY || "";
const SB_URL   = process.env.SUPABASE_URL || "";
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

console.log(`
╔══════════════════════════════════════════════════╗
║   SEQUOIA SEFCON 과거 소급 스크립트 v1           ║
╠══════════════════════════════════════════════════╣
║  기간  : ${START_YM} ~ ${END_YM}
║  마켓  : ${MARKET}
║  드라이런: ${DRY_RUN ? "YES (저장 안 함)" : "NO (실제 저장)"}
║  딜레이: ${DELAY_MS}ms
╚══════════════════════════════════════════════════╝
`);

if (!FRED_KEY)         { console.error("FRED_API_KEY 없음");           process.exit(1); }
if (!SB_URL || !SB_KEY){ console.error("SUPABASE_URL/SERVICE_KEY 없음"); process.exit(1); }

// ════════════════════════════════════════
// 유틸
// ════════════════════════════════════════
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const safeNum = (v, fb = null) => Number.isFinite(Number(v)) ? Number(v) : fb;
const clamp01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));

function genMonths(startYM, endYM) {
  const months = [];
  let [y, m] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

function getValueAt(series, yyyymm) {
  if (!series || !series.length) return null;
  const target = yyyymm.replace("-", "");
  const filtered = series.filter(r => String(r.date).slice(0, 6) <= target);
  return filtered.length ? filtered[filtered.length - 1].value : null;
}

// Yahoo KRW=X는 값이 역수로 올 수 있음 (USD/KRW) → 확인 후 변환
function getKrwAt(series, yyyymm) {
  const v = getValueAt(series, yyyymm);
  if (v == null) return null;
  // Yahoo KRW=X는 원/달러 직접 값 (예: 1350.5) — 1보다 크면 정상
  if (v > 100) return +v.toFixed(1);
  // 혹시 역수로 왔으면 변환
  if (v > 0 && v < 1) return +(1/v).toFixed(1);
  return null;
}

function prevNm(yyyymm, n) {
  const [y, m] = yyyymm.split("-").map(Number);
  const pm = m - n;
  const py = pm <= 0 ? y - 1 : y;
  const pmonth = pm <= 0 ? 12 + pm : pm;
  return `${py}-${String(pmonth).padStart(2, "0")}`;
}

function getYoY(series, yyyymm) {
  const curr = getValueAt(series, yyyymm);
  const prev = getValueAt(series, prevNm(yyyymm, 12));
  if (curr == null || prev == null || prev === 0) return null;
  return +((curr / prev - 1) * 100).toFixed(2);
}

// ════════════════════════════════════════
// 데이터 수집
// ════════════════════════════════════════
async function fetchFRED(seriesId, startDate, retries = 3, freq = null) {
  const freqParam = freq ? `&frequency=${freq}&aggregation_method=avg` : "";
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json` +
    `&observation_start=${startDate}&sort_order=asc${freqParam}`;
  for (let i = 0; i < retries; i++) {
    try {
      const res  = await fetch(url);
      const json = await res.json();
      if (!json?.observations) { console.warn(`  FRED ${seriesId}: ${json?.error_message||"no data"}`); return []; }
      return json.observations
        .filter(r => r.value !== "." && r.value != null)
        .map(r => ({ date: r.date.replace(/-/g,"").slice(0,6), value: parseFloat(r.value) }))
        .filter(r => r.date && !isNaN(r.value));
    } catch(e) {
      if (i < retries-1) { await sleep(1000*(i+1)); }
      else { console.warn(`  FRED ${seriesId} 실패: ${e.message}`); return []; }
    }
  }
  return [];
}

async function fetchYahooMonthly(ticker, startYear, retries = 3) {
  const p1 = Math.floor(new Date(`${startYear}-01-01`).getTime()/1000);
  const p2 = Math.floor(Date.now()/1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1mo`;
  for (let i = 0; i < retries; i++) {
    try {
      const res  = await fetch(url, { headers:{"User-Agent":"Mozilla/5.0"} });
      const json = await res.json();
      const ts     = json?.chart?.result?.[0]?.timestamp || [];
      const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      return ts.map((t,i) => ({ date: new Date(t*1000).toISOString().slice(0,7).replace("-",""), value: closes[i]??null }))
               .filter(r => r.value != null && !isNaN(r.value));
    } catch(e) {
      if (i < retries-1) { await sleep(1000*(i+1)); }
      else { console.warn(`  Yahoo ${ticker} 실패: ${e.message}`); return []; }
    }
  }
  return [];
}

// ════════════════════════════════════════
// SEFCON 계산 (core-snapshot.js 로직 동일)
// ════════════════════════════════════════
function scoreV(v, [b2,b1,g1,g2], dir=1) {
  if (v==null) return 0;
  if (v*dir >= b2*dir) return -2;
  if (v*dir >= b1*dir) return -1;
  if (v*dir <= g2*dir) return +2;
  if (v*dir <= g1*dir) return +1;
  return 0;
}

function labelFromScore(score) {
  if (score<=30) return { defcon:1, label:"SEFCON 1 붕괴임박" };
  if (score<=45) return { defcon:2, label:"SEFCON 2 위기" };
  if (score<=58) return { defcon:3, label:"SEFCON 3 경계" };
  if (score<=72) return { defcon:4, label:"SEFCON 4 관망" };
  return           { defcon:5, label:"SEFCON 5 안정" };
}

const US_PROFILE = { 신용위험:0.25, 유동성:0.18, 시장공포:0.22, 실물경기:0.17, 밸류버블:0.18 };
const KR_PROFILE = { 신용위험:0.28, 유동성:0.22, 시장공포:0.22, 실물경기:0.18, 물가:0.10 };

function calcCatScores(indicators, profile) {
  return Object.keys(profile).map(cat => {
    const inds = indicators.filter(i => i.cat===cat);
    if (!inds.length) return { cat, score:50, weight:profile[cat] };
    const raw  = inds.reduce((a,i) => a+i.score, 0);
    const max  = inds.length * 2;
    return { cat, score: Math.max(0, Math.min(100, Math.round((raw+max)/(max*2)*100))), weight:profile[cat] };
  });
}

function applyPenalty(score, signals, penaltyRules) {
  const cc = Object.values(signals).filter(Boolean).length;
  let p = 0;
  if (cc>=2) p+=penaltyRules.p2||0;
  if (cc>=3) p+=penaltyRules.p3||0;
  if (cc>=4) p+=penaltyRules.p4||0;
  if (cc>=5) p+=penaltyRules.p5||0;
  (penaltyRules.combos||[]).forEach(([a,b,extra]) => { if(signals[a]&&signals[b]) p+=extra; });
  return Math.max(0, Math.min(100, score - Math.min(35, p)));
}

function calcUSScore(s) {
  const inds = [
    { cat:"신용위험", score: scoreV(s.t10y2y,[-1.0,-0.5,0.5,1.0],-1)*2 },
    { cat:"신용위험", score: Math.round(scoreV(s.baml,[7.0,5.0,3.5,2.5],1)*1.5) },
    { cat:"신용위험", score: scoreV(s.sloos,[50,20,-5,-20],1) },
    { cat:"신용위험", score: Math.round(scoreV(s.lei,[98,99,100.5,101.5],-1)*1.5) },
    { cat:"유동성",   score: (v=>v==null?0:v<-2?-2:v<0?-1:v<=5?0:v<=10?1:0)(s.m2yoy) },
    { cat:"유동성",   score: scoreV(s.dxy,[128,122,115,108],1) },
    { cat:"유동성",   score: scoreV(s.tnx,[5.0,4.5,3.0,2.0],1) },
    { cat:"시장공포", score: scoreV(s.vix,[35,25,18,13],1) },
    { cat:"시장공포", score: scoreV(s.umcs,[55,65,80,90],-1) },
    { cat:"시장공포", score: 0 },
    { cat:"실물경기", score: scoreV(s.unrate,[5.5,4.5,3.8,3.0],1) },
    { cat:"실물경기", score: scoreV(s.icsa,[300,250,210,180],1) },
    { cat:"실물경기", score: s.sp_trend3m==null?0:s.sp_trend3m<-15?-2:s.sp_trend3m<-8?-1:s.sp_trend3m>15?2:s.sp_trend3m>5?1:0 },
    { cat:"밸류버블", score: s.nq_trend12m==null?0:s.nq_trend12m>40?-2:s.nq_trend12m>20?-1:s.nq_trend12m<-25?2:s.nq_trend12m<-12?1:0 },
    { cat:"밸류버블", score: 0 },
  ];
  const catScores = calcCatScores(inds, US_PROFILE);
  const raw = Math.round(catScores.reduce((a,c) => a+c.score*c.weight, 0));
  const sig = {
    vix:   safeNum(s.vix,20)>=25,   hy: safeNum(s.baml,3.5)>=5.0,
    t10:   safeNum(s.t10y2y,0)<=-0.5, sloos: safeNum(s.sloos,0)>=20,
    lei:   safeNum(s.lei,100)<=99,  dxy: safeNum(s.dxy,100)>=122,
    m2:    safeNum(s.m2yoy,0)<-2,   val: safeNum(s.nq_trend12m,0)>20,
  };
  const cc = Object.values(sig).filter(Boolean).length;
  let penalty=0;
  if(cc>=2)penalty+=3; if(cc>=3)penalty+=6; if(cc>=4)penalty+=10; if(cc>=5)penalty+=5;
  if(sig.vix&&sig.hy)penalty+=7; if(sig.t10&&sig.sloos)penalty+=6;
  if(sig.vix&&sig.hy&&sig.lei)penalty+=5; if(sig.val&&sig.vix)penalty+=5;
  if(sig.lei)penalty+=3; if(sig.val)penalty+=4;
  const final = Math.max(0, Math.min(100, raw - Math.min(35,penalty)));
  const {defcon,label} = labelFromScore(final);

  const lp = clamp01(clamp01((safeNum(s.dxy,100)-22)/8)*0.45+clamp01(safeNum(s.tnx,4)/6)*0.35+clamp01(1-(catScores.find(c=>c.cat==="유동성")?.score??50)/100)*0.20);
  const cs = clamp01(clamp01((safeNum(s.baml,3.5)-2.5)/8)*0.60+clamp01(safeNum(s.sloos,0)/50)*0.40);
  const vg = clamp01(clamp01(safeNum(s.tnx,4)/6)*0.40+clamp01((safeNum(s.baml,3.5)-0.8)/4.2)*0.30+clamp01(Math.max(0,safeNum(s.nq_trend12m,0))/50)*0.30);

  return { sefcon_score:final, sefcon_level:defcon, sefcon_label:label, catScores, penalty, clusterCount:cc,
           physics:{ liquidityPressure:+lp.toFixed(3), creditStress:+cs.toFixed(3), valuationGravity:+vg.toFixed(3) } };
}

function calcKoreaScore(s) {
  const inds = [
    { cat:"신용위험", score: scoreV(s.t10y2y,[-1.0,-0.5,0.5,1.0],-1)*2 },
    { cat:"신용위험", score: Math.round(scoreV(s.baml,[7.0,5.0,3.5,2.5],1)*1.5) },
    { cat:"신용위험", score: Math.round(scoreV(s.lei,[98,99,100.5,101.5],-1)*1.5) },
    { cat:"유동성",   score: scoreV(s.dxy,[130,125,115,108],1) },
    { cat:"유동성",   score: scoreV(s.krw_usd,[1450,1350,1200,1100],1) },
    { cat:"유동성",   score: (v=>v==null?0:v<-2?-2:v<0?-1:v<=5?0:1)(s.m2yoy) },
    { cat:"시장공포", score: scoreV(s.vix,[35,25,18,13],1) },
    { cat:"시장공포", score: s.kospi_trend==null?0:s.kospi_trend<-20?-2:s.kospi_trend<-10?-1:s.kospi_trend>20?2:s.kospi_trend>10?1:0 },
    { cat:"실물경기", score: Math.round(scoreV(s.lei,[98,99,100.5,101.5],-1)*1.5) },
    { cat:"물가",     score: scoreV(s.kr_rate,[3.5,3.0,1.5,0.5],1) },
  ];
  const catScores = calcCatScores(inds, KR_PROFILE);
  const raw = Math.round(catScores.reduce((a,c) => a+c.score*c.weight, 0));
  const sig = {
    vix: safeNum(s.vix,20)>=25,    hy: safeNum(s.baml,3.5)>=5.0,
    t10: safeNum(s.t10y2y,0)<=-0.5, dxy: safeNum(s.dxy,100)>=122,
    krw: safeNum(s.krw_usd,1200)>=1350, lei: safeNum(s.lei,100)<=99,
  };
  const cc = Object.values(sig).filter(Boolean).length;
  let penalty=0;
  if(cc>=2)penalty+=4; if(cc>=3)penalty+=8; if(cc>=4)penalty+=12;
  if(sig.vix&&sig.hy)penalty+=7; if(sig.dxy&&sig.krw)penalty+=6;
  const final = Math.max(0, Math.min(100, raw - Math.min(35,penalty)));
  const {defcon,label} = labelFromScore(final);

  // Physics 계산 (한국 기준)
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const safeN = (v, d) => (v == null || isNaN(Number(v))) ? d : Number(v);
  const lp = clamp01(
    clamp01((safeN(s.dxy,100) - 100) / 30) * 0.40 +
    clamp01((safeN(s.krw_usd,1200) - 1100) / 400) * 0.35 +
    clamp01(Math.max(0, -safeN(s.m2yoy,3)) / 5) * 0.25
  );
  const cs = clamp01(
    clamp01((safeN(s.baml,3.5) - 2.5) / 8) * 0.55 +
    clamp01(Math.max(0, -safeN(s.t10y2y,0)) / 2) * 0.45
  );
  const vg = clamp01(
    clamp01(safeN(s.kr_rate,2) / 5) * 0.50 +
    clamp01((safeN(s.baml,3.5) - 0.8) / 4.2) * 0.30 +
    clamp01(Math.max(0, safeN(s.nq_trend12m,0)) / 50) * 0.20
  );
  const physics = {
    liquidityPressure: +lp.toFixed(3),
    creditStress:      +cs.toFixed(3),
    valuationGravity:  +vg.toFixed(3),
  };

  return { sefcon_score:final, sefcon_level:defcon, sefcon_label:label, catScores, physics };
}

// ════════════════════════════════════════
// Supabase upsert
// ════════════════════════════════════════
async function upsertSnapshot(snap) {
  if (DRY_RUN) return true;
  const res = await fetch(
    `${SB_URL}/rest/v1/core_intelligence_snapshots?on_conflict=snapshot_date,market`,
    { method:"POST",
      headers:{ apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, "Content-Type":"application/json", "Prefer":"resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(snap) }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text().catch(()=>"")}`);
  return true;
}

// ════════════════════════════════════════
// 메인
// ════════════════════════════════════════
async function main() {
  console.log("FRED + Yahoo 데이터 수집 중...\n");

  const [t10y2yS,baamlS,vixS,leiS,sloosS,m2S,unreateS,icsaS,dxyS,tnxS,umcsS,sp500S,nasdaqS,kospiS] =
    await Promise.all([
      // 일별→월별 집계(avg)로 요청 → 건수 줄여서 rate limit 회피
      fetchFRED("T10Y2Y",           "1999-01-01", 3, "m").then(d=>{console.log(`  T10Y2Y   : ${d.length}건`);return d;}),
      fetchFRED("BAMLH0A0HYM2",    "1999-01-01", 3).then(d=>{console.log(`  BAML(HY) : ${d.length}건`);return d;}),
      fetchFRED("VIXCLS",           "1999-01-01", 3, "m").then(d=>{console.log(`  VIX      : ${d.length}건`);return d;}),
      fetchFRED("USALOLITONOSTSAM", "1999-01-01", 3, "m").then(d=>{console.log(`  LEI      : ${d.length}건`);return d;}),
      fetchFRED("DRTSCILM",         "1999-01-01", 3, "q").then(d=>{console.log(`  SLOOS    : ${d.length}건`);return d;}),
      fetchFRED("M2SL",             "1999-01-01", 3, "m").then(d=>{console.log(`  M2       : ${d.length}건`);return d;}),
      fetchFRED("UNRATE",           "1999-01-01", 3, "m").then(d=>{console.log(`  UNRATE   : ${d.length}건`);return d;}),
      fetchFRED("ICSA",             "1999-01-01", 3, "m").then(d=>{console.log(`  ICSA     : ${d.length}건`);return d;}),
      fetchFRED("DTWEXBGS",         "1999-01-01", 3, "m").then(d=>{console.log(`  DXY      : ${d.length}건`);return d;}),
      fetchFRED("DGS10",            "1999-01-01", 3, "m").then(d=>{console.log(`  TNX(10Y) : ${d.length}건`);return d;}),
      fetchFRED("UMCSENT",          "1999-01-01", 3, "m").then(d=>{console.log(`  UMCS     : ${d.length}건`);return d;}),
      fetchYahooMonthly("^GSPC",  2000).then(d=>{console.log(`  S&P500   : ${d.length}건`);return d;}),
      fetchYahooMonthly("^IXIC",  2000).then(d=>{console.log(`  NASDAQ   : ${d.length}건`);return d;}),
      fetchYahooMonthly("^KS11",  2000).then(d=>{console.log(`  KOSPI    : ${d.length}건`);return d;}),
    ]);

  await sleep(600);
  // FRED DEXKOUS 대신 Yahoo Finance KRW=X 사용 (FRED 간헐적 500 에러 회피)
  const krwS  = await fetchYahooMonthly("KRW=X", 2000); console.log(`  KRW/USD  : ${krwS.length}건`);
  await sleep(400);
  const krRS  = await fetchFRED("INTDSRKRM193N",  "1999-01-01", 3, "m"); console.log(`  한국금리 : ${krRS.length}건`);

  console.log("\n수집 완료. 월별 스냅샷 생성 시작...\n");

  const months    = genMonths(START_YM, END_YM);
  const mktsCount = MARKET==="ALL" ? 3 : 1;
  const total     = months.length * mktsCount;
  let saved=0, errors=0;

  for (const ym of months) {
    try {
      const s = {
        t10y2y:     getValueAt(t10y2yS, ym),
        baml:       getValueAt(baamlS,  ym),
        vix:        getValueAt(vixS,    ym),
        lei:        getValueAt(leiS,    ym),
        sloos:      getValueAt(sloosS,  ym),
        m2yoy:      getYoY(m2S,         ym),
        unrate:     getValueAt(unreateS,ym),
        icsa:       getValueAt(icsaS,   ym),
        dxy:        getValueAt(dxyS,    ym),
        tnx:        getValueAt(tnxS,    ym),
        umcs:       getValueAt(umcsS,   ym),
        krw_usd:    getKrwAt(krwS,      ym),
        kr_rate:    getValueAt(krRS,    ym),
        sp_trend3m: (() => { const n=getValueAt(sp500S,ym); const p=getValueAt(sp500S,prevNm(ym,3)); return n&&p?+((n/p-1)*100).toFixed(1):null; })(),
        nq_trend12m:(() => { const n=getValueAt(nasdaqS,ym); const p=getValueAt(nasdaqS,prevNm(ym,12)); return n&&p?+((n/p-1)*100).toFixed(1):null; })(),
        kospi_trend:  (() => { const n=getValueAt(kospiS,ym); const p=getValueAt(kospiS,prevNm(ym,12)); return n&&p?+((n/p-1)*100).toFixed(1):null; })(),
        kospi_trend3m:(() => { const n=getValueAt(kospiS,ym); const p=getValueAt(kospiS,prevNm(ym,3));  return n&&p?+((n/p-1)*100).toFixed(1):null; })(),
        krw_trend3m:  (() => { const n=getKrwAt(krwS,ym);   const p=getKrwAt(krwS,prevNm(ym,3));    return n&&p?+((n/p-1)*100).toFixed(1):null; })(),
        sp500_last:   getValueAt(sp500S, ym),
        kospi_last:   getValueAt(kospiS, ym),
      };

      const snapshotDate = `${ym}-01`;
      const now = new Date().toISOString();
      const us  = calcUSScore(s);
      const kr  = calcKoreaScore(s);

      if (MARKET==="ALL"||MARKET==="US") {
        await upsertSnapshot({
          snapshot_date: snapshotDate, market:"US",
          sefcon_score: us.sefcon_score, sefcon_level: us.sefcon_level,
          state_json:    { sefconScore:us.sefcon_score, sefconLevel:us.sefcon_level, catScores:us.catScores, backfill:true },
          temporal_json: { t10y2y:s.t10y2y, vix:s.vix, dxy:s.dxy, m2yoy:s.m2yoy },
          physics_json:  us.physics,
          regime_json:   { primaryLabel:us.sefcon_label, direction:"소급", backfill:true },
          interpretation:`[소급] 미국 SEFCON ${us.sefcon_level}단계 (${us.sefcon_score}점) — ${ym}`,
          strategy_json: { cashBias:us.sefcon_level<=2?60:us.sefcon_level===3?35:15, backfill:true },
          key_indicators:{ sefcon_score:us.sefcon_score, sefcon_level:us.sefcon_level,
            fred_t10y2y:s.t10y2y, fred_hy:s.baml, fred_vix:s.vix, fred_lei:s.lei,
            fred_sloos:s.sloos, us_m2_yoy:s.m2yoy, dxy:s.dxy, us_10y:s.tnx,
            us_unrate:s.unrate, sp500_last:s.sp500_last, nq_trend_12m:s.nq_trend12m,
            sp_trend3m:s.sp_trend3m, liquidity_pressure:us.physics.liquidityPressure,
            credit_stress:us.physics.creditStress, valuation_gravity:us.physics.valuationGravity,
            c_index_penalty:us.penalty, c_index_clusters:us.clusterCount },
          updated_at: now,
        });
        saved++;
      }

      if (MARKET==="ALL"||MARKET==="KOREA") {
        await upsertSnapshot({
          snapshot_date: snapshotDate, market:"KOREA",
          sefcon_score: kr.sefcon_score, sefcon_level: kr.sefcon_level,
          state_json:    { sefconScore:kr.sefcon_score, sefconLevel:kr.sefcon_level, catScores:kr.catScores, backfill:true },
          temporal_json: { t10y2y:s.t10y2y, vix:s.vix, dxy:s.dxy, krw_usd:s.krw_usd },
          physics_json:  {},
          regime_json:   { primaryLabel:kr.sefcon_label, direction:"소급", backfill:true },
          interpretation:`[소급] 한국 SEFCON ${kr.sefcon_level}단계 (${kr.sefcon_score}점) — ${ym}`,
          strategy_json: { cashBias:kr.sefcon_level<=2?60:kr.sefcon_level===3?35:15, backfill:true },
          key_indicators:{
            // SEFCON
            sefcon_score:    kr.sefcon_score,
            sefcon_level:    kr.sefcon_level,
            // 글로벌 금리/신용
            fred_t10y2y:     s.t10y2y,       // 미국 장단기 금리차
            fred_vix:        s.vix,           // 공포지수
            fred_hy:         s.baml,          // 하이일드 스프레드
            fred_lei:        s.lei,           // 미국 경기선행지수
            fred_sloos:      s.sloos,         // 미국 은행 대출태도
            fred_unrate:     s.unrate,        // 미국 실업률
            fred_umcs:       s.umcs,          // 미시간 소비자심리
            us_m2_yoy:       s.m2yoy,         // 미국 M2 YoY
            // 달러/환율
            dxy:             s.dxy,           // 달러인덱스
            krw_usd:         s.krw_usd,       // 원달러 환율
            krw_trend3m:     s.krw_trend3m,   // 원달러 3개월 변화율
            // 한국
            kr_rate:         s.kr_rate,       // 한국 기준금리
            // 코스피
            kospi_last:      s.kospi_last,    // 코스피 절대값
            kospi_trend:     s.kospi_trend,   // 코스피 12개월 추세
            kospi_trend3m:   s.kospi_trend3m, // 코스피 3개월 추세
            // 글로벌 주식
            sp500_last:      s.sp500_last,    // S&P500
            sp_trend3m:      s.sp_trend3m,    // S&P500 3개월 추세
            nq_trend12m:     s.nq_trend12m,   // 나스닥 12개월 추세
            // 한국 SEFCON 카테고리별 점수
            kr_cat_scores:   kr.catScores,
            // 물리 지표 (한국 계산값)
            liquidity_pressure: kr.physics?.liquidityPressure ?? null,
            credit_stress:      kr.physics?.creditStress      ?? null,
            valuation_gravity:  kr.physics?.valuationGravity  ?? null,
          },
          updated_at: now,
        });
        saved++;
      }

      if (MARKET==="ALL"||MARKET==="GLOBAL") {
        const gs = Math.round(kr.sefcon_score*0.6 + us.sefcon_score*0.4);
        const {defcon:gl, label:gLabel} = labelFromScore(gs);
        await upsertSnapshot({
          snapshot_date: snapshotDate, market:"GLOBAL",
          sefcon_score: gs, sefcon_level: gl,
          state_json:    { sefconScore:gs, sefconLevel:gl, koreaScore:kr.sefcon_score, usScore:us.sefcon_score, backfill:true },
          temporal_json: { t10y2y:s.t10y2y, vix:s.vix, dxy:s.dxy, m2yoy:s.m2yoy, krw_usd:s.krw_usd },
          physics_json:  us.physics,
          regime_json:   { primaryLabel:gLabel, direction:"소급", backfill:true },
          interpretation:`[소급] 글로벌 SEFCON ${gl}단계 (${gs}점) — ${ym} | KR:${kr.sefcon_score} US:${us.sefcon_score}`,
          strategy_json: { cashBias:gl<=2?60:gl===3?35:15, backfill:true },
          key_indicators:{
            sefcon_score:gs, sefcon_level:gl,
            korea_sefcon_score:  kr.sefcon_score,
            us_sefcon_score:     us.sefcon_score,
            fred_t10y2y:         s.t10y2y,
            fred_vix:            s.vix,
            fred_hy:             s.baml,
            fred_lei:            s.lei,
            fred_sloos:          s.sloos,
            fred_unrate:         s.unrate,
            fred_umcs:           s.umcs,
            us_m2_yoy:           s.m2yoy,
            dxy:                 s.dxy,
            krw_usd:             s.krw_usd,
            krw_trend3m:         s.krw_trend3m,
            kr_rate:             s.kr_rate,
            kospi_last:          s.kospi_last,
            kospi_trend:         s.kospi_trend,
            kospi_trend3m:       s.kospi_trend3m,
            sp500_last:          s.sp500_last,
            sp_trend3m:          s.sp_trend3m,
            nq_trend12m:         s.nq_trend12m,
            liquidity_pressure:  us.physics.liquidityPressure,
            credit_stress:       us.physics.creditStress,
            valuation_gravity:   us.physics.valuationGravity,
            kr_liquidity_pressure: kr.physics?.liquidityPressure ?? null,
            kr_credit_stress:      kr.physics?.creditStress      ?? null,
          },
          updated_at: now,
        });
        saved++;
      }

      process.stdout.write(
        `\r  ${ym} | KR:${String(kr.sefcon_score).padStart(3)}점 L${kr.sefcon_level} | US:${String(us.sefcon_score).padStart(3)}점 L${us.sefcon_level} | 저장:${saved}/${total}`
      );
      await sleep(DELAY_MS);

    } catch(e) {
      errors++;
      console.error(`\n  ${ym} 오류: ${e.message}`);
    }
  }

  console.log(`\n\n${"=".repeat(55)}`);
  console.log(`소급 완료!`);
  console.log(`  저장 성공 : ${saved}건`);
  console.log(`  오류      : ${errors}건`);
  if (DRY_RUN) console.log(`  드라이런 — 실제 저장 없음`);
  console.log(`  자비스 AI 가동 준비 완료`);
  console.log(`${"=".repeat(55)}`);
}

main().catch(e => { console.error("\nFatal:", e.message); process.exit(1); });
