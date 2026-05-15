// api/macro.js — ECOS 거시경제 + Yahoo Finance 지수
const ECOS_KEY = process.env.ECOS_API_KEY || "";
const CACHE_TTL = 6 * 60 * 60 * 1000;

let cache = { data: null, ts: 0 };

// ── ECOS 호출
async function fetchECOS(statCode, itemCode, startDate, endDate, freq = "MM") {
  // ECOS 공식 URL: /StatisticSearch/{key}/json/kr/{startRow}/{endRow}/{statCode}/{freq}/{startDate}/{endDate}/{itemCode}
  // encodeURIComponent 제거 — *AA 같은 와일드카드가 %2AAA로 인코딩되면 ERROR-100 발생
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/800/${statCode}/${freq}/${startDate}/${endDate}/${itemCode}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json?.RESULT?.CODE && json.RESULT.CODE !== "INFO-000") {
    console.warn(`[ECOS] ${statCode}/${itemCode}: ${json.RESULT.MESSAGE}`);
    return [];
  }
  const rows = json?.StatisticSearch?.row || [];
return rows.map(r => ({
  date: r.TIME,
  value: parseFloat(r.DATA_VALUE),
  itemCode2: r.ITEM_CODE2,
  itemName2: r.ITEM_NAME2,
  unitName: r.UNIT_NAME,
}))
.filter(r => !isNaN(r.value));
}

// ── 날짜 정규화: FRED/ECOS/Yahoo 날짜를 YYYYMM 또는 YYYYMMDD 기준으로 안전하게 통일
function normalizeDateKey(v, mode = "month") {
  if (v == null) return null;
  const s = String(v).trim().replace(/\./g, "-");
  let y = null, m = null, d = null;

  if (/^\d{8}$/.test(s)) {
    y = s.slice(0, 4); m = s.slice(4, 6); d = s.slice(6, 8);
  } else if (/^\d{6}$/.test(s)) {
    y = s.slice(0, 4); m = s.slice(4, 6); d = "01";
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    y = s.slice(0, 4); m = s.slice(5, 7); d = s.slice(8, 10);
  } else if (/^\d{4}-\d{2}$/.test(s)) {
    y = s.slice(0, 4); m = s.slice(5, 7); d = "01";
  } else if (/^\d{4}Q[1-4]$/.test(s)) {
    y = s.slice(0, 4);
    m = String(Number(s.slice(5, 6)) * 3).padStart(2, "0");
    d = "01";
  } else {
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 6) {
      y = digits.slice(0, 4); m = digits.slice(4, 6); d = digits.slice(6, 8) || "01";
    }
  }

  if (!y || !m) return null;
  return mode === "day" ? `${y}${m}${d || "01"}` : `${y}${m}`;
}

// ── FRED 호출
const FRED_KEY = process.env.FRED_API_KEY || "";
async function fetchFRED(seriesId, startDate) {
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json` +
    `&observation_start=${startDate}&sort_order=asc`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json?.observations) {
    console.warn(`[FRED] ${seriesId}: no observations`, json?.error_message || json);
    return [];
  }
  return json.observations
    .filter(r => r.value !== "." && r.value != null)   // FRED 결측값 "." 제거
    .map(r => ({ date: normalizeDateKey(r.date, "day"), value: parseFloat(r.value) }))
    .filter(r => r.date && !Number.isNaN(r.value));
}

// ── Yahoo Finance 지수 월봉 (^KS11, ^KQ11)
async function fetchIndexMonthly(yahooTicker) {
  const now = Math.floor(Date.now() / 1000);
  const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
    `?interval=1mo&period1=${tenYearsAgo}&period2=${now}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${yahooTicker} ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${yahooTicker}`);

  const timestamps = result.timestamps || result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  return timestamps.map((ts, i) => {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return {
      date: `${y}${m}`,
      price: closes[i] ? Math.round(closes[i]) : null,
    };
  }).filter(r => r.price != null);
}

// ── Yahoo Finance VIX 월봉
async function fetchVIXMonthly() {
  const now = Math.floor(Date.now() / 1000);
  const threeYearsAgo = now - 3 * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX` +
    `?interval=1mo&period1=${threeYearsAgo}&period2=${now}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo VIX ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No VIX data");
  const timestamps = result.timestamps || result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps.map((ts, i) => {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return { date: `${y}${m}`, value: closes[i] ? +closes[i].toFixed(2) : null };
  }).filter(r => r.value != null);
}

// ── Yahoo Finance 일별 → 월별 (범용: BIZD, DXY, 구리, 금 등)
async function fetchYahooMonthly(yahooTicker, yearsBack = 5) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - yearsBack * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
    `?interval=1mo&period1=${from}&period2=${now}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${yahooTicker} ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${yahooTicker}`);
  const timestamps = result.timestamps || result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps.map((ts, i) => {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return { date: `${y}${m}`, value: closes[i] ? +closes[i].toFixed(4) : null };
  }).filter(r => r.value != null);
}

// ── 일별 → 월별 변환 (말일 값 사용)
function dailyToMonthly(arr) {
  const map = {};
  for (const r of arr || []) {
    const ym = normalizeDateKey(r.date, "month");
    if (!ym) continue;
    map[ym] = r.value; // 같은 달이면 덮어쓰기 → 마지막 값(말일)
  }
  return Object.entries(map).sort((a,b)=>a[0]>b[0]?1:-1).map(([date,value])=>({date,value}));
}

// ── YoY 계산
function calcMonthlyYoY(arr) {
  return arr.map((r, i) => {
    if (i < 12) return { ...r, yoy: null };
    const base = arr[i - 12]?.value;
    return { ...r, yoy: base ? +((r.value / base - 1) * 100).toFixed(1) : null };
  });
}

function calcQuarterlyYoY(arr) {
  return arr.map(r => {
    const prevYear = String(parseInt(r.date.slice(0, 4)) - 1) + r.date.slice(4);
    const prev = arr.find(p => p.date === prevYear);
    return { ...r, yoy: prev != null && prev.value ? +((r.value / prev.value - 1) * 100).toFixed(1) : null };
  });
}


// ══════════════════════════════════════════════════════════════
// 역사적 위기 벤치마크 — 각 위기 당시 DEFCON 지표값 (검증된 수치)
// ══════════════════════════════════════════════════════════════
const CRISIS_BENCHMARKS = [
  {
    id: "imf1997", label: "한국 IMF 외환위기", date: "1997.11",
    defcon: 1, color: "#FF1A1A",
    desc: "외환보유액 39억달러 고갈, 원달러 1,964원, IMF 구제금융 550억달러",
    cat: { 신용위험:30, 유동성:5, 시장공포:8, 실물경기:8, 물가:10 },
    impact: { kospi:-67, krw:+100, desc:"코스피 반토막 이상, 원달러 2배" },
  },
  {
    id: "dotcom2000", label: "IT 버블 붕괴", date: "2000.03",
    defcon: 2, color: "#FF6B00",
    desc: "나스닥 -78%, 금리역전, 미국 기술주 버블 붕괴 → 한국 수출 타격",
    cat: { 신용위험:28, 유동성:35, 시장공포:22, 실물경기:42, 물가:45 },
    impact: { kospi:-50, krw:+15, desc:"IT버블 연루, 코스피 -50%" },
  },
  {
    id: "gfc2008", label: "글로벌 금융위기", date: "2008.10",
    defcon: 1, color: "#FF1A1A",
    desc: "리만 붕괴, VIX 80 역대최고, Baa스프레드 4.2%p, 신용경색 전세계 확산",
    cat: { 신용위험:4, 유동성:20, 시장공포:3, 실물경기:8, 물가:25 },
    impact: { kospi:-54, krw:+35, desc:"코스피 반토막, 원달러 35% 급등" },
  },
  {
    id: "europe2011", label: "유럽 재정위기", date: "2011.09",
    defcon: 2, color: "#FF6B00",
    desc: "PIIGS 국채위기, VIX 45, 신흥국 자금이탈, 원달러 급등",
    cat: { 신용위험:25, 유동성:28, 시장공포:18, 실물경기:38, 물가:38 },
    impact: { kospi:-22, krw:+12, desc:"코스피 -22%, 원달러 급등" },
  },
  {
    id: "covid2020", label: "코로나 충격", date: "2020.03",
    defcon: 2, color: "#FF6B00",
    desc: "VIX 66, 수출 -24%, 글로벌 봉쇄 → 역대급 유동성 공급으로 빠른 회복",
    cat: { 신용위험:12, 유동성:58, 시장공포:6, 실물경기:10, 물가:68 },
    impact: { kospi:-35, krw:+10, desc:"코스피 -35% 후 V자 반등" },
  },
  {
    id: "tightening2022", label: "미국 긴축 위기", date: "2022.10",
    defcon: 3, color: "#F0C800",
    desc: "금리역전 -1.06%, 원달러 1,444원, PPI 10%, 레고랜드 PF 부실 동시 발생",
    cat: { 신용위험:22, 유동성:18, 시장공포:30, 실물경기:42, 물가:14 },
    impact: { kospi:-25, krw:+20, desc:"코스피 -25%, 원달러 1,450원" },
  },
  {
    id: "volcker1979", label: "볼커 긴축 쇼크", date: "1979.10",
    defcon: 2, color: "#FF6B00",
    desc: "연준 기준금리 20%, CPI 13%, 인플레 파이터. 신흥국 외채위기 도화선",
    cat: { 신용위험:18, 유동성:8, 시장공포:12, 실물경기:25, 물가:5 },
    impact: { kospi:-22, krw:+12, desc:"한국 수출 타격, 외채부담 급증" },
  },
  {
    id: "japan1990", label: "일본 버블 붕괴", date: "1990.01",
    defcon: 3, color: "#F0C800",
    desc: "닛케이 -48%, 부동산 버블 붕괴. 한국 간접 타격, 과잉신용 경고 원형",
    cat: { 신용위험:35, 유동성:25, 시장공포:40, 실물경기:52, 물가:20 },
    impact: { kospi:-26, krw:+8, desc:"코스피 간접 하락, 수출 둔화" },
  },
  {
    id: "bond1994", label: "채권 대학살", date: "1994.02",
    defcon: 3, color: "#F0C800",
    desc: "연준 급격 금리인상, 채권가격 폭락. 2022 긴축위기의 역사적 원형",
    cat: { 신용위험:30, 유동성:22, 시장공포:28, 실물경기:45, 물가:32 },
    impact: { kospi:-25, krw:+5, desc:"채권가격 폭락, 코스피 급락" },
  },
  {
    id: "ltcm1998", label: "러시아 디폴트/LTCM", date: "1998.08",
    defcon: 2, color: "#FF6B00",
    desc: "HY스프레드 폭등, LTCM 붕괴 신용경색. GFC의 예고편. 한국 IMF 직후 이중충격",
    cat: { 신용위험:15, 유동성:18, 시장공포:12, 실물경기:22, 물가:52 },
    impact: { kospi:-35, krw:+20, desc:"IMF 직후 2차 충격, 원화 재급등" },
  },
  {
    id: "china2015", label: "중국 충격", date: "2015.08",
    defcon: 3, color: "#F0C800",
    desc: "위안화 절하, 상하이 -40%. 한국 수출 -14%, 코스피 급락, 구리 폭락",
    cat: { 신용위험:35, 유동성:25, 시장공포:28, 실물경기:30, 물가:55 },
    impact: { kospi:-15, krw:+10, desc:"수출 -14%, 코스피 단기 -15%" },
  },
  {
    id: "fed2018", label: "연준 긴축 2018", date: "2018.12",
    defcon: 4, color: "#38BDF8",
    desc: "장단기금리차 0.1%p까지 평탄, 코스피 -20%. 금리역전 직전 경고 사례",
    cat: { 신용위험:38, 유동성:35, 시장공포:35, 실물경기:42, 물가:38 },
    impact: { kospi:-20, krw:+8, desc:"코스피 -20%, 원달러 1,150→1,130" },
  },
];

// 유사도 계산 — 5개 카테고리 유클리드 거리 → 100점 환산
function calcSimilarity(currentCatScores, crisisCat) {
  const cats = ["신용위험","유동성","시장공포","실물경기","물가"];
  const curMap = {};
  (currentCatScores||[]).forEach(c => { curMap[c.cat] = c.score; });
  let sumSq = 0;
  cats.forEach(cat => {
    const cur = curMap[cat] ?? 50;
    const cri = crisisCat[cat] ?? 50;
    sumSq += Math.pow(cur - cri, 2);
  });
  const dist = Math.sqrt(sumSq); // 최대거리 ≈ sqrt(5*100^2) = 223, proximityScore와 동일 기준
  const similarity = Math.max(0, Math.round((1 - dist / 250) * 100));
  return similarity;
}

function calcCrisisAnalysis(defconData) {
  const results = CRISIS_BENCHMARKS.map(crisis => ({
    ...crisis,
    similarity: calcSimilarity(defconData.catScores, crisis.cat),
  })).sort((a, b) => b.similarity - a.similarity);

  const top = results[0];
  const top2 = results[1];

  // 공통 위험 패턴 분석
  const curMap = {};
  (defconData.catScores||[]).forEach(c => { curMap[c.cat] = c.score; });
  const warnings = [];
  if ((curMap["신용위험"]??50) < 40) warnings.push("신용위험 상승");
  if ((curMap["유동성"]??50) < 35)   warnings.push("유동성 압박");
  if ((curMap["시장공포"]??50) < 35) warnings.push("시장 공포 확산");
  if ((curMap["실물경기"]??50) < 40) warnings.push("실물경기 둔화");
  if ((curMap["물가"]??50) < 40)     warnings.push("물가 압력");

  // ── Crisis Navigation Metrics
  const cats = ["신용위험","유동성","시장공포","실물경기","물가"];
  // ① proximityScore: 현재 → 가장 유사한 위기까지 유클리드 거리 → 근접도 (0~100)
  let sumSqTop = 0;
  cats.forEach(cat => {
    const cur = curMap[cat] ?? 50;
    const cri = top?.cat?.[cat] ?? 50;
    sumSqTop += Math.pow(cur - cri, 2);
  });
  const distToTop = Math.sqrt(sumSqTop);
  const proximityScore = Math.max(0, Math.round((1 - distToTop / 250) * 100));

  // ② dangerDensity: 현재 음수(위험) 지표 비율
  const indicators = defconData.indicators || [];
  const dangerCount = indicators.filter(i => i.score < 0).length;
  const dangerDensity = indicators.length > 0
    ? Math.round((dangerCount / indicators.length) * 100)
    : 0;

  // ③ estimatedMonths: 위기 패턴 진입 경보 단계
  // proximityScore(위치 60%) + dangerDensity(밀도 40%) 복합 판단
  // 시간 예측은 모멘텀 데이터 없이 불가 → 단계 레이블로 표현
  const composite = proximityScore * 0.6 + dangerDensity * 0.4;
  const estimatedMonths = composite >= 72 ? "🔴 위기 패턴 진입"
    : composite >= 54 ? "🟠 경보 단계"
    : composite >= 36 ? "🟡 주의 단계"
    : "🟢 안정 구간";

  const navigation = {
    proximityScore,
    distToTop: Math.round(distToTop),
    dangerCount,
    totalIndicators: indicators.length,
    dangerDensity,
    estimatedMonths,
    topCrisis: top,
  };


  return { results, top, top2, warnings, navigation };
}

// ══════════════════════════════════════════════════════════════
// SEFCON v3.1 Regime Adjustment Layer
// 원칙: v2 보정 엔진을 기본값으로 삼고, v3는 조건부·제한적으로만 추가 보정한다.
// - 보정폭: 최대 ±10점
// - 등급 변화: 최대 1단계
// - 3중 게이트: 유사도 + 위험밀도 + 유형일치
// ══════════════════════════════════════════════════════════════
const INTERNAL_REGIME_EVENTS = [
  { id:"panic_1907", label:"1907 미국 은행공황", year:1907, type:"banking_crisis", phase:"은행 유동성 위기", cat:{신용위험:10,유동성:12,시장공포:10,실물경기:22,물가:44}, importance:5 },
  { id:"crash_1929", label:"1929 대공황 주가붕괴", year:1929, type:"bubble_burst", phase:"버블 붕괴", cat:{신용위험:16,유동성:18,시장공포:8,실물경기:18,물가:36}, importance:5 },
  { id:"banking_1931", label:"1931 글로벌 은행위기", year:1931, type:"banking_crisis", phase:"은행 신뢰 붕괴", cat:{신용위험:6,유동성:10,시장공포:8,실물경기:10,물가:30}, importance:5 },
  { id:"nifty_1969", label:"1969 니프티피프티 과열", year:1969, type:"bubble_late", phase:"우량성장주 과열", cat:{신용위험:62,유동성:62,시장공포:86,실물경기:76,물가:42}, importance:4 },
  { id:"oil_1973", label:"1973 1차 오일쇼크", year:1973, type:"inflation_shock", phase:"인플레이션 충격", cat:{신용위험:24,유동성:18,시장공포:22,실물경기:18,물가:5}, importance:5 },
  { id:"volcker_1979", label:"1979 볼커 긴축 쇼크", year:1979, type:"rate_shock", phase:"고금리 긴축 충격", cat:{신용위험:18,유동성:8,시장공포:12,실물경기:25,물가:5}, importance:5 },
  { id:"black_monday_1987", label:"1987 블랙먼데이", year:1987, type:"liquidity_crisis", phase:"시장 유동성 급락", cat:{신용위험:28,유동성:18,시장공포:8,실물경기:55,물가:46}, importance:4 },
  { id:"japan_bubble_1989", label:"1989 일본 자산버블 정점", year:1989, type:"bubble_late", phase:"자산버블 말기", cat:{신용위험:68,유동성:72,시장공포:88,실물경기:78,물가:36}, importance:5 },
  { id:"japan_1990", label:"1990 일본 버블 붕괴", year:1990, type:"bubble_burst", phase:"부동산·주식 버블 붕괴", cat:{신용위험:35,유동성:25,시장공포:40,실물경기:52,물가:20}, importance:5 },
  { id:"bond_1994", label:"1994 채권 대학살", year:1994, type:"rate_shock", phase:"급격한 금리상승", cat:{신용위험:30,유동성:22,시장공포:28,실물경기:45,물가:32}, importance:4 },
  { id:"mexico_1994", label:"1994 멕시코 테킬라 위기", year:1994, type:"fx_crisis", phase:"외환위기", cat:{신용위험:12,유동성:10,시장공포:16,실물경기:20,물가:12}, importance:4 },
  { id:"asia_fx_1997", label:"1997 아시아 외환위기", year:1997, type:"fx_crisis", phase:"외환·신용위기", cat:{신용위험:8,유동성:8,시장공포:12,실물경기:16,물가:12}, importance:5 },
  { id:"ltcm_1998", label:"1998 LTCM 위기", year:1998, type:"liquidity_crisis", phase:"레버리지 청산", cat:{신용위험:15,유동성:18,시장공포:12,실물경기:22,물가:52}, importance:4 },
  { id:"dotcom_late_1999", label:"1999 닷컴버블 말기", year:1999, type:"bubble_late", phase:"성장주 버블 말기", cat:{신용위험:50,유동성:64,시장공포:84,실물경기:72,물가:46}, importance:5 },
  { id:"dotcom_2000", label:"2000 IT 버블 붕괴", year:2000, type:"bubble_burst", phase:"성장주 버블 붕괴", cat:{신용위험:28,유동성:35,시장공포:22,실물경기:42,물가:45}, importance:5 },
  { id:"korea_card_2003", label:"2003 한국 카드채 위기", year:2003, type:"credit_crisis", phase:"소비신용 위기", cat:{신용위험:20,유동성:25,시장공포:30,실물경기:34,물가:48}, importance:3 },
  { id:"housing_boom_2005", label:"2005 미국 주택버블 확장", year:2005, type:"bubble_late", phase:"부동산 신용버블", cat:{신용위험:64,유동성:70,시장공포:86,실물경기:74,물가:40}, importance:4 },
  { id:"subprime_2007", label:"2007 서브프라임 초기", year:2007, type:"credit_crisis", phase:"신용위기 초기", cat:{신용위험:22,유동성:26,시장공포:28,실물경기:42,물가:42}, importance:5 },
  { id:"gfc_2008", label:"2008 글로벌 금융위기", year:2008, type:"credit_crisis", phase:"시스템 신용위기", cat:{신용위험:4,유동성:20,시장공포:3,실물경기:8,물가:25}, importance:5 },
  { id:"europe_2011", label:"2011 유럽 재정위기", year:2011, type:"credit_crisis", phase:"재정·은행위기", cat:{신용위험:25,유동성:28,시장공포:18,실물경기:38,물가:38}, importance:5 },
  { id:"taper_2013", label:"2013 테이퍼 텐트럼", year:2013, type:"rate_shock", phase:"금리상승·신흥국 압박", cat:{신용위험:34,유동성:26,시장공포:32,실물경기:48,물가:34}, importance:4 },
  { id:"china_2015", label:"2015 중국 위안화 쇼크", year:2015, type:"china_slowdown", phase:"중국 둔화·환율충격", cat:{신용위험:35,유동성:25,시장공포:28,실물경기:30,물가:55}, importance:4 },
  { id:"hy_energy_2016", label:"2016 유가·하이일드 위기", year:2016, type:"credit_crisis", phase:"에너지 신용위기", cat:{신용위험:26,유동성:34,시장공포:28,실물경기:32,물가:64}, importance:4 },
  { id:"fed_2018", label:"2018 연준 긴축 조정", year:2018, type:"rate_shock", phase:"긴축 후반 조정", cat:{신용위험:38,유동성:35,시장공포:35,실물경기:42,물가:38}, importance:5 },
  { id:"repo_2019", label:"2019 미국 레포시장 경색", year:2019, type:"liquidity_crisis", phase:"단기자금 경색", cat:{신용위험:34,유동성:22,시장공포:42,실물경기:54,물가:46}, importance:3 },
  { id:"covid_2020", label:"2020 코로나 충격", year:2020, type:"external_shock", phase:"외생 충격·급락", cat:{신용위험:12,유동성:58,시장공포:6,실물경기:10,물가:68}, importance:5 },
  { id:"tightening_2022", label:"2022 인플레이션·긴축 충격", year:2022, type:"rate_shock", phase:"인플레이션 긴축", cat:{신용위험:22,유동성:18,시장공포:30,실물경기:42,물가:14}, importance:5 },
  { id:"uk_ldi_2022", label:"2022 영국 LDI 위기", year:2022, type:"liquidity_crisis", phase:"금리·레버리지 위기", cat:{신용위험:24,유동성:16,시장공포:24,실물경기:44,물가:18}, importance:4 },
  { id:"svb_2023", label:"2023 SVB 은행위기", year:2023, type:"banking_crisis", phase:"금리충격형 은행위기", cat:{신용위험:20,유동성:18,시장공포:20,실물경기:48,물가:22}, importance:4 },
  { id:"cre_2023", label:"2023~2024 상업용부동산 스트레스", year:2023, type:"credit_crisis", phase:"부동산 신용 스트레스", cat:{신용위험:28,유동성:26,시장공포:36,실물경기:46,물가:30}, importance:3 },
];

function classifyRegimeType(type) {
  const map = {
    banking_crisis: "은행위기형", credit_crisis: "신용위기형", fx_crisis: "외환위기형",
    rate_shock: "긴축·금리충격형", liquidity_crisis: "유동성경색형",
    bubble_late: "버블말기형", bubble_burst: "버블붕괴형", inflation_shock: "인플레이션충격형",
    china_slowdown: "중국둔화형", external_shock: "외생충격형",
  };
  return map[type] || type || "미분류";
}

function inferEnhancedRiskTypes(enhancedRisk) {
  const t = `${enhancedRisk?.crisisType || ""}`;
  const types = new Set();
  if (t.includes("신용")) types.add("credit_crisis");
  if (t.includes("달러") || t.includes("환율") || t.includes("외국인")) { types.add("fx_crisis"); types.add("liquidity_crisis"); }
  if (t.includes("유동성")) types.add("liquidity_crisis");
  if (t.includes("실물") || t.includes("수출")) types.add("china_slowdown");
  if (types.size === 0) types.add("rate_shock");
  return [...types];
}

function defconFromScore(score) {
  let defcon, defconLabel, defconColor, defconDesc;
  if      (score <= 30) { defcon=1; defconLabel="SEFCON 1  붕괴임박"; defconColor="#FF1A1A"; defconDesc="복수의 위기 신호가 동시 발생. 현금 비중 최우선. 시스템 리스크 구간"; }
  else if (score <= 45) { defcon=2; defconLabel="SEFCON 2  위기";     defconColor="#FF6B00"; defconDesc="선행지표와 트리거가 동시 악화. 리스크 자산 비중 축소 검토"; }
  else if (score <= 58) { defcon=3; defconLabel="SEFCON 3  경계";     defconColor="#F0C800"; defconDesc="일부 위기 조합 감지. 포트폴리오 방어 태세 필요"; }
  else if (score <= 72) { defcon=4; defconLabel="SEFCON 4  관망";     defconColor="#38BDF8"; defconDesc="대체로 양호하나 일부 위험 신호 관찰"; }
  else                  { defcon=5; defconLabel="SEFCON 5  안정";     defconColor="#00C878"; defconDesc="전반적 위험 신호 제한적. 적극적 투자 환경"; }
  return { defcon, defconLabel, defconColor, defconDesc };
}

function clampScoreToOneDefconStep(baseScore, proposedScore) {
  const base = defconFromScore(baseScore).defcon;
  const proposed = defconFromScore(proposedScore).defcon;
  if (Math.abs(proposed - base) <= 1) return proposedScore;
  // 낮은 score = 더 위험. base에서 한 단계 이상 위험해지려 하면 허용 최저 구간으로 제한.
  if (proposed < base - 1) {
    if (base === 5) return 59; // 5 → 4까지만
    if (base === 4) return 46; // 4 → 3까지만
    if (base === 3) return 31; // 3 → 2까지만
    return 0;                  // 2 → 1까지만
  }
  // 한 단계 이상 안전해지려 하면 허용 최고 구간으로 제한.
  if (proposed > base + 1) {
    if (base === 1) return 45; // 1 → 2까지만
    if (base === 2) return 58; // 2 → 3까지만
    if (base === 3) return 72; // 3 → 4까지만
    return 100;                // 4 → 5까지만
  }
  return proposedScore;
}

function buildRegimeInsight({ defconData, crisisAnalysis }) {
  const currentCatScores = defconData?.catScores || [];
  const internalMatches = INTERNAL_REGIME_EVENTS
    .filter(e => e.importance >= 3)
    .map(e => ({ ...e, similarity: calcSimilarity(currentCatScores, e.cat) }))
    .sort((a, b) => b.similarity - a.similarity);

  const typeScore = {};
  internalMatches.slice(0, 7).forEach((m, idx) => {
    const weight = Math.max(1, 7 - idx) * (m.similarity || 0);
    typeScore[m.type] = (typeScore[m.type] || 0) + weight;
  });
  const typeMixRaw = Object.entries(typeScore).sort((a, b) => b[1] - a[1]);
  const totalTypeScore = typeMixRaw.reduce((sum, x) => sum + x[1], 0) || 1;
  const typeMix = typeMixRaw.slice(0, 5).map(([type, score]) => ({
    type,
    label: classifyRegimeType(type),
    weight: Math.round(score / totalTypeScore * 100),
  }));
  const primary = typeMix[0] || { type:"unknown", label:"미분류", weight:0 };
  const topInternal = internalMatches.slice(0, 5).map(m => ({
    id:m.id, label:m.label, year:m.year, type:m.type, typeLabel:classifyRegimeType(m.type),
    phase:m.phase, similarity:m.similarity, importance:m.importance,
  }));
  const sefconRisk = Math.max(0, Math.min(100, 100 - (defconData?.totalScore ?? 50)));
  const navigationRisk = crisisAnalysis?.navigation?.proximityScore ?? 50;
  const density = crisisAnalysis?.navigation?.dangerDensity ?? 0;
  const transitionRisk = Math.round(sefconRisk * 0.50 + navigationRisk * 0.30 + density * 0.20);
  return {
    engine:"SEFCON v3.1 Regime Insight",
    mode:"gated_adjustment",
    version:"v3.1-on-v2",
    officialTop: (crisisAnalysis?.results || []).slice(0,3).map(e => ({id:e.id,label:e.label,date:e.date,defcon:e.defcon,similarity:e.similarity,desc:e.desc,impact:e.impact})),
    internalTopMatches: topInternal,
    regime: { primaryType:primary.type, primaryLabel:primary.label, confidence:primary.weight, typeMix },
    transitionRisk: { score:transitionRisk, level: transitionRisk>=75?"위기":transitionRisk>=60?"경고":transitionRisk>=45?"주의":transitionRisk<30?"안정":"관찰", components:{sefconRisk,navigationRisk,dangerDensity:density} },
    trainingSet: { officialEvents:CRISIS_BENCHMARKS.length, internalEvents:INTERNAL_REGIME_EVENTS.length, recentEventsExcluded:false, uiVisible:false },
  };
}

function calculateV3Adjustment({ defconData, enhancedRisk, crisisAnalysis, regimeInsight, exportKospiAlignment }) {
  const baseScore = defconData?.totalScore ?? 50;
  const dangerDensity = crisisAnalysis?.navigation?.dangerDensity ?? 0;
  const top = regimeInsight?.internalTopMatches?.[0] || null;
  const topSimilarity = top?.similarity ?? 0;
  const primaryType = regimeInsight?.regime?.primaryType || top?.type || "unknown";
  const inferredTypes = inferEnhancedRiskTypes(enhancedRisk);
  const typeConsistency = inferredTypes.includes(primaryType)
    || (primaryType === "banking_crisis" && inferredTypes.includes("credit_crisis"))
    || (primaryType === "credit_crisis" && inferredTypes.includes("banking_crisis"))
    || (primaryType === "rate_shock" && (enhancedRisk?.crisisType || "").includes("달러"));

  const strongGate = topSimilarity >= 70 && dangerDensity >= 45 && typeConsistency;
  const emergencyGate = topSimilarity >= 82 && dangerDensity >= 55;
  const gatePassed = strongGate || emergencyGate;

  let delta = 0; // finalScore - baseScore. 음수면 위험 강화, 양수면 위험 완화.
  const reasons = [];

  if (gatePassed) {
    const severeTypes = ["credit_crisis", "banking_crisis", "fx_crisis", "liquidity_crisis", "bubble_burst"];
    if (topSimilarity >= 85) { delta -= 4; reasons.push(`역사 패턴 유사도 ${topSimilarity}%: 매우 높음`); }
    else if (topSimilarity >= 78) { delta -= 3; reasons.push(`역사 패턴 유사도 ${topSimilarity}%: 높음`); }
    else { delta -= 2; reasons.push(`역사 패턴 유사도 ${topSimilarity}%: 보정 조건 충족`); }

    if (severeTypes.includes(primaryType)) { delta -= 3; reasons.push(`${classifyRegimeType(primaryType)} 우세`); }
    else if (primaryType === "rate_shock" || primaryType === "inflation_shock") { delta -= 2; reasons.push(`${classifyRegimeType(primaryType)} 우세`); }
    else if (primaryType === "bubble_late") { delta -= 1; reasons.push("버블말기형 과열 신호"); }

    if (dangerDensity >= 65) { delta -= 3; reasons.push(`위험지표 밀도 ${dangerDensity}%: 높음`); }
    else if (dangerDensity >= 55) { delta -= 2; reasons.push(`위험지표 밀도 ${dangerDensity}%: 경고권`); }
    else { delta -= 1; reasons.push(`위험지표 밀도 ${dangerDensity}%: 보정 조건 충족`); }

    if (typeConsistency) reasons.push("v2 위기유형과 v3 역사패턴이 일치");
    else reasons.push("고유사도·고위험밀도에 따른 예외 보정");
  } else {
    reasons.push("v3 3중 게이트 미충족: 점수 보정 없음");
  }

  const currentGap = exportKospiAlignment?.currentMarket?.gapZ;
  const leadGap = exportKospiAlignment?.leadAdjusted?.gapZ;
  if (Number.isFinite(currentGap) && Number.isFinite(leadGap)) {
    if (currentGap >= 1.2 && leadGap >= 0.7) {
      delta -= 2;
      reasons.push(`수출 대비 코스피 선행 과열: 현재 ${currentGap}σ, 보정 ${leadGap}σ`);
    } else if (currentGap <= -1.2 && leadGap <= -0.7 && (defconData?.defcon ?? 3) >= 3) {
      delta += 2;
      reasons.push(`수출 대비 코스피 저평가: 현재 ${currentGap}σ, 보정 ${leadGap}σ`);
    }
  }

  delta = Math.max(-10, Math.min(10, Math.round(delta)));
  let proposedScore = Math.max(0, Math.min(100, baseScore + delta));
  const finalScore = clampScoreToOneDefconStep(baseScore, proposedScore);
  const finalDelta = finalScore - baseScore;
  const applied = finalDelta !== 0;
  const finalDefcon = defconFromScore(finalScore);

  return {
    applied,
    gatePassed,
    adjustment: finalDelta,
    baseScore,
    proposedScore,
    finalScore,
    baseDefcon: defconData?.defcon ?? defconFromScore(baseScore).defcon,
    finalDefcon: finalDefcon.defcon,
    primaryType,
    primaryLabel: classifyRegimeType(primaryType),
    topSimilarity,
    dangerDensity,
    typeConsistency,
    reasons,
  };
}

function applyV3AdjustmentToDefcon(defconData, v3Adjustment) {
  if (!defconData || !v3Adjustment) return defconData;
  defconData.v2FinalScore = v3Adjustment.baseScore;
  defconData.v3Adjustment = v3Adjustment;
  defconData.totalScore = v3Adjustment.finalScore;
  defconData.adjustedScore = v3Adjustment.finalScore;
  const d = defconFromScore(v3Adjustment.finalScore);
  defconData.defcon = d.defcon;
  defconData.defconLabel = d.defconLabel;
  defconData.defconColor = d.defconColor;
  defconData.defconDesc = v3Adjustment.applied
    ? `${d.defconDesc} · v3 ${v3Adjustment.primaryLabel} ${v3Adjustment.adjustment > 0 ? "+" : ""}${v3Adjustment.adjustment}점 보정`
    : d.defconDesc;
  return defconData;
}

// ══════════════════════════════════════════════════════════════
// 일평균수출 · 코스피 비교 보정 — 데이터 시차 방어용 보조 필드
// ══════════════════════════════════════════════════════════════
function normalizeSeriesZ(arr, valueKey) {
  const vals = (arr || []).map(r => Number(r[valueKey])).filter(v => Number.isFinite(v));
  if (vals.length < 12) return [];
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / vals.length;
  const sd = Math.sqrt(variance) || 1;
  return (arr || []).map(r => {
    const v = Number(r[valueKey]);
    return Number.isFinite(v) ? { ...r, z: +((v - avg) / sd).toFixed(2) } : { ...r, z: null };
  });
}

function classifyExportKospiGap(z) {
  if (z == null || !Number.isFinite(Number(z))) return "데이터 부족";
  if (z >= 1.5) return "강한 과열";
  if (z >= 0.5) return "과열";
  if (z <= -1.5) return "강한 저평가";
  if (z <= -0.5) return "저평가";
  return "중립";
}

function shiftMonthYYYYMM(yyyymm, offset) {
  const key = normalizeDateKey(yyyymm, "month");
  if (!key) return null;
  const y = Number(key.slice(0,4));
  const m = Number(key.slice(4,6));
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildExportKospiAlignment(dailyExport, kospiMonthly, leadMonths = 2) {
  const exportValid = (dailyExport || [])
    .filter(r => r?.date && r.value != null)
    .map(r => ({ date: normalizeDateKey(r.date, "month"), value: Number(r.value) }))
    .filter(r => r.date && Number.isFinite(r.value));
  const kospiValid = (kospiMonthly || [])
    .filter(r => r?.date && r.price != null)
    .map(r => ({ date: normalizeDateKey(r.date, "month"), price: Number(r.price) }))
    .filter(r => r.date && Number.isFinite(r.price));

  if (exportValid.length < 12 || kospiValid.length < 12) return { available:false, reason:"수출 또는 코스피 데이터 부족" };
  const exportZ = normalizeSeriesZ(exportValid, "value");
  const kospiZ = normalizeSeriesZ(kospiValid, "price");
  const kospiMap = new Map(kospiZ.map(r => [r.date, r]));
  const exportLatest = [...exportZ].reverse().find(r => r.z != null);
  const kospiLatest = [...kospiZ].reverse().find(r => r.z != null);
  const commonMonths = exportZ.filter(r => r.z != null && kospiMap.has(r.date)).map(r => r.date).sort();
  const commonMonth = commonMonths.at(-1);
  if (!exportLatest || !kospiLatest || !commonMonth) return { available:false, reason:"공통 기준월 계산 실패" };

  const exportAtCommon = exportZ.find(r => r.date === commonMonth);
  const kospiAtCommon = kospiMap.get(commonMonth);
  const officialGapZ = +(kospiAtCommon.z - exportAtCommon.z).toFixed(2);
  const currentGapZ = +(kospiLatest.z - exportLatest.z).toFixed(2);
  const leadMonth = shiftMonthYYYYMM(exportLatest.date, leadMonths);
  const kospiLead = kospiMap.get(leadMonth) || kospiLatest;
  const leadGapZ = +(kospiLead.z - exportLatest.z).toFixed(2);
  const y1 = Number(exportLatest.date.slice(0,4)), m1 = Number(exportLatest.date.slice(4,6));
  const y2 = Number(kospiLatest.date.slice(0,4)), m2 = Number(kospiLatest.date.slice(4,6));
  const lagMonths = (y2 * 12 + m2) - (y1 * 12 + m1);

  return {
    available:true,
    commonMonth,
    official:{ label:"동월 기준", exportMonth:commonMonth, kospiMonth:commonMonth, gapZ:officialGapZ, signal:classifyExportKospiGap(officialGapZ) },
    currentMarket:{ label:"현재 주가 기준", exportMonth:exportLatest.date, kospiMonth:kospiLatest.date, gapZ:currentGapZ, signal:classifyExportKospiGap(currentGapZ) },
    leadAdjusted:{ label:`${leadMonths}개월 선행 보정`, exportMonth:exportLatest.date, kospiMonth:kospiLead?.date || null, gapZ:leadGapZ, signal:classifyExportKospiGap(leadGapZ) },
    dataLag:{ exportLatestMonth:exportLatest.date, kospiLatestMonth:kospiLatest.date, lagMonths, message:lagMonths>0?`수출 데이터가 코스피보다 약 ${lagMonths}개월 늦습니다.`:"수출과 코스피의 최신월 차이가 크지 않습니다." },
  };
}

// ── SEFCON
function calcDefcon(indicators) {
  // ── 카테고리 가중치 (KLR 연구 기반 선행성 반영)
  // 신용위험 30% — 가장 빠른 선행지표 집중
  // 시장공포 25% — VIX 등 실시간 반응
  // 실물경기 20% — 유지
  // 유동성   15% — 일부 후행 포함
  // 물가     10% — 가장 후행적
  const CAT_WEIGHT = {
    "신용위험": 0.30,
    "시장공포": 0.25,
    "실물경기": 0.20,
    "유동성":   0.15,
    "물가":     0.10,
  };
  const cats = Object.keys(CAT_WEIGHT);

  const catScores = cats.map(cat => {
    const inds   = indicators.filter(i => i.cat === cat);
    const catRaw = inds.reduce((s, i) => s + i.score, 0);
    // catMax: 지표별 최대 가중 점수 합산
    // T10Y2Y(×2)→max4, Baa/HY/LEI(×1.5)→max3, 일반→max2
    const catMax = inds.reduce((s, i) => {
      const absScore = Math.abs(i.score);
      if (absScore > 3) return s + 4;       // ×2 지표
      if (absScore > 2) return s + 3;       // ×1.5 지표
      return s + 2;                          // 일반 지표
    }, 0) || (inds.length * 2);
    const score = catMax > 0 ? Math.round((catRaw + catMax) / (catMax * 2) * 100) : 50;
    return { cat, score: Math.max(0, Math.min(100, score)), count: inds.length, weight: CAT_WEIGHT[cat] };
  });

  // ── 전체 점수 = 카테고리 가중 평균 (선행성 반영)
  const totalScore = Math.round(
    catScores.reduce((s, c) => s + c.score * c.weight, 0)
  );
  const maxScore = 100;

  let defcon, defconLabel, defconColor, defconDesc;
  if      (totalScore <= 30) { defcon=1; defconLabel="SEFCON 1  붕괴임박"; defconColor="#FF1A1A"; defconDesc="복수의 위기 신호 동시 발생. 현금 비중 최우선. 역사적 위기 수준에 근접"; }
  else if (totalScore <= 45) { defcon=2; defconLabel="SEFCON 2  위기";     defconColor="#FF6B00"; defconDesc="선행지표 다수 경고. 리스크 자산 비중 즉시 축소 검토"; }
  else if (totalScore <= 58) { defcon=3; defconLabel="SEFCON 3  경계";     defconColor="#F0C800"; defconDesc="일부 지표 악화. 포트폴리오 점검 및 방어적 포지션 준비"; }
  else if (totalScore <= 72) { defcon=4; defconLabel="SEFCON 4  관망";     defconColor="#38BDF8"; defconDesc="대체로 양호. 선별적 기회 탐색 가능"; }
  else                       { defcon=5; defconLabel="SEFCON 5  안정";     defconColor="#00C878"; defconDesc="전 지표 정상. 적극적 투자 환경"; }

  return { defcon, defconLabel, defconColor, defconDesc, totalScore, maxScore, indicators, catScores };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // ── 디버그 모드: ?debug=1 — 각 시리즈 개별 테스트
  if (req.query?.debug === "1") {
    const tests = [
      ["기준금리", "722Y001", "0101000", "D", "20220101", "20241231"],
      // ── 명목 GDP 분기 후보
      ["GDP명목분기_200Y103_10106", "200Y103", "10106", "Q", "2020Q1", "2024Q4"],  // 계절조정, 명목, 분기 - GDP
      ["GDP명목분기_200Y103_AA",    "200Y103", "AA",    "Q", "2020Q1", "2024Q4"],  // 와일드카드
      ["GDP명목분기_200Y105_10106", "200Y105", "10106", "Q", "2020Q1", "2024Q4"],  // 원계열, 명목, 분기
      ["GDP명목분기_200Y107_10106", "200Y107", "10106", "Q", "2020Q1", "2024Q4"],  // 지출기준, 계절조정, 명목
      ["GDP명목연간_200Y113_10106", "200Y113", "10106", "A", "2015",   "2024"  ],  // 명목, 연간 (이미 스크린샷 확인)
      // ── 한국 대출행태서베이 (한국판 SLOOS)
      ["KR_SLOOS_대출태도_514Y001", "514Y001", "1",     "Q", "2020Q1", "2024Q4"],  // 대출태도
      ["KR_SLOOS_대출태도_AA",      "514Y001", "AA",    "Q", "2020Q1", "2024Q4"],
      ["KR_SLOOS_신용위험_514Y002", "514Y002", "1",     "Q", "2020Q1", "2024Q4"],  // 신용위험
      ["KR_SLOOS_대출수요_514Y003", "514Y003", "1",     "Q", "2020Q1", "2024Q4"],  // 대출수요
    ];
    const results = {};
    for (const [name, stat, item, freq, sd, ed] of tests) {
      // encodeURIComponent 제거 — 와일드카드(*) 그대로 전송
      const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/3/${stat}/${freq}/${sd}/${ed}/${item}`;
      try {
        const r = await fetch(url);
        const json = await r.json();
        results[name] = {
          code: json?.RESULT?.CODE || "OK",
          msg:  json?.RESULT?.MESSAGE || "",
          rows: json?.StatisticSearch?.row?.length || 0,
          sample: json?.StatisticSearch?.row?.[0] || null,
        };
      } catch(e) { results[name] = { error: e.message }; }
    }
    return res.status(200).json({ keyPresent: !!ECOS_KEY, keyPreview: ECOS_KEY?ECOS_KEY.slice(0,4)+"****":"EMPTY", keyLen: ECOS_KEY.length, keyFull: ECOS_KEY, results });
  }

  if (Date.now() - cache.ts < CACHE_TTL && cache.data) {
    return res.status(200).json(cache.data);
  }

  try {
    const now      = new Date();
    const endY     = now.getFullYear();
    const endM     = String(now.getMonth() + 1).padStart(2, "0");
    const endDate  = `${endY}${endM}`;
    const endD     = String(now.getDate()).padStart(2, "0");
    const endDate8 = `${endY}${endM}${endD}`;
    const startDate  = `${endY - 8}01`;
    const startDate8 = `${endY - 2}0101`;  // 일별은 최근 2년만 (200개 제한 대응)
    const startDateQ = `${endY - 8}Q1`;

    // ── 병렬 호출: ECOS 14개 + Yahoo 지수+4개 + FRED 8개
    const [gdpR, exportR, rateR, fxR, ppiR, bsiR, cpiR, kospiR, kosdaqR, hhCreditR, bond10YR, bond3YR,
           fredT10Y2YR, fredHYR, fredDGS10R, fredVIXR, fredUNRATER,
           fredSLOOSR, krSloosR, fredLEIR, fredICSAR, fredBAMLR,
           yahooBIZDR, yahooDXYR, yahooHGR, yahooGCR,
           ecosCDR, nominalGdpR,
           fredM2SLR, ecosKrM2R,
           foreignNetR] =
      await Promise.allSettled([
        fetchECOS("200Y102", "10111",   startDateQ, `${endY}Q4`, "Q"),  // GDP 실질 전기비%
        fetchECOS("901Y118", "T002",    startDate,  endDate,     "M"),  // 수출금액(천불)
        fetchECOS("722Y001", "0101000", startDate8, endDate8,    "D"),  // 기준금리(일별)
        fetchECOS("731Y003", "0000003", startDate8, endDate8,    "D"),  // 원/달러 종가(일별)
        fetchECOS("404Y014", "*AA",     startDate,  endDate,     "M"),  // PPI 총지수
        fetchECOS("512Y013", "99988",   startDate,  endDate,     "M"),  // BSI 전산업
        fetchECOS("901Y009", "0",       startDate,  endDate,     "M"),  // CPI 총지수
        fetchIndexMonthly("^KS11"),                                      // 코스피 월봉
        fetchIndexMonthly("^KQ11"),                                      // 코스닥 월봉
        fetchECOS("151Y001", "1000000", startDateQ, `${endY}Q4`, "Q"),  // 가계신용 잔액(분기, 십억원)
        fetchECOS("817Y002", "5070000", startDate, endDate, "MM"),  // 국고채 10Y 수익률
        fetchECOS("817Y002", "5020000", startDate, endDate, "MM"),  // 국고채 3Y 수익률
        fetchFRED("T10Y2Y",           `${endY - 3}-01-01`),             // 미국 장단기 금리차
        fetchFRED("DBAA",             `${endY - 3}-01-01`),             // 무디스 Baa 회사채
        fetchFRED("DGS10",            `${endY - 3}-01-01`),             // 미국 10년 국채 수익률
        fetchVIXMonthly(),                                               // VIX (Yahoo)
        fetchFRED("UNRATE",           `${endY - 5}-01-01`),             // 미국 실업률
        fetchFRED("DRTSCILM",         `${endY - 5}-01-01`),             // 미국 SLOOS 은행대출 기준강화 (복원)
        fetchECOS("514Y001", "AA",      startDateQ, `${endY}Q4`, "Q"),  // 한국 대출행태서베이 — 대출태도
        fetchFRED("USALOLITONOSTSAM", `${endY - 5}-01-01`),             // 미국 LEI 경기선행지수
        fetchFRED("IC4WSA",           `${endY - 3}-01-01`),             // 주간 실업청구 4주이동평균(천건)
        fetchFRED("BAMLH0A0HYM2",     `${endY - 5}-01-01`),             // ICE BofA HY 스프레드 (사모신용 대용)
        fetchYahooMonthly("BIZD", 5),                                    // BIZD ETF 가격 (그래프 참고용)
        fetchYahooMonthly("DX-Y.NYB", 5),                               // DXY 달러인덱스
        fetchYahooMonthly("HG=F", 5),                                    // 구리 선물
        fetchYahooMonthly("GC=F", 5),                                    // 금 선물
        fetchECOS("721Y001", "5010000", startDate,  endDate,     "M"),  // CD 91일물 수익률
        fetchECOS("200Y113", "10106",   `${endY - 10}`, `${endY}`, "A"),// 명목 GDP 연간 (십억원) — 자동 갱신
        fetchFRED("M2SL",             `${endY - 8}-01-01`),             // 미국 M2 통화량 (월별, 십억달러)
        fetchECOS("161Y006", "BBHA00", startDate,  endDate,     "M"),  // 한국 M2 광의통화 평잔 원계열 (월별, 십억원)
        fetchECOS("901Y055", "S22CC",  startDate,  endDate,     "M"),  // 외국인 KOSPI 순매수 (월별)
      ]);

    const ok = r => r.status === "fulfilled" ? r.value : [];

    const gdpArr        = ok(gdpR);
    const exportArr     = ok(exportR);
    const rateArr       = ok(rateR);
    const fxArr         = ok(fxR);
    const ppiArr        = ok(ppiR);
    const bsiArr        = ok(bsiR);
    const cpiArr        = ok(cpiR);
    const kospiMonthly  = ok(kospiR);
    const kosdaqMonthly = ok(kosdaqR);
    const hhCreditArr   = ok(hhCreditR);
    const bond10YArr    = ok(bond10YR);
    const bond3YArr     = ok(bond3YR);
    const fredT10Y2YRaw = ok(fredT10Y2YR);
    const fredHYRaw     = ok(fredHYR);
    const fredDGS10Raw  = ok(fredDGS10R);
    const fredVIXRaw    = ok(fredVIXR);
    const fredUNRATE    = ok(fredUNRATER);
    // 신규
    const fredSLOOSRaw  = ok(fredSLOOSR);  // 미국 SLOOS (복원)
    const krSloosRaw    = ok(krSloosR);    // 한국 대출행태서베이 (분기)
    const fredLEIRaw    = ok(fredLEIR);
    const fredICSARaw   = ok(fredICSAR);
    const fredBAMLRaw   = ok(fredBAMLR);   // ICE BofA HY 스프레드
    const yahooBIZDRaw  = ok(yahooBIZDR);
    const yahooDXYRaw   = ok(yahooDXYR);
    const yahooHGRaw    = ok(yahooHGR);
    const yahooGCRaw    = ok(yahooGCR);
    const ecosCDRaw     = ok(ecosCDR);
    const nominalGdpArr = ok(nominalGdpR); // 명목 GDP 연간 (십억원)
    const fredM2SLRaw   = ok(fredM2SLR);   // 미국 M2 (십억달러)
    const ecosKrM2Raw   = ok(ecosKrM2R);   // 한국 M2 (십억원)
    const foreignNetRaw = ok(foreignNetR); // 외국인 KOSPI 순매수 (월별)

    // ── 가공
    // GDP: 이미 전기비% → yoy 필드로 매핑
    const gdp         = gdpArr.map(r => ({ ...r, yoy: r.value }));
    const gdpLevel    = gdpArr;
    // 수출: 천불 → 일평균$M (1천불/21일/1000 = $M)
    const dailyExport = exportArr.map(r => ({ date: r.date, value: +(r.value / 21000).toFixed(1) }));
    const exportYoY   = calcMonthlyYoY(dailyExport);
    const exportKospiAlignment = buildExportKospiAlignment(dailyExport, kospiMonthly, 2);
    const rate        = dailyToMonthly(rateArr);
    const fx          = dailyToMonthly(fxArr);
    const ppi         = calcMonthlyYoY(ppiArr);
    // BSI: itemCode 99988은 한 달에 여러 row → 날짜별 마지막 값만 유지
    const bsiMap = {};
    for (const r of bsiArr) bsiMap[r.date] = r.value;
    const bsi = Object.entries(bsiMap).sort((a,b)=>a[0]>b[0]?1:-1).map(([date,value])=>({date,value}));
    const cpi         = calcMonthlyYoY(cpiArr);

    // ── 가계신용 YoY (분기, 전년동기비 %)
    const hhCreditYoY = calcQuarterlyYoY(hhCreditArr);

    // ── 장단기 금리차: 국고채 10Y − 3Y (월별, %p)
    const yieldSpread = bond10YArr.map(r => {
      const b3 = bond3YArr.find(b => b.date === r.date);
      return b3 != null ? { date: r.date, value: +(r.value - b3.value).toFixed(2) } : null;
    }).filter(Boolean);

    // ── FRED 일별 → 월별 변환
    const fredT10Y2Y = dailyToMonthly(fredT10Y2YRaw);
    // Baa-국채 신용스프레드 = DBAA - DGS10 (기준금리 영향 제거)
    const fredDGS10M  = dailyToMonthly(fredDGS10Raw);
    const dgs10Map    = {};
    fredDGS10M.forEach(r => { dgs10Map[r.date] = r.value; });
    const fredHY = dailyToMonthly(fredHYRaw).map(r => {
      const t10 = dgs10Map[r.date];
      return t10 != null ? { date: r.date, value: +(r.value - t10).toFixed(2) } : null;
    }).filter(Boolean);
    const fredVIX    = fredVIXRaw;  // Yahoo에서 이미 월별로 옴
    const lastFRED   = arr => arr?.slice(-1)[0]?.value ?? null;

    // ── 신규 가공
    // 미국 SLOOS: 일별 → 월별 (양수 = 대출기준 강화, 분기 발표 → 월별 근사)
    const fredSLOOS = dailyToMonthly(fredSLOOSRaw);
    // 한국 대출행태서베이 — 대출태도 (분기, 양수=대출기준 강화)
    const krSloos = krSloosRaw;  // ECOS 분기 데이터 그대로 사용
    // LEI: 일별 → 월별 (OECD 선행지수, 100 기준)
    const fredLEI = dailyToMonthly(fredLEIRaw);
    // IC4WSA: 주간 실업청구 4주이동평균 → 월별 (천건 단위)
    const fredICSA = dailyToMonthly(fredICSARaw.map(r => ({ ...r, value: +(r.value / 1000).toFixed(1) })));
    // UNRATE: 미국 실업률 (월별, %) — 이미 월별이므로 dailyToMonthly 불필요
    const fredUNRATEMonthly = fredUNRATE
      .map(r => ({ date: r.date.slice(0,6), value: r.value }))
      .filter(r => r.date && r.value != null);
    // ICE BofA HY 스프레드 — 일별 → 월별 (사모신용 위험 프리미엄 대용)
    const fredBAML = dailyToMonthly(fredBAMLRaw);
    // BIZD ETF 가격 (그래프 참고용만 — 지표 계산 미사용)
    const yahooBIZD = yahooBIZDRaw;
    // DXY 달러인덱스
    const yahooDXY = yahooDXYRaw;
    // 구리/금 비율 (월별 매칭)
    const yahooHG = yahooHGRaw;
    const yahooGC = yahooGCRaw;
    const copperGoldMap = {};
    yahooGC.forEach(r => { copperGoldMap[r.date] = r.value; });
    const copperGold = yahooHG.map(r => {
      const gold = copperGoldMap[r.date];
      return gold ? { date: r.date, value: +(r.value / gold * 1000).toFixed(4) } : null;
    }).filter(Boolean);
    // CD금리 스프레드 = CD91일 - 기준금리
    const cdMonthly = ecosCDRaw;
    const rateMonthly = dailyToMonthly(rateArr);
    const rateMap2 = {};
    rateMonthly.forEach(r => { rateMap2[r.date] = r.value; });
    const cdSpread = cdMonthly.map(r => {
      const base = rateMap2[r.date];
      return base != null ? { date: r.date, value: +(r.value - base).toFixed(2) } : null;
    }).filter(Boolean);
    // ── 가계부채/GDP 비율 — 명목 GDP 연간 자동 갱신 (200Y113/10106, 십억원)
    // 분기 근사: 연간÷4. 가계신용 잔액(십억원) ÷ 분기GDP(십억원) × 100
    const nominalGdpByYear = {};
    nominalGdpArr.forEach(r => { nominalGdpByYear[r.date] = r.value; }); // key: "2023" 등 연도
    const hhDebtGDP = hhCreditArr.map(r => {
      const yr = r.date?.slice(0, 4);
      // 해당 연도 없으면 가장 최근 연도 사용 (미공표 최근 분기 대응)
      const gdpAnnual = nominalGdpByYear[yr]
        ?? nominalGdpByYear[String(+yr - 1)]
        ?? nominalGdpByYear[String(+yr - 2)]
        ?? null;
      if (!gdpAnnual || !r.value) return null;
      // ECOS 151Y001 협의 기준: 예금취급기관 대출 + 판매신용 ÷ 연간 명목 GDP × 100
      // BIS 광의(~105%)와 다름 — 보정계수 없이 실제값 그대로 사용
      return { date: r.date, value: +(r.value / gdpAnnual * 100).toFixed(1) };
    }).filter(Boolean);

    // ── 미국/한국 M2 통화량 YoY 계산
    // M2SL은 FRED 월별 데이터 (단위: 십억달러) — fetchFRED가 "day" 모드로 파싱하므로
    // date가 "20240101" 형태로 저장됨 → slice(0,6)으로 "YYYYMM" 추출 후 "YYYY.MM" 변환
    const usM2 = fredM2SLRaw
      .map(r => ({
        date: r.date ? r.date.slice(0,6).replace(/^(\d{4})(\d{2})$/, "$1.$2") : null,
        value: r.value
      }))
      .filter(r => r.date && r.value != null && !Number.isNaN(r.value));
    const usM2YoY = calcMonthlyYoY(usM2); // { date, value(절대값), yoy }
    // 한국 M2: ECOS 월별 (십억원)
    const krM2 = ecosKrM2Raw.map(r => ({ date: r.date, value: r.value })).filter(r=>r.date&&r.value!=null);
    const krM2YoY = calcMonthlyYoY(krM2);

    // ── 외국인 KOSPI 순매수 (월별, 단위 확인 후 조정 필요)
    // S22CC: 외국인 순매수 → 양수=순매수, 음수=순매도
    // 3개월 이동평균으로 노이즈 제거 후 방향성 판단
   const foreignNet = foreignNetRaw
  .filter(r => r.itemCode2 === "VA") // 거래대금만 사용, VO(거래량)는 제외
  .map(r => ({
    date: r.date?.slice(0,6) ?? r.date,
    value: +(r.value / 100).toFixed(0) // 백만원 → 억원
  }))
  .filter(r => r.date && r.value != null);
    // 3개월 이동평균
    const foreignNet3M = foreignNet.map((r, i) => {
      if (i < 2) return { ...r, ma3: null };
      const avg = (foreignNet[i].value + foreignNet[i-1].value + foreignNet[i-2].value) / 3;
      return { ...r, ma3: +avg.toFixed(0) };
    });
    const lastForeignNet3M = foreignNet3M.filter(r => r.ma3 != null).slice(-1)[0]?.ma3 ?? null;
    // 최근 3개월 연속 방향 판단
 const foreignNetTrend = (() => {
  const recent = foreignNet.slice(-3).map(r => r.value);
  if (recent.length < 3) return null;

  const avg = recent.reduce((a,b)=>a+b,0) / 3; // 3개월 평균 (억원)

  // 🔥 규모 기준 (먼저 체크)
  if (avg <= -100000) return -2; // -10조 이상 매도 → 매물폭탄
  if (avg <= -30000)  return -1; // -3조 이상 매도

  if (avg >= 100000) return +2; // +10조 이상 매수
  if (avg >= 30000)  return +1; // +3조 이상 매수

  // 📉 방향 기준 (보조)
  if (recent.every(v => v < 0)) return -2;
  if (recent.filter(v => v < 0).length >= 2) return -1;

  if (recent.every(v => v > 0)) return +2;
  if (recent.filter(v => v > 0).length >= 2) return +1;

  return 0;
})();
    
    // ── SEFCON 지표
    const last    = arr => arr?.slice(-1)[0]?.value ?? null;
    const lastYoy = arr => [...(arr||[])].reverse().find(r=>r.yoy!=null)?.yoy ?? null;

    const scoreV = (v, [bad2, bad1, good1, good2], dir = 1) => {
      if (v == null) return 0;
      if (v * dir >= bad2  * dir) return -2;
      if (v * dir >= bad1  * dir) return -1;
      if (v * dir <= good2 * dir) return +2;
      if (v * dir <= good1 * dir) return +1;
      return 0;
    };

    const indicators = [
      // ── 신용위험 (6개)
      // T10Y2Y: 12~18개월 선행 → ×2 유지
      { cat:"신용위험", key:"미국금리역전", label:"미국 장단기금리차(T10Y2Y)", val:lastFRED(fredT10Y2Y), unit:"%",
        good:"정상", warn:"평탄", bad:"역전",
        score: scoreV(lastFRED(fredT10Y2Y), [-1.0, -0.5, 0.5, 1.0], -1) * 2 },
      // Baa스프레드: 6~12개월 선행 → ×1.5
      { cat:"신용위험", key:"하이일드", label:"미국 Baa 신용스프레드", val:lastFRED(fredHY), unit:"%p",
        good:"안정", warn:"경계", bad:"급등",
        score: Math.round(scoreV(lastFRED(fredHY), [4.0, 3.0, 2.0, 1.5], 1) * 1.5) },
      { cat:"신용위험", key:"금리차KR", label:"한국 10Y-3Y 금리차", val:last(yieldSpread), unit:"%p",
        good:"정상화", warn:"평탄", bad:"역전",
        score: scoreV(last(yieldSpread), [-0.5, 0.0, 0.5, 1.0], -1) },
      // HY스프레드: 6~12개월 선행 → ×1.5
      { cat:"신용위험", key:"HY스프레드", label:"ICE BofA HY 스프레드", val:lastFRED(fredBAML), unit:"%p",
        good:"안정", warn:"경계", bad:"위기",
        score: Math.round(scoreV(lastFRED(fredBAML), [9.0, 6.0, 4.0, 3.0], 1) * 1.5) },
      { cat:"신용위험", key:"미국SLOOS", label:"미국 SLOOS 대출기준강화", val:lastFRED(fredSLOOS), unit:"%",
        good:"완화", warn:"중립", bad:"강화",
        score: scoreV(lastFRED(fredSLOOS), [50, 20, -5, -20], 1) },
      { cat:"신용위험", key:"한국SLOOS", label:"한국 은행 대출태도지수", val:last(krSloos), unit:"",
        good:"완화", warn:"중립", bad:"강화",
        score: scoreV(last(krSloos), [40, 20, -5, -20], 1) },

      // ── 유동성 (6개)
      { cat:"유동성", key:"미국M2", label:"미국 M2 통화량 YoY", val:lastYoy(usM2YoY), unit:"%",
        good:"양호", warn:"주의", bad:"긴축/버블",
        score: (()=>{const v=lastYoy(usM2YoY);if(v==null)return 0;if(v<-2)return -2;if(v<0)return -1;if(v<=5)return 0;if(v<=10)return +1;return 0;})() },
      { cat:"유동성", key:"한국M2", label:"한국 M2 통화량 YoY", val:lastYoy(krM2YoY), unit:"%",
        good:"양호", warn:"주의", bad:"긴축/버블",
        score: (()=>{const v=lastYoy(krM2YoY);if(v==null)return 0;if(v<-2)return -2;if(v<0)return -1;if(v<=5)return 0;if(v<=10)return +1;return 0;})() },
      { cat:"유동성", key:"기준금리", label:"한국 기준금리", val:last(rate), unit:"%",
        good:"완화적", warn:"중립", bad:"긴축",
        score: scoreV(last(rate), [4.0, 3.0, 2.0, 1.0], 1) },
      { cat:"유동성", key:"환율", label:"원/달러 환율", val:last(fx), unit:"원",
        good:"강세", warn:"중립", bad:"약세",
        score: scoreV(last(fx), [1450, 1380, 1250, 1150], 1) },
      { cat:"유동성", key:"CD스프레드", label:"CD금리-기준금리 스프레드", val:last(cdSpread), unit:"%p",
        good:"안정", warn:"보통", bad:"확대",
        score: scoreV(last(cdSpread), [1.5, 1.0, 0.3, 0.1], 1) },
      { cat:"유동성", key:"가계부채GDP", label:"가계부채/GDP (ECOS협의)", val:last(hhDebtGDP), unit:"%",
        good:"안정", warn:"주의", bad:"과부하",
        score: scoreV(last(hhDebtGDP), [82, 75, 65, 60], 1) },

      // ── 시장공포 (3개)
      { cat:"시장공포", key:"VIX", label:"VIX 공포지수", val:lastFRED(fredVIX), unit:"",
        good:"안정", warn:"경계", bad:"공포",
        score: scoreV(lastFRED(fredVIX), [35, 25, 18, 13], 1) },
      { cat:"시장공포", key:"BSI", label:"BSI 제조업", val:last(bsi), unit:"",
        good:"확장", warn:"중립", bad:"수축",
        score: scoreV(last(bsi), [80, 90, 100, 110], -1) },
      { cat:"시장공포", key:"DXY", label:"DXY 달러인덱스", val:last(yahooDXY), unit:"",
        good:"약세", warn:"중립", bad:"강세",
        score: scoreV(last(yahooDXY), [108, 104, 100, 97], 1) },
      // 외국인 KOSPI 순매수: 3개월 연속 방향성으로 판단
      // 순매도 지속 = 외국인 이탈 = 시장공포/위험 신호
      { cat:"시장공포", key:"외국인순매수", label:"외국인 KOSPI 순매수 추이",
        val: lastForeignNet3M == null ? null : (()=>{
          const a=Math.abs(lastForeignNet3M); const s=lastForeignNet3M>=0?"+":"-";
          return a>=10000?`${s}${(a/10000).toFixed(1)}조`:`${s}${Math.round(a).toLocaleString()}억`;
        })(),
        unit:"",
        good:"순매수", warn:"혼조", bad:"순매도",
        score: foreignNetTrend ?? 0 },

      // ── 실물경기 (6개)
      { cat:"실물경기", key:"수출", label:"한국 수출 YoY", val:lastYoy(exportYoY), unit:"%",
        good:"증가", warn:"보합", bad:"감소",
        score: scoreV(lastYoy(exportYoY), [-15, -5, 5, 15], -1) },
      { cat:"실물경기", key:"ICSA", label:"주간 실업청구(천건)", val:lastFRED(fredICSA), unit:"k",
        good:"안정", warn:"증가", bad:"급등",
        score: scoreV(lastFRED(fredICSA), [300, 250, 210, 180], 1) },
      // UNRATE: 후행지표·ICSA 중복 → score:0 고정, 화면 표시·그래프 참고용만
      { cat:"실물경기", key:"UNRATE", label:"미국 실업률 (참고)", val:fredUNRATEMonthly.slice(-1)[0]?.value??null, unit:"%",
        good:"호조", warn:"상승", bad:"침체",
        score: 0 },
      { cat:"실물경기", key:"GDP", label:"한국 GDP성장률", val:lastYoy(gdp), unit:"%",
        good:"견조", warn:"완만", bad:"침체",
        score: scoreV(lastYoy(gdp), [-1, 1, 3, 4], -1) },
      // LEI: 6개월 선행 → ×1.5
      { cat:"실물경기", key:"LEI", label:"미국 LEI 경기선행지수", val:lastFRED(fredLEI), unit:"",
        good:"확장", warn:"둔화", bad:"수축",
        score: Math.round(scoreV(lastFRED(fredLEI), [98, 99, 100.5, 101.5], -1) * 1.5) },
      { cat:"실물경기", key:"구리금", label:"구리/금 비율(×1000)", val:last(copperGold), unit:"",
        good:"강세", warn:"중립", bad:"약세",
        score: scoreV(last(copperGold), [0.15, 0.18, 0.25, 0.30], -1) },

      // ── 물가 (3개) — 후행지표, 카테고리 가중치로 영향 조정
      { cat:"물가", key:"CPI", label:"한국 CPI YoY", val:lastYoy(cpi), unit:"%",
        good:"안정", warn:"보통", bad:"고인플",
        score: scoreV(lastYoy(cpi), [5, 3, 1, 0], 1) },
      { cat:"물가", key:"PPI", label:"한국 PPI YoY", val:lastYoy(ppi), unit:"%",
        good:"안정", warn:"보통", bad:"원가↑",
        score: scoreV(lastYoy(ppi), [6, 3, 1, 0], 1) },
      { cat:"물가", key:"가계신용", label:"가계신용 YoY", val:lastYoy(hhCreditYoY), unit:"%",
        good:"감소", warn:"완만", bad:"과열",
        score: scoreV(lastYoy(hhCreditYoY), [8, 5, 2, 0], 1) },
    ];

const defconData = calcDefcon(indicators);

const enhancedRisk = calcSequoiaCIndex(defconData);

// 로그 (개발용)
if (process.env.NODE_ENV !== "production") {
  console.log("SEFCON DEBUG", {
    originalScore: enhancedRisk.originalScore,
    adjustedScore: enhancedRisk.adjustedScore,
    clusterPenalty: enhancedRisk.clusterPenalty,
    triggerPenalty: enhancedRisk.triggerPenalty,
    confirmationPenalty: enhancedRisk.confirmationPenalty,
    clusterCount: enhancedRisk.clusterCount,
    crisisType: enhancedRisk.crisisType
  });
}

defconData.originalScore = enhancedRisk.originalScore;
defconData.adjustedScore = enhancedRisk.adjustedScore;
defconData.totalScore = enhancedRisk.adjustedScore;
defconData.defcon = enhancedRisk.defcon;

defconData.defconLabel = enhancedRisk.defconLabel;
defconData.defconColor = enhancedRisk.defconColor;
defconData.defconDesc = enhancedRisk.defconDesc;
defconData.enhancedRisk = enhancedRisk;
const crisisAnalysis = calcCrisisAnalysis(defconData);
const regimeInsight = buildRegimeInsight({ defconData, crisisAnalysis });
const v3Adjustment = calculateV3Adjustment({
  defconData,
  enhancedRisk,
  crisisAnalysis,
  regimeInsight,
  exportKospiAlignment,
});
applyV3AdjustmentToDefcon(defconData, v3Adjustment);

// ── 크라이시스 프록시미티 페널티 (역사적 위기 유사도 연동)
// 유사도가 높을수록 SEFCON 점수 추가 차감
// 최대 -9점, 상한 분리로 이중 페널티 방지
(()=>{
  const proximity = crisisAnalysis?.topCrisis?.similarity
    ?? crisisAnalysis?.navigation?.proximityScore
    ?? 0;
  let crisisPenalty = 0;
  if      (proximity >= 90) crisisPenalty = 9;
  else if (proximity >= 80) crisisPenalty = 6;
  else if (proximity >= 70) crisisPenalty = 3;

  if (crisisPenalty > 0) {
    const beforeScore = defconData.totalScore;
    const afterScore  = Math.max(0, beforeScore - crisisPenalty);
    const d = defconFromScore(afterScore);
    defconData.totalScore    = afterScore;
    defconData.adjustedScore = afterScore;
    defconData.defcon        = d.defcon;
    defconData.defconLabel   = d.defconLabel;
    defconData.defconColor   = d.defconColor;
    defconData.defconDesc    = `${d.defconDesc} · 역사적 유사도 ${Math.round(proximity)}% 반영 -${crisisPenalty}점`;
    defconData.crisisPenalty = crisisPenalty;
    defconData.crisisProximity = Math.round(proximity);
    console.info(`[SEFCON] 크라이시스 페널티 적용: ${beforeScore}→${afterScore} (-${crisisPenalty}pt, 유사도${Math.round(proximity)}%)`);
  }
})();

// ─────────────────────────────────────────────
// SEFCON v2.0 Core Engine
// 기존 SEFCON 점수를 실제로 보정하여 최종 단계를 바꾸는 핵심엔진
// ─────────────────────────────────────────────
function calcSequoiaCIndex(defconData) {
  const indicators = defconData.indicators || [];

  const getScore = (keyword) =>
    indicators.find(i =>
      i.key?.includes(keyword) ||
      i.label?.includes(keyword)
    )?.score ?? 0;

  const hasRisk = (keyword, threshold = -1) => getScore(keyword) <= threshold;

  // 핵심 위험 신호
  const foreignSell  = hasRisk("외국인", -2);
  const fxStress     = hasRisk("환율", -1);
  const vixStress    = hasRisk("VIX", -1);
  const hyStress     = hasRisk("HY", -1) || hasRisk("하이일드", -1);
  const cdStress     = hasRisk("CD", -1);
  const creditStress = hyStress || cdStress;
  const dxyStress    = hasRisk("DXY", -1);
  const sloosStress  = hasRisk("SLOOS", -1);
  const leiStress    = hasRisk("LEI", -1);
  const exportStress = hasRisk("수출", -1);

  // 1) 클러스터 페널티: 위험 신호가 동시에 켜질수록 점수 차감
  const clusterCount = [
    foreignSell,
    fxStress,
    vixStress,
    creditStress,
    dxyStress,
    sloosStress,
    leiStress,
    exportStress
  ].filter(Boolean).length;

  let clusterPenalty = 0;
  if (clusterCount >= 2) clusterPenalty += 3;
  if (clusterCount >= 3) clusterPenalty += 6;
  if (clusterCount >= 4) clusterPenalty += 10;

  // 2) 조합 페널티: 금융위기형 조합은 추가 차감
  let triggerPenalty = 0;

  if (foreignSell && fxStress) triggerPenalty += 6;              // 외국인 이탈 + 환율
  if (vixStress && creditStress) triggerPenalty += 7;            // 공포 + 신용경색
  if (fxStress && dxyStress) triggerPenalty += 4;                // 달러 강세 + 원화 약세
  if (foreignSell && fxStress && vixStress) triggerPenalty += 5; // 리스크오프 클러스터
  if (creditStress && sloosStress) triggerPenalty += 5;          // 신용조건 악화

  // 3) 확인 페널티: 실물까지 꺾이면 추가 차감
  let confirmationPenalty = 0;
  if (leiStress) confirmationPenalty += 3;
  if (exportStress) confirmationPenalty += 3;
  if (leiStress && exportStress) confirmationPenalty += 3;

  // 총 페널티
  const totalPenalty = Math.min(
    30,
    clusterPenalty + triggerPenalty + confirmationPenalty
  );

  // 기존 SEFCON 점수 보정
  const originalScore = defconData.totalScore;
  const adjustedScore = Math.max(0, Math.min(100, originalScore - totalPenalty));

  // C-Index: 위험도 지수. 높을수록 위험
  const cIndex = Math.max(0, Math.min(100, 100 - adjustedScore));

  // 보정된 SEFCON 단계 재산출
  let defcon, defconLabel, defconColor, defconDesc;

  if (adjustedScore <= 30) {
    defcon = 1;
    defconLabel = "SEFCON 1  붕괴임박";
    defconColor = "#FF1A1A";
    defconDesc = "복수의 위기 신호가 동시 발생. 현금 비중 최우선. 시스템 리스크 구간";
  } else if (adjustedScore <= 45) {
    defcon = 2;
    defconLabel = "SEFCON 2  위기";
    defconColor = "#FF6B00";
    defconDesc = "선행지표와 트리거가 동시 악화. 리스크 자산 비중 축소 검토";
  } else if (adjustedScore <= 58) {
    defcon = 3;
    defconLabel = "SEFCON 3  경계";
    defconColor = "#F0C800";
    defconDesc = "일부 위기 조합 감지. 포트폴리오 방어 태세 필요";
  } else if (adjustedScore <= 72) {
    defcon = 4;
    defconLabel = "SEFCON 4  관망";
    defconColor = "#38BDF8";
    defconDesc = "대체로 양호하나 일부 위험 신호 관찰";
  } else {
    defcon = 5;
    defconLabel = "SEFCON 5  안정";
    defconColor = "#00C878";
    defconDesc = "전반적 위험 신호 제한적. 적극적 투자 환경";
  }

  // 위기 유형
  let crisisType = "혼합형";
  if (foreignSell && fxStress && vixStress) crisisType = "외국인 이탈형 / 환율 스트레스형";
  else if (vixStress && creditStress) crisisType = "신용경색형";
  else if (fxStress && dxyStress) crisisType = "달러 유동성 압박형";
  else if (leiStress && exportStress) crisisType = "실물경기 둔화형";
  else if (foreignSell && fxStress) crisisType = "외국인 이탈형";

  const confidence = Math.min(
    95,
    Math.max(45, 50 + clusterCount * 5 + Math.round(totalPenalty / 2))
  );

  const topDrivers = [];
  if (foreignSell) topDrivers.push("외국인 순매도 압력");
  if (fxStress) topDrivers.push("원/달러 환율 스트레스");
  if (vixStress) topDrivers.push("시장공포 확대");
  if (creditStress) topDrivers.push("신용스프레드 악화");
  if (dxyStress) topDrivers.push("달러 강세 압력");
  if (sloosStress) topDrivers.push("대출기준 강화");
  if (leiStress) topDrivers.push("경기선행지수 둔화");
  if (exportStress) topDrivers.push("수출 둔화");

  return {
    originalScore,
    adjustedScore,
    cIndex,
    totalPenalty,
    clusterPenalty,
    triggerPenalty,
    confirmationPenalty,
    clusterCount,
    crisisType,
    confidence,
    topDrivers,
    defcon,
    defconLabel,
    defconColor,
    defconDesc
  };
}
    
    // ── Core Intelligence 인라인 계산 (snapshot 저장용)
    // src/ 파일 import 없이 macro.js 내부에서 직접 계산
    const coreIntel = (() => {
      try {
        const dc  = defconData || {};
        const cats = dc.catScores || [];
        const catScore = name => (cats.find(c => c.cat === name)?.score ?? 50);
        const clamp01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));

        // State
        const lastFX    = (fx||[]).slice(-1)[0]?.value ?? 1300;
        const lastT10   = (fredT10Y2Y||[]).slice(-1)[0]?.value ?? 0;
        const lastHY    = (fredHY||[]).slice(-1)[0]?.value ?? 2;
        const lastVIX   = (fredVIX||[]).slice(-1)[0]?.value ?? 20;
        const lastSLOOS = (fredSLOOS||[]).slice(-1)[0]?.value ?? 0;
        const lastLEI   = (fredLEI||[]).slice(-1)[0]?.value ?? 100;

        const creditRisk      = clamp01(1 - catScore("신용위험") / 100);
        const liquidityRisk   = clamp01(1 - catScore("유동성") / 100);
        const speculationRisk = clamp01(1 - catScore("시장공포") / 100);
        const macroRisk       = clamp01(1 - catScore("실물경기") / 100);
        const volatilityRisk  = clamp01(clamp01((lastVIX - 12) / 40) * 0.6 + speculationRisk * 0.4);
        const valuationRisk   = clamp01(clamp01(lastHY / 5) * 0.6 + creditRisk * 0.4);
        const sefBase         = dc.totalScore != null ? clamp01(1 - dc.totalScore / 100) : 0.5;
        const totalRisk       = clamp01(sefBase * 0.6 + (creditRisk + liquidityRisk + speculationRisk + macroRisk) / 4 * 0.4);

        const state = { creditRisk, liquidityRisk, speculationRisk, macroRisk, volatilityRisk, valuationRisk, totalRisk, sefconLevel: dc.defcon ?? 3, sefconScore: dc.totalScore ?? 50 };

        // Physics (한국 기준)
        const liquidityPressure = clamp01(clamp01((lastFX - 1200) / 400) * 0.5 + liquidityRisk * 0.5);
        const valuationGravity  = clamp01(clamp01(lastHY / 5) * 0.6 + clamp01((lastFX - 1200) / 400) * 0.4);
        const creditStress      = clamp01(creditRisk * 0.7 + clamp01(lastSLOOS / 50) * 0.3);
        const volatilityEnergy  = clamp01(clamp01((20 - lastVIX) / 15) * 0.5 + volatilityRisk * 0.5);
        const forces = [["유동성 압력", liquidityPressure], ["밸류 중력", valuationGravity], ["신용 응력", creditStress], ["변동성 에너지", volatilityEnergy]];
        const dominantForce = forces.reduce((a, b) => a[1] > b[1] ? a : b)[0];
        const physics = { liquidityPressure, valuationGravity, creditStress, volatilityEnergy, dominantForce };

        // Temporal (간이)
        const riskDir = totalRisk > 0.6 ? "악화" : totalRisk < 0.35 ? "개선" : "횡보";
        const temporal = { riskAcceleration: totalRisk > 0.55 ? 0.2 : totalRisk < 0.35 ? -0.2 : 0, labels: { riskAcceleration: riskDir } };

        // Regime
        const regime = {
          primaryLabel: regimeInsight?.primaryLabel ?? dc.defconLabel?.split("  ").slice(-1)[0] ?? "혼합",
          direction:    dc.defcon <= 2 ? "악화" : dc.defcon >= 4 ? "개선" : "유지",
          transitionPath: regimeInsight?.transitionPath ?? null,
          statePhrase:  totalRisk > 0.7 ? "고위험 국면" : totalRisk > 0.5 ? "경계 국면" : totalRisk > 0.35 ? "중립 국면" : "안정 국면",
        };

        // Interpretation
        const summary = `한국 시장은 ${regime.primaryLabel} 국면으로, ${dominantForce}이 지배적인 환경입니다. SEFCON ${dc.defcon ?? 3}단계 (점수 ${dc.totalScore ?? 50}).`;
        const interpretation = { summary, direction: riskDir, riskScore: Math.round(totalRisk * 100) };

        // Strategy
        const sefLv = dc.defcon ?? 3;
        const cashBias = sefLv <= 1 ? 70 : sefLv === 2 ? 50 : sefLv === 3 ? 30 : sefLv === 4 ? 15 : 10;
        const strategy = {
          cashBias,
          defenseBias: Math.round(totalRisk * 70 + liquidityPressure * 30),
          growthExposure: Math.round((1 - totalRisk) * 80),
          riskLevel: totalRisk > 0.75 ? "매우 높음" : totalRisk > 0.55 ? "높음" : totalRisk > 0.35 ? "보통" : "낮음",
          message: cashBias >= 50 ? "현금 비중 확대, 방어자산 중심 재편." : cashBias >= 25 ? "선별적 운용, 방어섹터 비중 유지." : "우량주 중심 적극 운용 가능.",
          actions: [],
        };

        return { state, physics, temporal, regime, interpretation, strategy };
      } catch (e) {
        console.warn("[coreIntel inline]", e.message);
        return null;
      }
    })();

    const data = {
      gdp, gdpLevel, dailyExport, exportYoY, exportKospiAlignment,
      rate, fx, ppi, cpi, bsi,
      kospiMonthly, kosdaqMonthly,
      hhCreditYoY, yieldSpread,
      fredT10Y2Y, fredHY, fredVIX, fredUNRATE, fredUNRATEMonthly,
      fredSLOOS, krSloos, fredLEI, fredICSA, fredBAML,
      yahooBIZD, yahooDXY, copperGold, yahooHG, yahooGC,
      cdSpread, hhDebtGDP,
      usM2YoY, krM2YoY,
      foreignNet, foreignNet3M,
      defconData,
      crisisAnalysis,
      regimeInsight,
      v3Adjustment,
      coreIntel,
      updatedAt: Date.now(),
      _debug: {
        gdp:gdpArr.length, export:exportArr.length, rate:rateArr.length,
        fx:fxArr.length, ppi:ppiArr.length, bsi:bsiArr.length, cpi:cpiArr.length,
        kospi:kospiMonthly.length, kosdaq:kosdaqMonthly.length,
        hhCredit:hhCreditArr.length, bond10Y:bond10YArr.length, bond3Y:bond3YArr.length,
        fredT10Y2Y:fredT10Y2YRaw.length, fredHY:fredHYRaw.length, fredDGS10:fredDGS10Raw.length,
        fredVIX:fredVIXRaw.length, fredUNRATE:fredUNRATE.length,
        krSloos:krSloosRaw.length, fredSLOOS:fredSLOOSRaw.length, fredLEI:fredLEIRaw.length, fredICSA:fredICSARaw.length,
        // ── BAML/M2 진단 ──
        fredBAML_raw:fredBAMLRaw.length,       // 0이면 FRED API 호출 자체 실패
        fredBAML_monthly:fredBAML.length,       // 0이면 dailyToMonthly 후 소실 ("." 문제)
        fredBAML_sample:fredBAMLRaw.slice(-3),  // 실제 값 형태 확인용
        fredM2SL_raw:fredM2SLRaw.length,        // 0이면 FRED M2SL 호출 실패
        usM2_parsed:usM2.length,                // 0이면 날짜 파싱 버그
        usM2YoY_len:usM2YoY.length,
        usM2_sample:fredM2SLRaw.slice(-3),      // raw 날짜 형태 확인용
        usM2_parsed_sample:usM2.slice(-3),      // 파싱 후 날짜 형태 확인용
        // ──────────────────
        fredSamples:{
          t10y2y:fredT10Y2YRaw.slice(-2),
          baa:fredHYRaw.slice(-2),
          dgs10:fredDGS10Raw.slice(-2),
          lei:fredLEIRaw.slice(-2),
        },
        yahooBIZD:yahooBIZDRaw.length, yahooDXY:yahooDXYRaw.length,
        yahooHG:yahooHGRaw.length, yahooGC:yahooGCRaw.length,
        cdSpread:cdSpread.length, hhDebtGDP:hhDebtGDP.length, nominalGdp:nominalGdpArr.length,
        usM2:fredM2SLRaw.length, krM2:ecosKrM2Raw.length,
        foreignNet:foreignNetRaw.length,
      }
    };

    cache = { data, ts: Date.now() };
    return res.status(200).json(data);

  } catch (e) {
    console.error("[macro]", e.message);
    if (cache.data) return res.status(200).json(cache.data);
    return res.status(500).json({ error: e.message });
  }
}
