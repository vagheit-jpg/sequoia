// api/macro.js — ECOS 거시경제 (검증된 시리즈 코드만 사용)
const ECOS_KEY = process.env.ECOS_API_KEY || "";
const CACHE_TTL = 6 * 60 * 60 * 1000;

let cache = { data: null, ts: 0 };

async function fetchECOS(statCode, itemCode, startDate, endDate, freq = "MM") {
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/200/${statCode}/${freq}/${startDate}/${endDate}/${itemCode}`;
  const res = await fetch(url);
  const json = await res.json();
  // ECOS는 에러도 200으로 반환 — RESULT 코드 확인
  if (json?.RESULT?.CODE && json.RESULT.CODE !== "INFO-000") {
    console.warn(`[ECOS] ${statCode}/${itemCode}: ${json.RESULT.MESSAGE}`);
    return [];
  }
  const rows = json?.StatisticSearch?.row || [];
  return rows.map(r => ({ date: r.TIME, value: parseFloat(r.DATA_VALUE) }))
             .filter(r => !isNaN(r.value));
}

function calcMonthlyYoY(arr) {
  return arr.map((r, i) => {
    if (i < 12) return { ...r, yoy: null };
    const base = arr[i - 12]?.value;
    return { ...r, yoy: base ? +((r.value / base - 1) * 100).toFixed(1) : null };
  });
}

function calcQuarterlyYoY(arr) {
  return arr.map((r, i) => {
    const prevYear = String(parseInt(r.date.slice(0, 4)) - 1) + r.date.slice(4);
    const prev = arr.find(p => p.date === prevYear);
    return { ...r, yoy: prev != null ? +(r.value - prev.value).toFixed(2) : null };
  });
}

// ECON DEFCON 점수 계산
function calcDefcon(indicators) {
  const totalScore = indicators.reduce((s, d) => s + d.score, 0);
  const maxScore   = indicators.length * 2;

  let defcon, defconLabel, defconColor, defconDesc;
  if      (totalScore <= -10) { defcon=1; defconLabel="ECON-1  위기"; defconColor="#FF1A1A"; defconDesc="복수의 위기 신호 동시 발생. 현금 비중 최우선"; }
  else if (totalScore <=  -5) { defcon=2; defconLabel="ECON-2  경계"; defconColor="#FF6B00"; defconDesc="선행지표 다수 경고. 리스크 자산 비중 축소 검토"; }
  else if (totalScore <=   1) { defcon=3; defconLabel="ECON-3  주의"; defconColor="#F0C800"; defconDesc="일부 지표 악화. 포트폴리오 점검 필요"; }
  else if (totalScore <=   7) { defcon=4; defconLabel="ECON-4  관망"; defconColor="#38BDF8"; defconDesc="대체로 양호. 선별적 기회 탐색"; }
  else                        { defcon=5; defconLabel="ECON-5  안정"; defconColor="#00C878"; defconDesc="전 지표 정상. 적극적 투자 환경"; }

  return { defcon, defconLabel, defconColor, defconDesc, totalScore, maxScore, indicators };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");

  if (Date.now() - cache.ts < CACHE_TTL && cache.data) {
    return res.status(200).json(cache.data);
  }

  try {
    const now    = new Date();
    const endY   = now.getFullYear();
    const endM   = String(now.getMonth() + 1).padStart(2, "0");
    const endDate  = `${endY}${endM}`;
    const startDate  = `${endY - 8}01`;
    const startDateQ = `${endY - 8}Q1`;

    // ── 핵심 6개만 (ECOS 공식 확인된 코드)
    const [gdpR, exportR, rateR, fxR, ppiR, bsiR, cpiR] =
      await Promise.allSettled([
        // 실질GDP 성장률 전기비(%)  통계표 111Y002, 항목 C0000
        fetchECOS("111Y002", "C0000",   startDateQ,    `${endY}Q4`, "QQ"),
        // 수출금액 통관기준 (백만달러)  901Y012 / 0000001
        fetchECOS("901Y012", "0000001", startDate,     endDate,     "MM"),
        // 한국은행 기준금리 (%)  722Y001 / 0101000
        fetchECOS("722Y001", "0101000", startDate,     endDate,     "MM"),
        // 원달러 환율 월평균  731Y004 / 0000001
        fetchECOS("731Y004", "0000001", startDate,     endDate,     "MM"),
        // 생산자물가지수 총지수 (2020=100)  404Y014 / *AA
        fetchECOS("404Y014", "*AA",     startDate,     endDate,     "MM"),
        // BSI 제조업 업황실적  512Y004 / AA
        fetchECOS("512Y004", "AA",      startDate,     endDate,     "MM"),
        // 소비자물가지수 총지수 (2020=100)  021Y126 / 0
        fetchECOS("021Y126", "0",       startDate,     endDate,     "MM"),
      ]);

    const ok = r => r.status === "fulfilled" ? r.value : [];

    const gdpArr    = ok(gdpR);
    const exportArr = ok(exportR);
    const rateArr   = ok(rateR);
    const fxArr     = ok(fxR);
    const ppiArr    = ok(ppiR);
    const bsiArr    = ok(bsiR);
    const cpiArr    = ok(cpiR);

    // ── 가공
    const gdp         = calcQuarterlyYoY(gdpArr);
    const gdpLevel    = gdpArr;
    const dailyExport = exportArr.map(r => ({ date: r.date, value: +(r.value / 21).toFixed(1) }));
    const exportYoY   = calcMonthlyYoY(dailyExport);
    const rate        = rateArr;
    const fx          = fxArr;
    const ppi         = calcMonthlyYoY(ppiArr);
    const bsi         = bsiArr;
    const cpi         = calcMonthlyYoY(cpiArr);

    // ── 최신값
    const last    = arr => arr?.slice(-1)[0]?.value ?? null;
    const lastYoy = arr => [...(arr || [])].reverse().find(r => r.yoy != null)?.yoy ?? null;

    const lastRate_v    = last(rate);
    const lastFX_v      = last(fx);
    const lastGDP_v     = lastYoy(gdp);
    const lastPPI_v     = lastYoy(ppi);
    const lastCPI_v     = lastYoy(cpi);
    const lastBSI_v     = last(bsi);
    const lastExYoY_v   = lastYoy(exportYoY);

    // ── 점수 함수: dir=1이면 높을수록 위기, dir=-1이면 낮을수록 위기
    const score = (v, [crit, warn, ok_], dir = 1) => {
      if (v == null) return 0;
      const d = dir;
      if (v * d >= crit * d) return -2;
      if (v * d >= warn * d) return -1;
      if (v * d <= ok_  * d) return +2;
      return 0;
    };

    const indicators = [
      { key:"금리",   label:"기준금리",       val:lastRate_v,  unit:"%",  good:"완화적", warn:"중립", bad:"긴축",
        score: score(lastRate_v,  [4.0, 3.0, 2.0],  1) },
      { key:"환율",   label:"원/달러 환율",   val:lastFX_v,    unit:"원", good:"강세",   warn:"중립", bad:"약세",
        score: score(lastFX_v,    [1450,1350,1200],  1) },
      { key:"GDP",    label:"GDP성장률(YoY)", val:lastGDP_v,   unit:"%",  good:"견조",   warn:"완만", bad:"침체",
        score: score(lastGDP_v,   [-1,  1,   3],    -1) },
      { key:"PPI",    label:"PPI YoY",        val:lastPPI_v,   unit:"%",  good:"안정",   warn:"보통", bad:"원가↑",
        score: score(lastPPI_v,   [6,   3,   1],     1) },
      { key:"CPI",    label:"소비자물가YoY",  val:lastCPI_v,   unit:"%",  good:"안정",   warn:"보통", bad:"고인플",
        score: score(lastCPI_v,   [5,   3,   1],     1) },
      { key:"BSI",    label:"BSI 제조업",     val:lastBSI_v,   unit:"",   good:"확장",   warn:"중립", bad:"수축",
        score: score(lastBSI_v,   [80,  90,  100],  -1) },
      { key:"수출",   label:"수출YoY",        val:lastExYoY_v, unit:"%",  good:"증가",   warn:"보합", bad:"감소",
        score: score(lastExYoY_v, [-15, -5,  5],    -1) },
    ];

    const defconData = calcDefcon(indicators);

    // ── 코스피 YoY용 병합 데이터는 프론트에서 계산
    const data = {
      gdp, gdpLevel, dailyExport, exportYoY,
      rate, fx, ppi, cpi, bsi,
      defconData,
      updatedAt: Date.now(),
      // 디버그: 각 지표 row 수
      _debug: {
        gdp: gdpArr.length, export: exportArr.length, rate: rateArr.length,
        fx: fxArr.length, ppi: ppiArr.length, bsi: bsiArr.length, cpi: cpiArr.length,
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
