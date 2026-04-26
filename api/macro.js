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

// ── ECON DEFCON
function calcDefcon(indicators) {
  const totalScore = indicators.reduce((s, d) => s + d.score, 0);
  const maxScore   = indicators.length * 2;
  let defcon, defconLabel, defconColor, defconDesc;
  if      (totalScore <= -13) { defcon=1; defconLabel="ECON-1  위기"; defconColor="#FF1A1A"; defconDesc="복수의 위기 신호 동시 발생. 현금 비중 최우선"; }
  else if (totalScore <=  -6) { defcon=2; defconLabel="ECON-2  경계"; defconColor="#FF6B00"; defconDesc="선행지표 다수 경고. 리스크 자산 비중 축소 검토"; }
  else if (totalScore <=   1) { defcon=3; defconLabel="ECON-3  주의"; defconColor="#F0C800"; defconDesc="일부 지표 악화. 포트폴리오 점검 필요"; }
  else if (totalScore <=   9) { defcon=4; defconLabel="ECON-4  관망"; defconColor="#38BDF8"; defconDesc="대체로 양호. 선별적 기회 탐색"; }
  else                        { defcon=5; defconLabel="ECON-5  안정"; defconColor="#00C878"; defconDesc="전 지표 정상. 적극적 투자 환경"; }
  return { defcon, defconLabel, defconColor, defconDesc, totalScore, maxScore, indicators };
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

    // ── 병렬 호출: ECOS 9개 + Yahoo 지수 2개
    const [gdpR, exportR, rateR, fxR, ppiR, bsiR, cpiR, kospiR, kosdaqR, hhCreditR, bond10YR, bond3YR] =
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
    const bsi         = bsiArr;
    const cpi         = calcMonthlyYoY(cpiArr);

    // ── 가계신용 YoY (분기, 전년동기비 %)
    const hhCreditYoY = calcQuarterlyYoY(hhCreditArr);

    // ── 장단기 금리차: 국고채 10Y − 3Y (월별, %p)
    const yieldSpread = bond10YArr.map(r => {
      const b3 = bond3YArr.find(b => b.date === r.date);
      return b3 != null ? { date: r.date, value: +(r.value - b3.value).toFixed(2) } : null;
    }).filter(Boolean);

    // ── DEFCON 지표
    const last    = arr => arr?.slice(-1)[0]?.value ?? null;
    const lastYoy = arr => [...(arr||[])].reverse().find(r=>r.yoy!=null)?.yoy ?? null;

    const score = (v, [crit, warn, ok_], dir = 1) => {
      if (v == null) return 0;
      if (v * dir >= crit * dir) return -2;
      if (v * dir >= warn * dir) return -1;
      if (v * dir <= ok_  * dir) return +2;
      return 0;
    };

    const indicators = [
      { key:"금리", label:"기준금리",       val:last(rate),         unit:"%",  good:"완화적", warn:"중립", bad:"긴축",
        score: score(last(rate),         [4.0,3.0,2.0],  1) },
      { key:"환율", label:"원/달러 환율",   val:last(fx),           unit:"원", good:"강세",   warn:"중립", bad:"약세",
        score: score(last(fx),           [1450,1350,1200],1) },
      { key:"GDP",  label:"GDP성장률(YoY)", val:lastYoy(gdp),       unit:"%",  good:"견조",   warn:"완만", bad:"침체",
        score: score(lastYoy(gdp),       [-1,1,3],       -1) },
      { key:"PPI",  label:"PPI YoY",        val:lastYoy(ppi),       unit:"%",  good:"안정",   warn:"보통", bad:"원가↑",
        score: score(lastYoy(ppi),       [6,3,1],         1) },
      { key:"CPI",  label:"소비자물가YoY",  val:lastYoy(cpi),       unit:"%",  good:"안정",   warn:"보통", bad:"고인플",
        score: score(lastYoy(cpi),       [5,3,1],         1) },
      { key:"BSI",  label:"BSI 제조업",     val:last(bsi),          unit:"",   good:"확장",   warn:"중립", bad:"수축",
        score: score(last(bsi),          [80,90,100],    -1) },
      { key:"수출", label:"수출YoY",        val:lastYoy(exportYoY), unit:"%",  good:"증가",   warn:"보합", bad:"감소",
        score: score(lastYoy(exportYoY), [-15,-5,5],     -1) },
      { key:"가계신용", label:"가계신용YoY", val:lastYoy(hhCreditYoY), unit:"%", good:"감소",  warn:"완만", bad:"과열",
        score: score(lastYoy(hhCreditYoY), [8,5,2], 1) },
      { key:"금리차", label:"10Y-3Y 금리차", val:last(yieldSpread),   unit:"%p", good:"정상화", warn:"평탄", bad:"역전",
        score: score(last(yieldSpread), [-0.5,0,0.5], -1) },
    ];

    const defconData = calcDefcon(indicators);

    const data = {
      gdp, gdpLevel, dailyExport, exportYoY,
      rate, fx, ppi, cpi, bsi,
      kospiMonthly, kosdaqMonthly,
      hhCreditYoY, yieldSpread,
      defconData,
      updatedAt: Date.now(),
      _debug: {
        gdp:gdpArr.length, export:exportArr.length, rate:rateArr.length,
        fx:fxArr.length, ppi:ppiArr.length, bsi:bsiArr.length, cpi:cpiArr.length,
        kospi:kospiMonthly.length, kosdaq:kosdaqMonthly.length,
        hhCredit:hhCreditArr.length, bond10Y:bond10YArr.length, bond3Y:bond3YArr.length,
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
