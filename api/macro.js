// api/macro.js — ECOS 거시경제 데이터 (ECON DEFCON 포함)
const ECOS_KEY = process.env.ECOS_API_KEY || "";
const CACHE_TTL = 6 * 60 * 60 * 1000;

let cache = { data: null, ts: 0 };

async function fetchECOS(statCode, itemCode, startDate, endDate, freq = "MM") {
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/200/${statCode}/${freq}/${startDate}/${endDate}/${itemCode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ECOS ${statCode} HTTP ${res.status}`);
  const json = await res.json();
  const rows = json?.StatisticSearch?.row || [];
  return rows.map(r => ({ date: r.TIME, value: parseFloat(r.DATA_VALUE) })).filter(r => !isNaN(r.value));
}

function calcYoY(arr) {
  return arr.map(r => {
    const prev = arr.find(p => p.date === String(parseInt(r.date.slice(0,4))-1) + r.date.slice(4));
    return { ...r, yoy: prev ? +(r.value - prev.value).toFixed(2) : null };
  });
}

function calcMonthlyYoY(arr) {
  return arr.map((r, i) => {
    if (i < 12) return { ...r, yoy: null };
    const base = arr[i - 12].value;
    return { ...r, yoy: base ? +((r.value / base - 1) * 100).toFixed(1) : null };
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");

  if (Date.now() - cache.ts < CACHE_TTL && cache.data) {
    return res.status(200).json(cache.data);
  }

  try {
    const now = new Date();
    const endY = now.getFullYear();
    const endM = String(now.getMonth() + 1).padStart(2, "0");
    const endDate = `${endY}${endM}`;
    const startDate = `${endY - 8}01`;
    const startDateQ = `${endY - 8}Q1`;

    const [gdpRaw, exportRaw, rateRaw, fxRaw, ppiRaw, bsiRaw, cpiRaw, debtRaw, creditRaw] =
      await Promise.allSettled([
        fetchECOS("111Y002", "C0000",   startDateQ, `${endY}Q4`, "QQ"), // GDP 실질 전분기비
        fetchECOS("901Y012", "0000001", startDate, endDate, "MM"),       // 수출금액
        fetchECOS("722Y001", "0101000", startDate, endDate, "MM"),       // 기준금리
        fetchECOS("731Y004", "0000001", startDate, endDate, "MM"),       // 원달러 환율
        fetchECOS("404Y014", "*AA",     startDate, endDate, "MM"),       // PPI 총지수
        fetchECOS("512Y004", "AA",      startDate, endDate, "MM"),       // BSI 제조업
        fetchECOS("021Y125", "신용카드이용액", startDate, endDate, "MM"), // CPI 소비자물가 (대용)
        fetchECOS("251Y003", "10000",   startDateQ, `${endY}Q4`, "QQ"), // 가계부채/GDP (%)
        fetchECOS("008Y001", "BBLS01",  startDate, endDate, "MM"),       // 은행 대출 증가율
      ]);

    // ── 안전하게 추출
    const gdpArr    = gdpRaw.status    === "fulfilled" ? gdpRaw.value    : [];
    const exports_  = exportRaw.status === "fulfilled" ? exportRaw.value  : [];
    const rate      = rateRaw.status   === "fulfilled" ? rateRaw.value   : [];
    const fx        = fxRaw.status     === "fulfilled" ? fxRaw.value     : [];
    const ppiArr    = ppiRaw.status    === "fulfilled" ? ppiRaw.value    : [];
    const bsi       = bsiRaw.status    === "fulfilled" ? bsiRaw.value    : [];
    const cpiArr    = cpiRaw.status    === "fulfilled" ? cpiRaw.value    : [];
    const debtArr   = debtRaw.status   === "fulfilled" ? debtRaw.value   : [];
    const creditArr = creditRaw.status === "fulfilled" ? creditRaw.value : [];

    // ── 가공
    const gdp         = calcYoY(gdpArr);
    const gdpLevel    = gdpArr;
    const dailyExport = exports_.map(r => ({ date: r.date, value: +(r.value / 21).toFixed(1) }));
    const exportYoY   = calcMonthlyYoY(dailyExport);
    const ppi         = calcMonthlyYoY(ppiArr);
    const cpi         = calcMonthlyYoY(cpiArr);
    const credit      = calcMonthlyYoY(creditArr);

    // ── ECON DEFCON 점수 계산 (달리오 빅사이클 기반)
    // 각 지표: -2(위기) ~ +2(안정), null=데이터없음(0처리)
    const last = arr => arr?.slice(-1)[0]?.value ?? null;
    const lastYoy = arr => arr?.filter(r => r.yoy != null).slice(-1)[0]?.yoy ?? null;

    const lastRate_v   = last(rate);
    const lastFX_v     = last(fx);
    const lastGDP_v    = lastYoy(gdp);  // GDP YoY
    const lastPPI_v    = lastYoy(ppi);
    const lastCPI_v    = lastYoy(cpi);
    const lastBSI_v    = last(bsi);
    const lastDebt_v   = last(debtArr); // 가계부채/GDP%
    const lastCredit_v = lastYoy(credit);
    const lastExYoy_v  = lastYoy(exportYoY);

    // 점수 함수: score(value, [위기임계, 주의임계, 안정임계], 방향)
    // dir: 1=높을수록 위기, -1=낮을수록 위기
    const score = (v, [crit, warn, ok], dir=1) => {
      if (v == null) return 0;
      const val = v * dir;
      const [c, w, o] = [crit*dir, warn*dir, ok*dir];
      if (val >= c) return -2;
      if (val >= w) return -1;
      if (val <= o) return +2;
      return 0;
    };

    const indicators = [
      { key:"금리",     label:"기준금리",        val:lastRate_v,   score:score(lastRate_v,  [4.0,3.0,2.0], 1),  unit:"%",   good:"완화적", warn:"중립", bad:"긴축" },
      { key:"환율",     label:"원/달러 환율",     val:lastFX_v,    score:score(lastFX_v,    [1450,1350,1200],1), unit:"원",  good:"강세",   warn:"중립", bad:"약세" },
      { key:"GDP",      label:"GDP 성장률(YoY)",  val:lastGDP_v,   score:score(lastGDP_v,   [-1,1,3], -1),      unit:"%",   good:"견조",   warn:"완만", bad:"침체" },
      { key:"PPI",      label:"PPI 상승률(YoY)",  val:lastPPI_v,   score:score(lastPPI_v,   [6,3,1],  1),       unit:"%",   good:"안정",   warn:"보통", bad:"압력↑"},
      { key:"CPI",      label:"소비자물가(YoY)",  val:lastCPI_v,   score:score(lastCPI_v,   [5,3,1],  1),       unit:"%",   good:"안정",   warn:"보통", bad:"고인플"},
      { key:"BSI",      label:"BSI 제조업",       val:lastBSI_v,   score:score(lastBSI_v,   [80,90,100],-1),    unit:"",    good:"확장",   warn:"중립", bad:"수축" },
      { key:"수출",     label:"수출증가율(YoY)",  val:lastExYoy_v, score:score(lastExYoy_v, [-15,-5,5],-1),     unit:"%",   good:"증가",   warn:"보합", bad:"감소" },
      { key:"가계부채", label:"가계부채/GDP",     val:lastDebt_v,  score:score(lastDebt_v,  [110,100,80], 1),   unit:"%",   good:"안정",   warn:"주의", bad:"과다" },
      { key:"신용",     label:"은행대출증가율",   val:lastCredit_v,score:score(lastCredit_v,[15,10,3],  1),     unit:"%",   good:"안정",   warn:"보통", bad:"과열" },
    ];

    const totalScore = indicators.reduce((s, d) => s + d.score, 0);
    const maxScore   = indicators.length * 2; // 모두 +2면 최대

    // ECON DEFCON: 점수가 낮을수록 위기
    // totalScore 범위: -18 ~ +18
    let defcon, defconLabel, defconColor, defconDesc;
    if      (totalScore <=  -10) { defcon=1; defconLabel="ECON-1 위기";   defconColor="#FF1A1A"; defconDesc="복수의 위기 신호 동시 발생. 현금 비중 최우선"; }
    else if (totalScore <=   -5) { defcon=2; defconLabel="ECON-2 경계";   defconColor="#FF6B00"; defconDesc="선행지표 다수 경고. 리스크 자산 비중 축소 검토"; }
    else if (totalScore <=    1) { defcon=3; defconLabel="ECON-3 주의";   defconColor="#F0C800"; defconDesc="일부 지표 악화. 포트폴리오 점검 필요"; }
    else if (totalScore <=    7) { defcon=4; defconLabel="ECON-4 관망";   defconColor="#38BDF8"; defconDesc="대체로 양호. 선별적 기회 탐색"; }
    else                         { defcon=5; defconLabel="ECON-5 안정";   defconColor="#00C878"; defconDesc="전 지표 정상. 적극적 투자 환경"; }

    const defconData = { defcon, defconLabel, defconColor, defconDesc, totalScore, maxScore, indicators };

    const data = {
      gdp, gdpLevel, dailyExport, exportYoY, rate, fx,
      ppi, cpi, bsi, debtArr, defconData,
      updatedAt: Date.now()
    };
    cache = { data, ts: Date.now() };
    return res.status(200).json(data);
  } catch (e) {
    console.error("[macro]", e.message);
    if (cache.data) return res.status(200).json(cache.data);
    return res.status(500).json({ error: e.message });
  }
}
