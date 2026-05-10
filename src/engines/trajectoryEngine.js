/**
 * SEQUOIA Trajectory Lab Engine
 * ─────────────────────────────────────────
 * 개별 종목의 내재가치·월봉 추세·변동성·기술 모멘텀을 결합해
 * 미래 가격의 "확률 경로"를 실험적으로 생성한다.
 *
 * 주의: 이 엔진은 예언 공식이 아니라 시나리오/확률 밴드 시각화 도구다.
 */
const safeNum = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, min, max) => Math.max(min, Math.min(max, safeNum(v, min)));
const clamp01 = (v) => clamp(v, 0, 1);

function erf(x) {
  // Abramowitz-Stegun approximation
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

export function buildTrajectoryLab({
  currentPrice,
  intrinsicValue,
  monthly = [],
  macdData = [],
  qmaGap = null,
  cycle = null,
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
  const macdForce = macdBull ? 0.015 : -0.01;
  const gapForce = qmaGap == null ? 0 : clamp(-safeNum(qmaGap) / 100, -0.3, 0.6); // 저평가일수록 양수

  const cycleMode = cycle?.attackDefenseMode || "균형";
  const cycleBias =
    cycleMode === "공격 확대" ? 0.04 :
    cycleMode === "점진 공격" ? 0.025 :
    cycleMode === "선택적 공격" ? 0.015 :
    cycleMode === "방어 준비" ? -0.005 :
    cycleMode === "방어 우위" ? -0.02 :
    cycleMode === "초방어" ? -0.04 : 0;

  // 수렴 계수: 저평가 이격 + 기술 모멘텀 + 사이클 환경을 반영하되 과도한 확정론 방지
  // v2: 과도하게 느린 수렴을 방지하기 위해 가치 괴리(distance)와 QMA 저평가(gapForce)의 반영도를 상향.
  // 해석 기준: k<0.04 느림 / 0.04~0.08 점진 / 0.08~0.12 빠른 재평가 / 0.12 초과 강한 촉매형.
  const distance = Math.abs(fair - p0) / Math.max(p0, fair);
  const baseK = 0.045;
  const distanceK = distance * 0.045;
  const qmaK = gapForce * 0.035;
  const macdK = macdBull ? 0.018 : -0.004;
  const cycleK = cycleBias * 0.30;
  const k = clamp(baseK + distanceK + qmaK + macdK + cycleK, 0.015, 0.20);

  // 불확실성: 월봉 변동성 + 방어 사이클이면 확대
  const uncertainty = clamp(baseVol * 1.25 + (cycleMode === "초방어" ? 0.08 : cycleMode === "방어 우위" ? 0.04 : 0), 0.08, 0.45);

  const points = [];
  for (let t=0; t<=months; t++) {
    // 내재가치로의 완전한 필연 수렴이 아니라, 수렴 성향 + 모멘텀/사이클 드리프트를 결합
    const convergence = fair + (p0 - fair) * Math.exp(-k * t);
    const drift = p0 * (macdForce + cycleBias) * (t / 12);
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
      kParts:{ baseK, distanceK, qmaK, macdK, cycleK, distance, gapForce },
      kGuide:[
        { range:"0.015~0.040", label:"느린 수렴", desc:"촉매 부족·장기 횡보 가능" },
        { range:"0.040~0.080", label:"점진 수렴", desc:"가치 괴리 해소가 천천히 진행" },
        { range:"0.080~0.120", label:"빠른 재평가", desc:"저평가+추세/수급이 함께 작동" },
        { range:"0.120+", label:"강한 촉매형", desc:"수급·실적·이벤트가 동시에 붙는 구간" },
      ],
      note:"실험적 확률 경로 — 투자 판단 보조용"
    },
  };
}
