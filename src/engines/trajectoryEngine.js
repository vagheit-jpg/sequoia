/**
 * SEQUOIA Trajectory Lab Engine
 * ─────────────────────────────────────────
 * 개별 종목의 EPS 증가속도·ROE 지속성·QMA 위치·기술 모멘텀·사이클 환경을 결합해
 * 미래 가격의 "확률 경로"를 실험적으로 생성한다.
 *
 * 핵심 철학:
 * - k의 주동력은 EPS 증가속도다.
 * - ROE는 EPS 성장 지속성의 품질 보정이다.
 * - QMA 이격도는 위치 보정이다. 낮은 이격은 부스팅, 높은 이격은 감속한다.
 * - 이 엔진은 예언 공식이 아니라 시나리오/확률 밴드 시각화 도구다.
 */
const safeNum = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, min, max) => Math.max(min, Math.min(max, safeNum(v, min)));

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const t = 1/(1+p*x);
  const y = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}
function normalCdf(x, mean, sd) {
  if (!sd || sd <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (sd * Math.sqrt(2))));
}

function monthlyVolatility(monthly) {
  if (!Array.isArray(monthly) || monthly.length < 6) return 0.12;
  const rets = [];
  for (let i=1; i<monthly.length; i++) {
    const p0 = safeNum(monthly[i-1]?.price, 0);
    const p1 = safeNum(monthly[i]?.price, 0);
    if (p0 > 0 && p1 > 0) rets.push(Math.log(p1 / p0));
  }
  if (rets.length < 3) return 0.12;
  const mean = rets.reduce((s,v)=>s+v,0)/rets.length;
  const variance = rets.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,rets.length-1);
  return clamp(Math.sqrt(variance), 0.03, 0.35);
}

function pctChange(curr, prev) {
  curr = safeNum(curr, null);
  prev = safeNum(prev, null);
  if (curr == null || prev == null || prev <= 0 || curr <= 0) return null;
  return (curr - prev) / Math.abs(prev);
}

function buildAnnualEpsSeries(annData = []) {
  return (annData || [])
    .filter(r => r?.eps != null && Number.isFinite(Number(r.eps)))
    .map(r => ({ label: String(r.year || ""), eps: Number(r.eps), roe: safeNum(r.roe, null) }))
    .filter(r => r.eps > 0);
}

function buildQuarterlyTtmEpsSeries(qtrData = []) {
  const q = (qtrData || [])
    .filter(r => r?.eps != null && Number.isFinite(Number(r.eps)))
    .map((r, i) => ({ idx:i, label: r.label || `${r.year || ""}.${r.quarter || ""}`, eps: Number(r.eps) }));
  if (q.length < 8) return [];
  const out = [];
  for (let i=3; i<q.length; i++) {
    const ttm = q.slice(i-3, i+1).reduce((s,r)=>s+r.eps,0);
    if (ttm > 0) out.push({ label:q[i].label, eps:ttm });
  }
  return out;
}

function calcGrowthProfile(financials = {}) {
  const ann = Array.isArray(financials.annData) ? financials.annData : [];
  const qtr = Array.isArray(financials.qtrData) ? financials.qtrData : [];

  const qTtm = buildQuarterlyTtmEpsSeries(qtr);
  const annual = buildAnnualEpsSeries(ann);

  // 분기 TTM이 충분하면 최근 TTM YoY를 우선 사용. 아니면 연간 EPS 성장률 사용.
  let source = "annual";
  let growthRates = [];
  if (qTtm.length >= 8) {
    source = "quarterlyTTM";
    for (let i=4; i<qTtm.length; i++) {
      const g = pctChange(qTtm[i].eps, qTtm[i-4].eps);
      if (g != null) growthRates.push(g);
    }
  } else if (annual.length >= 2) {
    for (let i=1; i<annual.length; i++) {
      const g = pctChange(annual[i].eps, annual[i-1].eps);
      if (g != null) growthRates.push(g);
    }
  }

  const recent = growthRates.slice(-3);
  const epsGrowthRate = recent.length
    ? recent.reduce((s,v)=>s+v,0)/recent.length
    : 0;

  const latestGrowth = growthRates.length ? growthRates.at(-1) : 0;
  const prevGrowth = growthRates.length >= 2 ? growthRates.at(-2) : latestGrowth;
  const epsAcceleration = latestGrowth - prevGrowth;

  const roeSeries = annual
    .filter(r => r.roe != null && Number.isFinite(Number(r.roe)))
    .map(r => Number(r.roe));
  const roeLatest = roeSeries.length ? roeSeries.at(-1) : safeNum(financials.roe, 0);
  const roePrev = roeSeries.length >= 2 ? roeSeries.at(-2) : roeLatest;
  const roeAvg3 = roeSeries.length ? roeSeries.slice(-3).reduce((s,v)=>s+v,0)/roeSeries.slice(-3).length : safeNum(financials.avgRoe3, roeLatest);
  const roeDelta = roeLatest - roePrev;

  return {
    source,
    epsGrowthRate,
    latestGrowth,
    prevGrowth,
    epsAcceleration,
    roeLatest,
    roeAvg3,
    roeDelta,
  };
}

export function buildTrajectoryLab({
  currentPrice,
  intrinsicValue,
  monthly = [],
  macdData = [],
  qmaGap = null,
  cycle = null,
  financials = {},
  months = 36,
}) {
  const p0 = safeNum(currentPrice, 0);
  const fair = safeNum(intrinsicValue, 0);
  if (p0 <= 0 || fair <= 0) {
    return { ready:false, reason:"현재가 또는 내재가치 데이터 부족", points:[], probabilities:[], meta:{} };
  }

  const baseVol = monthlyVolatility(monthly);
  const lastMacd = Array.isArray(macdData) ? macdData.at(-1) || {} : {};
  const macdBull = safeNum(lastMacd.macd, 0) > safeNum(lastMacd.signal, 0);

  const gp = calcGrowthProfile(financials);

  // 1) EPS 증가속도: k의 중심축.
  // EPS 성장률 20%면 약 +0.048, 40% 이상이면 상한에 접근.
  const epsGrowthK = clamp(gp.epsGrowthRate, -0.20, 0.45) * 0.24;

  // 2) EPS 가속도: 최근 증가속도가 빨라지면 알파, 둔화되면 감속.
  const epsAccelK = clamp(gp.epsAcceleration, -0.20, 0.25) * 0.10;

  // 3) ROE 지속성: EPS 성장의 질과 지속 가능성 보정.
  // ROE 유지 = 유지, ROE 상승 = 성장률 알파, ROE 하락 = 성장률 할인.
  let roeK = 0;
  if (gp.roeLatest >= 20) roeK += 0.018;
  else if (gp.roeLatest >= 15) roeK += 0.012;
  else if (gp.roeLatest >= 10) roeK += 0.004;
  else if (gp.roeLatest > 0) roeK -= 0.006;
  else roeK -= 0.014;

  if (gp.roeDelta > 2) roeK += 0.014;
  else if (gp.roeDelta > 0.5) roeK += 0.007;
  else if (gp.roeDelta < -3) roeK -= 0.018;
  else if (gp.roeDelta < -1) roeK -= 0.009;

  // 4) QMA 위치 보정: 낮은 이격은 부스팅, 높은 이격은 감속.
  const qGap = qmaGap == null ? null : safeNum(qmaGap, 0);
  const qmaK = qGap == null ? 0 : qGap < 0
    ? clamp((-qGap / 100) * 0.08, 0, 0.055)
    : -clamp((qGap / 100) * 0.07, 0, 0.070);

  // 5) 내재가치 괴리: 보조 중력. 핵심은 EPS/ROE이므로 비중은 낮춤.
  const distance = Math.abs(fair - p0) / Math.max(p0, fair);
  const distanceK = clamp(distance, 0, 1.5) * 0.018;

  // 6) MACD / 사이클 보정.
  const macdK = macdBull ? 0.014 : -0.006;
  const cycleMode = cycle?.attackDefenseMode || "균형";
  const cycleK =
    cycleMode === "공격 확대" ? 0.030 :
    cycleMode === "점진 공격" ? 0.020 :
    cycleMode === "선택적 공격" ? 0.012 :
    cycleMode === "방어 준비" ? -0.006 :
    cycleMode === "방어 우위" ? -0.020 :
    cycleMode === "초방어" ? -0.040 : 0;

  // v3 EPS/ROE 중심 k.
  const baseK = 0.030;
  const rawK = baseK + epsGrowthK + epsAccelK + roeK + qmaK + distanceK + macdK + cycleK;
  const k = clamp(rawK, 0.010, 0.240);

  // 불확실성: 월봉 변동성 + 방어 사이클이면 확대. EPS/ROE 품질이 낮으면 추가 확대.
  const qualityPenalty = gp.epsGrowthRate < 0 ? 0.03 : gp.roeLatest < 8 ? 0.025 : 0;
  const uncertainty = clamp(baseVol * 1.25 + qualityPenalty + (cycleMode === "초방어" ? 0.08 : cycleMode === "방어 우위" ? 0.04 : 0), 0.08, 0.45);

  const macdDrift = macdBull ? 0.010 : -0.006;
  const growthDrift = clamp(gp.epsGrowthRate, -0.10, 0.30) * 0.10;
  const cycleDrift = cycleK * 0.35;

  const points = [];
  for (let t=0; t<=months; t++) {
    const convergence = fair + (p0 - fair) * Math.exp(-k * t);
    const drift = p0 * (macdDrift + growthDrift + cycleDrift) * (t / 12);
    const expected = Math.max(1, convergence + drift);
    const sd = expected * uncertainty * Math.sqrt(Math.max(t,1) / 12);
    points.push({
      month:t,
      label:t===0?"현재":`T+${t}M`,
      expected:Math.round(expected),
      upper80:Math.round(expected + 1.28 * sd),
      lower80:Math.max(0, Math.round(expected - 1.28 * sd)),
      upper50:Math.round(expected + 0.67 * sd),
      lower50:Math.max(0, Math.round(expected - 0.67 * sd)),
      fairValue:Math.round(fair),
      sd:Math.round(sd),
    });
  }

  const makeProb = (m) => {
    const pt = points.find(x=>x.month===m) || points.at(-1);
    const mean = pt.expected;
    const sd = Math.max(pt.sd, mean * 0.08);
    const bands = [
      { label:`${Math.round(mean*0.7).toLocaleString()}원 미만`, min:0, max:mean*0.7 },
      { label:`${Math.round(mean*0.7).toLocaleString()}~${Math.round(mean*0.9).toLocaleString()}원`, min:mean*0.7, max:mean*0.9 },
      { label:`${Math.round(mean*0.9).toLocaleString()}~${Math.round(mean*1.1).toLocaleString()}원`, min:mean*0.9, max:mean*1.1 },
      { label:`${Math.round(mean*1.1).toLocaleString()}~${Math.round(mean*1.3).toLocaleString()}원`, min:mean*1.1, max:mean*1.3 },
      { label:`${Math.round(mean*1.3).toLocaleString()}원 이상`, min:mean*1.3, max:Infinity },
    ];
    return {
      month:m,
      expected:mean,
      bands:bands.map(b=>({
        label:b.label,
        probability:Math.round(((b.max===Infinity?1:normalCdf(b.max,mean,sd))-normalCdf(b.min,mean,sd))*100),
      }))
    };
  };

  return {
    ready:true,
    points,
    probabilities:[makeProb(6), makeProb(12), makeProb(24), makeProb(36)],
    meta:{
      k,
      uncertainty,
      baseVol,
      macdBull,
      cycleMode,
      fairValue:fair,
      currentPrice:p0,
      kParts:{
        baseK,
        epsGrowthK,
        epsAccelK,
        roeK,
        qmaK,
        distanceK,
        macdK,
        cycleK,
        rawK,
        distance,
        qmaGap:qGap,
        epsGrowthRate:gp.epsGrowthRate,
        epsAcceleration:gp.epsAcceleration,
        latestGrowth:gp.latestGrowth,
        prevGrowth:gp.prevGrowth,
        roeLatest:gp.roeLatest,
        roeAvg3:gp.roeAvg3,
        roeDelta:gp.roeDelta,
        growthSource:gp.source,
      },
      kGuide:[
        { range:"0.010~0.040", label:"느린 수렴", desc:"EPS 성장 둔화·ROE 약화·촉매 부족" },
        { range:"0.040~0.080", label:"점진 수렴", desc:"EPS 성장 유지, 가치 괴리 천천히 해소" },
        { range:"0.080~0.130", label:"빠른 재평가", desc:"EPS 성장+ROE 지속+저평가 위치 동시 작동" },
        { range:"0.130+", label:"강한 촉매형", desc:"EPS 가속·ROE 상승·수급/이벤트 동시 결합" },
      ],
      note:"EPS/ROE 중심 실험적 확률 경로 — 투자 판단 보조용"
    },
  };
}
