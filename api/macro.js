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
  return rows.map(r => ({ date: r.TIME, value: parseFloat(r.DATA_VALUE) }))
             .filter(r => !isNaN(r.value));
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
    console.warn(`[FRED] ${seriesId}: no observations`);
    return [];
  }
  return json.observations
    .map(r => ({ date: r.date.replace(/-/g, "").slice(0, 8), value: parseFloat(r.value) }))
    .filter(r => !isNaN(r.value));
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
  for (const r of arr) {
    const ym = r.date.slice(0, 6); // YYYYMMDD → YYYYMM
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
    // 신용위험5: T10Y2Y역전·Baa급등·금리차역전·BIZD급등·SLOOS강화 / 유동성4: 기준금리급등·환율폭락·CD스프레드폭등·DSR과열
    // 시장공포3: VIX급등·BSI폭락·DXY강세 / 실물경기5: 수출폭락·ICSA급등·GDP음전·LEI추락·구리금비율폭락 / 물가3: CPI급등·PPI급등·가계신용폭발
    cat: { 신용위험:8, 유동성:5, 시장공포:10, 실물경기:8, 물가:12 },
  },
  {
    id: "dotcom2000", label: "IT 버블 붕괴", date: "2000.03",
    defcon: 2, color: "#FF6B00",
    desc: "나스닥 -78%, 금리역전, 미국 기술주 버블 붕괴 → 한국 수출 타격",
    cat: { 신용위험:35, 유동성:28, 시장공포:25, 실물경기:48, 물가:40 },
  },
  {
    id: "gfc2008", label: "글로벌 금융위기", date: "2008.10",
    defcon: 1, color: "#FF1A1A",
    desc: "리만 붕괴, VIX 80 역대최고, Baa스프레드 4.2%p, 신용경색 전세계 확산",
    // Baa급등·SLOOS극한·T10Y2Y역전·BIZD급등·금리차역전 / 유동성압박 / VIX80·BSI폭락·DXY급등
    // 수출폭락·실업급등·GDP-4%·LEI추락·구리금폭락 / CPI급락(디플레방향)
    cat: { 신용위험:6, 유동성:15, 시장공포:4, 실물경기:10, 물가:22 },
  },
  {
    id: "europe2011", label: "유럽 재정위기", date: "2011.09",
    defcon: 2, color: "#FF6B00",
    desc: "PIIGS 국채위기, VIX 45, 신흥국 자금이탈, 원달러 급등",
    cat: { 신용위험:25, 유동성:22, 시장공포:18, 실물경기:38, 물가:35 },
  },
  {
    id: "covid2020", label: "코로나 충격", date: "2020.03",
    defcon: 2, color: "#FF6B00",
    desc: "VIX 66, 수출 -24%, 글로벌 봉쇄 → 역대급 유동성 공급으로 빠른 회복",
    // 신용위험: Baa급등·SLOOS강화 / 유동성: 완화적(공급폭발) / VIX66·BSI폭락
    // 수출-24%·실업14%·GDP급락·구리금비율폭락 / CPI안정(봉쇄효과)
    cat: { 신용위험:30, 유동성:55, 시장공포:8, 실물경기:12, 물가:65 },
  },
  {
    id: "tightening2022", label: "미국 긴축 위기", date: "2022.10",
    defcon: 3, color: "#F0C800",
    desc: "금리역전 -1.06%, 원달러 1,444원, PPI 10%, 레고랜드 PF 부실 동시 발생",
    // T10Y2Y -1.06 역전·Baa보통·금리차역전·SLOOS강화 / 기준금리급등·환율약세·DSR과열·CD스프레드확대
    // VIX30대·BSI수축·DXY강세 / 수출둔화·실업낮음·GDP약화·LEI하락·구리금약세
    // CPI·PPI 고점·가계신용완만
    cat: { 신용위험:28, 유동성:18, 시장공포:30, 실물경기:42, 물가:14 },
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
  const dist = Math.sqrt(sumSq); // 최대거리 ≈ sqrt(5*100^2) = 223
  const similarity = Math.max(0, Math.round((1 - dist / 180) * 100));
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

  return { results, top, top2, warnings };
}

// ── SEFCON
function calcDefcon(indicators) {
  const raw    = indicators.reduce((s, d) => s + d.score, 0);
  const maxRaw = indicators.reduce((s, d) => s + 2, 0);
  // 0~100점 환산 (50 = 중립)
  const totalScore = Math.round((raw + maxRaw) / (maxRaw * 2) * 100);
  const maxScore   = 100;

  // 카테고리별 점수
  const cats = ["신용위험","유동성","시장공포","실물경기","물가"];
  const catScores = cats.map(cat => {
    const inds   = indicators.filter(i => i.cat === cat);
    const catRaw = inds.reduce((s, i) => s + i.score, 0);
    const catMax = inds.length * 2;
    return { cat, score: catMax > 0 ? Math.round((catRaw + catMax) / (catMax * 2) * 100) : 50, count: inds.length };
  });

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
      ["환율",     "731Y003", "0000003", "D", "20220101", "20241231"],
      ["수출",     "901Y118", "T002",    "M", "202201",   "202412"  ],
      ["GDP",      "200Y102", "10111",   "Q", "2022Q1",   "2024Q4"  ],
      ["PPI",      "404Y014", "*AA",     "M", "202201",   "202412"  ],
      ["BSI",      "512Y013", "99988",   "M", "202201",   "202412"  ],
      ["CPI",      "901Y009", "0",       "M", "202201",   "202412"  ],
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

    // ── 병렬 호출: ECOS 14개 + Yahoo 지수+4개 + FRED 7개
    const [gdpR, exportR, rateR, fxR, ppiR, bsiR, cpiR, kospiR, kosdaqR, hhCreditR, bond10YR, bond3YR,
           fredT10Y2YR, fredHYR, fredDGS10R, fredVIXR, fredUNRATER,
           fredSLOOSR, fredLEIR, fredICSAR,
           yahooBIZDR, yahooDXYR, yahooHGR, yahooGCR,
           ecosCDR, ecosDSRR] =
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
        fetchECOS("151Y001", "1000000", startDateQ, `${endY}Q4`, "Q"),  // 가계신용 잔액(분기)
        fetchECOS("721Y001", "5050000", startDate,  endDate,     "M"),  // 국고채 10Y 수익률
        fetchECOS("721Y001", "5020000", startDate,  endDate,     "M"),  // 국고채 3Y 수익률
        fetchFRED("T10Y2Y",   `${endY - 3}-01-01`),                     // 미국 장단기 금리차
        fetchFRED("DBAA",     `${endY - 3}-01-01`),                     // 무디스 Baa 회사채
        fetchFRED("DGS10",    `${endY - 3}-01-01`),                     // 미국 10년 국채 수익률
        fetchVIXMonthly(),                                               // VIX (Yahoo)
        fetchFRED("UNRATE",   `${endY - 5}-01-01`),                     // 미국 실업률
        fetchFRED("DRTSCILM", `${endY - 5}-01-01`),                     // SLOOS 은행대출 기준강화 (신규)
        fetchFRED("USALOLITONOSTSAM", `${endY - 5}-01-01`),             // 미국 LEI 경기선행지수 (신규)
        fetchFRED("ICSA",     `${endY - 3}-01-01`),                     // 주간 실업청구건수 (신규, 일별→월별)
        fetchYahooMonthly("BIZD", 5),                                    // BIZD 사모신용 ETF (신규)
        fetchYahooMonthly("DX-Y.NYB", 5),                               // DXY 달러인덱스 (신규)
        fetchYahooMonthly("HG=F", 5),                                    // 구리 선물 (신규)
        fetchYahooMonthly("GC=F", 5),                                    // 금 선물 (신규)
        fetchECOS("721Y001", "5010000", startDate,  endDate,     "M"),  // CD 91일물 수익률 (신규)
        fetchECOS("152Y001", "M202301", startDateQ, `${endY}Q4`, "Q"),  // 가계부채 DSR (신규 — 분기)
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
    const fredSLOOSRaw  = ok(fredSLOOSR);
    const fredLEIRaw    = ok(fredLEIR);
    const fredICSARaw   = ok(fredICSAR);
    const yahooBIZDRaw  = ok(yahooBIZDR);
    const yahooDXYRaw   = ok(yahooDXYR);
    const yahooHGRaw    = ok(yahooHGR);
    const yahooGCRaw    = ok(yahooGCR);
    const ecosCDRaw     = ok(ecosCDR);
    const ecosDSRArr    = ok(ecosDSRR);

    // ── 가공
    // GDP: 이미 전기비% → yoy 필드로 매핑
    const gdp         = gdpArr.map(r => ({ ...r, yoy: r.value }));
    const gdpLevel    = gdpArr;
    // 수출: 천불 → 일평균$M (1천불/21일/1000 = $M)
    const dailyExport = exportArr.map(r => ({ date: r.date, value: +(r.value / 21000).toFixed(1) }));
    const exportYoY   = calcMonthlyYoY(dailyExport);
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
    // SLOOS: 일별 → 월별 (양수 = 대출기준 강화)
    const fredSLOOS = dailyToMonthly(fredSLOOSRaw);
    // LEI: 일별 → 월별 (OECD 선행지수, 100 기준)
    const fredLEI = dailyToMonthly(fredLEIRaw);
    // ICSA: 주간 실업청구 → 월별 (천명 단위)
    const fredICSA = dailyToMonthly(fredICSARaw.map(r => ({ ...r, value: +(r.value / 1000).toFixed(1) })));
    // BIZD ETF 가격 (사모신용 시장 프록시)
    const yahooBIZD = yahooBIZDRaw;
    // DXY 달러인덱스
    const yahooDXY = yahooDXYRaw;
    // 구리/금 비율 (월별 매칭)
    const yahooHG = yahooHGRaw;  // 구리 선물 ($/lb)
    const yahooGC = yahooGCRaw;  // 금 선물 ($/oz)
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
    // DSR (분기, 가계부채 원리금상환비율 %)
    const ecosDSR = ecosDSRArr;

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
      // ── 신용위험 (5개)
      { cat:"신용위험", key:"미국금리역전", label:"미국 장단기금리차(T10Y2Y)", val:lastFRED(fredT10Y2Y), unit:"%",
        good:"정상", warn:"평탄", bad:"역전",
        score: scoreV(lastFRED(fredT10Y2Y), [-1.0, -0.5, 0.5,  1.0], -1) * 2 }, // 가중 2배
      { cat:"신용위험", key:"하이일드",     label:"미국 Baa 신용스프레드",     val:lastFRED(fredHY),     unit:"%p",
        good:"안정", warn:"경계", bad:"급등",
        score: scoreV(lastFRED(fredHY),     [ 4.0,  3.0, 2.0,  1.5],  1) },
      { cat:"신용위험", key:"금리차KR",     label:"한국 10Y-3Y 금리차",       val:last(yieldSpread),    unit:"%p",
        good:"정상화", warn:"평탄", bad:"역전",
        score: scoreV(last(yieldSpread),    [-0.5,  0.0, 0.5,  1.0], -1) },
      { cat:"신용위험", key:"BIZD",         label:"BIZD 사모신용 ETF",        val:last(yahooBIZD),      unit:"$",
        good:"상승", warn:"보합", bad:"하락",
        // BIZD 하락 = 사모신용 스트레스 상승. 15달러 이하 위험, 18달러 이상 안정
        score: scoreV(last(yahooBIZD),      [13, 15, 18, 20], -1) },
      { cat:"신용위험", key:"SLOOS",        label:"SLOOS 은행대출 기준강화",  val:lastFRED(fredSLOOS),  unit:"%",
        good:"완화", warn:"중립", bad:"강화",
        // 양수 = 대출기준 강화(긴축). 50이상 극단, 20이상 경계
        score: scoreV(lastFRED(fredSLOOS),  [50, 20, -5, -20], 1) },

      // ── 유동성 (4개)
      { cat:"유동성", key:"기준금리", label:"한국 기준금리", val:last(rate), unit:"%",
        good:"완화적", warn:"중립", bad:"긴축",
        score: scoreV(last(rate), [4.0, 3.0, 2.0, 1.0], 1) },
      { cat:"유동성", key:"환율",     label:"원/달러 환율", val:last(fx),   unit:"원",
        good:"강세", warn:"중립", bad:"약세",
        score: scoreV(last(fx),   [1450, 1380, 1250, 1150], 1) },
      { cat:"유동성", key:"CD스프레드", label:"CD금리-기준금리 스프레드", val:last(cdSpread), unit:"%p",
        good:"안정", warn:"보통", bad:"확대",
        score: scoreV(last(cdSpread), [1.5, 1.0, 0.3, 0.1], 1) },
      { cat:"유동성", key:"DSR",      label:"가계부채 DSR",   val:last(ecosDSR), unit:"%",
        good:"안정", warn:"주의", bad:"과열",
        score: scoreV(last(ecosDSR), [45, 40, 30, 25], 1) },

      // ── 시장공포 (3개)
      { cat:"시장공포", key:"VIX", label:"VIX 공포지수",  val:lastFRED(fredVIX), unit:"",
        good:"안정", warn:"경계", bad:"공포",
        score: scoreV(lastFRED(fredVIX), [35, 25, 18, 13], 1) },
      { cat:"시장공포", key:"BSI", label:"BSI 제조업",    val:last(bsi),         unit:"",
        good:"확장", warn:"중립", bad:"수축",
        score: scoreV(last(bsi),         [80, 90, 100, 110], -1) },
      { cat:"시장공포", key:"DXY", label:"DXY 달러인덱스", val:last(yahooDXY),   unit:"",
        good:"약세", warn:"중립", bad:"강세",
        // 달러 강세 = 위험회피·신흥국 압박. 106이상 위험, 100이하 안정
        score: scoreV(last(yahooDXY), [108, 104, 100, 97], 1) },

      // ── 실물경기 (5개)
      { cat:"실물경기", key:"수출",   label:"한국 수출 YoY",       val:lastYoy(exportYoY),   unit:"%",
        good:"증가", warn:"보합", bad:"감소",
        score: scoreV(lastYoy(exportYoY),   [-15, -5,  5, 15], -1) },
      { cat:"실물경기", key:"ICSA",   label:"주간 실업청구(천건)",  val:lastFRED(fredICSA),  unit:"k",
        good:"안정", warn:"증가", bad:"급등",
        score: scoreV(lastFRED(fredICSA),   [300, 250, 210, 180], 1) },
      { cat:"실물경기", key:"GDP",    label:"한국 GDP성장률",       val:lastYoy(gdp),         unit:"%",
        good:"견조", warn:"완만", bad:"침체",
        score: scoreV(lastYoy(gdp),         [-1, 1, 3, 4], -1) },
      { cat:"실물경기", key:"LEI",    label:"미국 LEI 경기선행지수", val:lastFRED(fredLEI),  unit:"",
        good:"확장", warn:"둔화", bad:"수축",
        // OECD LEI: 100 기준. 99이하 둔화, 98이하 수축
        score: scoreV(lastFRED(fredLEI),    [98, 99, 100.5, 101.5], -1) },
      { cat:"실물경기", key:"구리금", label:"구리/금 비율(×1000)",   val:last(copperGold),   unit:"",
        good:"강세", warn:"중립", bad:"약세",
        // 구리금 상승 = 경기기대 양호. 하락 = 경기비관
        score: scoreV(last(copperGold),     [0.15, 0.18, 0.25, 0.30], -1) },

      // ── 물가 (3개)
      { cat:"물가", key:"CPI",    label:"한국 CPI YoY",   val:lastYoy(cpi),           unit:"%",
        good:"안정", warn:"보통", bad:"고인플",
        score: scoreV(lastYoy(cpi),           [5, 3, 1, 0], 1) },
      { cat:"물가", key:"PPI",    label:"한국 PPI YoY",   val:lastYoy(ppi),           unit:"%",
        good:"안정", warn:"보통", bad:"원가↑",
        score: scoreV(lastYoy(ppi),           [6, 3, 1, 0], 1) },
      { cat:"물가", key:"가계신용", label:"가계신용 YoY", val:lastYoy(hhCreditYoY),   unit:"%",
        good:"감소", warn:"완만", bad:"과열",
        score: scoreV(lastYoy(hhCreditYoY),   [8, 5, 2, 0], 1) },
    ];

    const defconData = calcDefcon(indicators);
    const crisisAnalysis = calcCrisisAnalysis(defconData);

    const data = {
      gdp, gdpLevel, dailyExport, exportYoY,
      rate, fx, ppi, cpi, bsi,
      kospiMonthly, kosdaqMonthly,
      hhCreditYoY, yieldSpread,
      fredT10Y2Y, fredHY, fredVIX, fredUNRATE,
      fredSLOOS, fredLEI, fredICSA,
      yahooBIZD, yahooDXY, copperGold, yahooHG, yahooGC,
      cdSpread, ecosDSR,
      defconData,
      crisisAnalysis,
      updatedAt: Date.now(),
      _debug: {
        gdp:gdpArr.length, export:exportArr.length, rate:rateArr.length,
        fx:fxArr.length, ppi:ppiArr.length, bsi:bsiArr.length, cpi:cpiArr.length,
        kospi:kospiMonthly.length, kosdaq:kosdaqMonthly.length,
        hhCredit:hhCreditArr.length, bond10Y:bond10YArr.length, bond3Y:bond3YArr.length,
        fredT10Y2Y:fredT10Y2YRaw.length, fredHY:fredHYRaw.length, fredDGS10:fredDGS10Raw.length,
        fredVIX:fredVIXRaw.length, fredUNRATE:fredUNRATE.length,
        fredSLOOS:fredSLOOSRaw.length, fredLEI:fredLEIRaw.length, fredICSA:fredICSARaw.length,
        yahooBIZD:yahooBIZDRaw.length, yahooDXY:yahooDXYRaw.length,
        yahooHG:yahooHGRaw.length, yahooGC:yahooGCRaw.length,
        cdSpread:cdSpread.length, ecosDSR:ecosDSRArr.length,
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
