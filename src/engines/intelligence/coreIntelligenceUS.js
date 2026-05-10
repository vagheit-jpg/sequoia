/**
 * SEQUOIA GLOBAL — Core Intelligence US
 * engines/intelligence/coreIntelligenceUS.js
 *
 * 기존 coreIntelligence.js와 동일한 6계층 구조.
 * dailySummary + changeDrivers 추가.
 * interpretationRules 적용으로 예언형 표현 차단.
 */

import { sanitizeText, directionPhrase } from "../interpretationRules";

const safeNum = (v, fb = 0) => Number.isFinite(Number(v)) ? Number(v) : fb;
const clamp01 = v => Math.max(0, Math.min(1, safeNum(v)));
const clamp   = (v, mn, mx) => Math.max(mn, Math.min(mx, safeNum(v, mn)));

const lastN = (arr, n = 1) =>
  Array.isArray(arr) && arr.length >= n
    ? safeNum(arr[arr.length - n]?.value, null)
    : null;

const changeRate = (curr, prev) =>
  curr != null && prev != null && prev !== 0
    ? (curr - prev) / Math.abs(prev) : 0;

const safe = arr => Array.isArray(arr) ? arr : [];

// ── 1. State Layer
function buildState(usData, sefconResult) {
  const dc        = sefconResult?.defconData;
  const catScores = dc?.catScores || [];
  const catRisk   = name => {
    const c = catScores.find(c => c.cat === name);
    return c ? clamp01(1 - c.score / 100) : 0.5;
  };

  const lastVIX   = safeNum(lastN(usData?.vix),   20);
  const lastHY    = safeNum(lastN(usData?.hy),    1.8);
  const lastBAML  = safeNum(lastN(usData?.baml),  3.5);
  const lastDXY   = safeNum(lastN(usData?.dxy),   25);
  const lastTNX   = safeNum(lastN(usData?.tnx),    4);
  const lastLEI   = safeNum(lastN(usData?.lei),   100);
  const lastSLOOS = safeNum(lastN(usData?.sloos),   0);

  const creditRisk      = clamp01(catRisk("신용위험") * 0.5 + clamp01((lastHY - 1.0) / 4.0) * 0.3 + clamp01((lastBAML - 2.5) / 8.0) * 0.2);
  const liquidityRisk   = clamp01(catRisk("유동성") * 0.7 + clamp01((lastDXY - 23) / 8) * 0.3);
  const speculationRisk = clamp01(catRisk("시장공포") * 0.6 + clamp01((lastVIX - 15) / 50) * 0.4);
  const macroRisk       = clamp01(catRisk("실물경기") * 0.6 + clamp01((101 - lastLEI) / 5) * 0.4);
  const volatilityRisk  = clamp01(clamp01((lastVIX - 12) / 40) * 0.6 + catRisk("시장공포") * 0.4);
  const valuationRisk   = clamp01(clamp01(lastTNX / 7) * 0.6 + clamp01((lastHY - 1.0) / 4.0) * 0.4);

  const sefBase   = dc?.totalScore != null ? clamp01(1 - dc.totalScore / 100) : 0.5;
  const totalRisk = clamp01(sefBase * 0.5 +
    (creditRisk + liquidityRisk + speculationRisk + macroRisk + volatilityRisk + valuationRisk) / 6 * 0.5);

  return {
    creditRisk, liquidityRisk, speculationRisk,
    macroRisk, volatilityRisk, valuationRisk, totalRisk,
    sefconLevel: dc?.defcon ?? 3,
    sefconScore: dc?.totalScore ?? 50,
  };
}

// ── 2. Temporal Layer
function buildTemporal(usData) {
  // 달러(UUP) 유동성 추세
  const dxy = safe(usData?.dxy);
  const dxy0 = lastN(dxy,1), dxy1m = lastN(dxy,2), dxy3m = lastN(dxy,4);
  const liquidityTrend1m = clamp(changeRate(dxy0, dxy1m) * 3, -1, 1);
  const liquidityTrend3m = clamp(changeRate(dxy0, dxy3m) * 2, -1, 1);

  // 10년물 금리 추세
  const tnx = safe(usData?.tnx);
  const tnx0 = lastN(tnx,1), tnx3m = lastN(tnx,4);
  const rateTrend = clamp(changeRate(tnx0, tnx3m) * 5, -1, 1);

  // M2 추세 (감소 = 압박)
  const m2 = safe(usData?.m2YoY);
  const m2_0 = lastN(m2,1), m2_3m = lastN(m2,4);
  const m2Trend = clamp(changeRate(m2_0, m2_3m) * 2, -1, 1) * -1;

  const liquidityTrend = clamp(liquidityTrend1m * 0.5 + liquidityTrend3m * 0.3 + rateTrend * 0.2, -1, 1);

  // HY 신용 가속도 (일간 변동 포착)
  const hy = safe(usData?.baml);
  const hy0 = lastN(hy,1), hy1m = lastN(hy,2), hy3m = lastN(hy,4);
  const creditTrend1m      = clamp(changeRate(hy0, hy1m) * 3, -1, 1);
  const creditTrend3m      = clamp(changeRate(hy0, hy3m) * 2, -1, 1);
  const creditAcceleration = clamp(creditTrend1m * 0.6 + (creditTrend1m - creditTrend3m / 3) * 0.4, -1, 1);

  // VIX 변동성 압축
  const vix = safe(usData?.vix);
  const vix0  = safeNum(lastN(vix,1), 20);
  const vix3m = vix.slice(-4).reduce((s,r) => s + safeNum(r?.value,20), 0) / Math.max(vix.slice(-4).length, 1);
  const vix6m = vix.slice(-7).reduce((s,r) => s + safeNum(r?.value,20), 0) / Math.max(vix.slice(-7).length, 1);
  const volatilityCompression = clamp((vix6m - vix0) / 15, -1, 1);
  const speculationMomentum   = clamp(changeRate(vix0, vix3m) * -2, -1, 1);

  const riskAcceleration = clamp(creditAcceleration * 0.5 + liquidityTrend * 0.3 + rateTrend * 0.2, -1, 1);

  const dirLabel = v =>
    v > 0.35 ? "빠르게 악화" : v > 0.15 ? "점진 악화" :
    v < -0.35 ? "빠르게 개선" : v < -0.15 ? "점진 개선" : "횡보";

  return {
    liquidityTrend, liquidityTrend1m, liquidityTrend3m,
    creditTrend1m, creditTrend3m, creditAcceleration,
    volatilityCompression, speculationMomentum, riskAcceleration,
    m2Trend, rateTrend,
    labels: {
      liquidityTrend:        dirLabel(liquidityTrend),
      creditAcceleration:    dirLabel(creditAcceleration),
      volatilityCompression: volatilityCompression > 0.3 ? "압축 심화" : volatilityCompression > 0.1 ? "압축 중" : volatilityCompression < -0.2 ? "확산 중" : "중립",
      speculationMomentum:   dirLabel(speculationMomentum),
      riskAcceleration:      dirLabel(riskAcceleration),
    },
  };
}

// ── 3. Physics Layer (sefconUS에서 계산된 결과 재사용)
function buildPhysics(sefconResult) {
  return sefconResult?.physics || {
    liquidityPressure: 0.5, valuationGravity: 0.5,
    creditStress: 0.5, volatilityEnergy: 0.3,
    economicMomentum: 0.5, dominantForce: "데이터 로딩 중",
  };
}

// ── 4. Regime Layer (sefconUS 결과 재사용)
function buildRegime(sefconResult, state, temporal) {
  const r = sefconResult?.regime || {};
  const tags = [r.current || "혼합/불확실형"];
  if (temporal.riskAcceleration > 0.3)      tags.push("위험 가속화");
  if (temporal.volatilityCompression > 0.4) tags.push("변동성 에너지 축적");
  if (state.speculationRisk > 0.7)          tags.push("투기 과열");
  if (state.creditRisk > 0.7)               tags.push("신용 경색 위험");
  if (temporal.liquidityTrend > 0.3)        tags.push("유동성 이탈 중");

  const statePhrase =
    state.totalRisk > 0.75 ? "고위험 국면" :
    state.totalRisk > 0.55 ? "경계 국면" :
    state.totalRisk > 0.35 ? "중립 국면" : "안정 국면";

  return {
    primaryLabel:   r.current        || "혼합/불확실형",
    primaryType:    r.primaryType    || "unknown",
    transitionPath: r.transitionPath || null,
    direction:      r.direction      || "유지",
    confidence:     r.confidence     || 0.5,
    reason:         r.reason         || "",
    tags, statePhrase,
  };
}

// ── 5. Interpretation Layer
function buildInterpretation(state, temporal, physics, regime) {
  const part1 = (() => {
    const dominantDesc = {
      // sefconUS.js buildPhysicsUS의 force 이름과 동기화
      "미국으로의 유동성 쏠림": "미국으로의 유동성 쏠림이 지배적인",
      "밸류에이션 고평가":       "밸류에이션 부담이 지배적인",
      "대출 난이도":             "신용 경색이 주도하는",
      "변동성 급변 에너지":      "변동성 에너지가 축적된",
      "경기 침체 위험":          "경기 침체 위험이 높아진",
      // 구버전 호환
      "유동성 압력":             "유동성 압력이 지배적인",
      "밸류 중력":               "밸류에이션 부담이 지배적인",
      "신용 응력":               "신용 스트레스가 주도하는",
      "변동성 에너지":           "변동성 에너지가 축적된",
      "경기 모멘텀":             "경기 모멘텀이 약화된",
    }[physics.dominantForce] || "복합 요인이 작용하는";
    return sanitizeText(`미국 시장은 현재 ${regime.primaryLabel} 국면에 있으며, ${dominantDesc} 환경이 지속되고 있습니다.`);
  })();

  const part2 = (() => {
    const parts = [];
    if (temporal.liquidityTrend > 0.15)       parts.push(`유동성 압력은 ${temporal.labels.liquidityTrend} 흐름`);
    else if (temporal.liquidityTrend < -0.15) parts.push(`유동성은 ${temporal.labels.liquidityTrend} 흐름`);
    if (temporal.creditAcceleration > 0.15)   parts.push(`신용 스트레스가 ${temporal.labels.creditAcceleration}`);
    if (temporal.volatilityCompression > 0.3) parts.push(`변동성이 ${temporal.labels.volatilityCompression} 에너지 축적 중`);
    return parts.length ? sanitizeText(parts.join(", ") + "입니다.") : null;
  })();

  const part3 = (() => {
    if (physics.liquidityPressure > 0.65) return "달러 강세와 금리 환경이 글로벌 유동성을 흡수하는 힘으로 작용하고 있습니다.";
    if (physics.creditStress > 0.65)      return "하이일드 스프레드 확대와 대출 기준 강화가 신용 시장을 압박하고 있습니다.";
    if (physics.valuationGravity > 0.65)  return "현재 금리 수준은 고밸류 자산에 강한 하방 압력을 가하고 있습니다.";
    if (physics.volatilityEnergy > 0.6)   return "장기 저변동성 구간이 지속되며 갑작스러운 가격 재조정 가능성이 누적되고 있습니다.";
    return null;
  })();

  const part4 = regime.transitionPath
    ? sanitizeText(`앞으로의 방향: ${regime.transitionPath}`)
    : null;

  const lines     = [part1, part2, part3, part4].filter(Boolean);
  const direction = temporal.riskAcceleration > 0.15 ? "악화" : temporal.riskAcceleration < -0.15 ? "개선" : "횡보";

  return {
    summary:   lines.join(" "),
    lines,
    direction,
    riskScore: Math.round(state.totalRisk * 100),
  };
}

// ── 6. Strategy Layer
function buildStrategy(state, temporal, physics) {
  const sefLv = state.sefconLevel;
  let cashBias = sefLv<=1?0.7:sefLv===2?0.5:sefLv===3?0.3:sefLv===4?0.15:0.1;
  if (physics.creditStress > 0.65)     cashBias = Math.min(1, cashBias + 0.1);
  if (temporal.riskAcceleration > 0.3) cashBias = Math.min(1, cashBias + 0.05);
  cashBias = clamp01(cashBias);

  const defenseBias    = clamp01(state.totalRisk * 0.7 + physics.liquidityPressure * 0.3);
  const growthExposure = clamp01(1 - state.totalRisk * 0.8 - physics.valuationGravity * 0.2);
  const riskLevel      = state.totalRisk>0.75?"매우 높음":state.totalRisk>0.55?"높음":state.totalRisk>0.35?"보통":"낮음";

  let message =
    cashBias>=0.6 ? "현금·미국 국채 중심 방어 최우선. 공격 포지션 축소." :
    cashBias>=0.4 ? "현금 비중 확대, 방어섹터(헬스케어·필수소비재) 중심 재편." :
    cashBias>=0.2 ? "현금흐름 우량주·배당주 중심 선별적 운용." :
                    "우량 성장주 중심 적극 운용 가능.";

  const actions = [];
  if (physics.creditStress > 0.6)      actions.push("레버리지·하이일드 자산 비중 축소");
  if (physics.valuationGravity > 0.6)  actions.push("고PER·나스닥 성장주 비중 점검");
  if (temporal.liquidityTrend > 0.25)  actions.push("달러 강세 수혜 자산 검토");
  if (physics.volatilityEnergy > 0.5)  actions.push("변동성 확대 대비 분산 강화");
  if (state.totalRisk < 0.35 && growthExposure > 0.6) actions.push("S&P500 성장섹터 비중 확대 검토");

  return {
    cashBias:       Math.round(cashBias * 100),
    defenseBias:    Math.round(defenseBias * 100),
    growthExposure: Math.round(growthExposure * 100),
    riskLevel, message, actions,
  };
}

// ── Daily Summary (VIX·HY 등 일간 변동 지표 중심)
function buildDailySummary(state, physics, regime, temporal) {
  const headline = sanitizeText(
    `오늘 미국 시장은 ${physics.dominantForce ?? "시장"}이 우세한 ${regime.primaryLabel} 국면입니다.`
  );

  const riskDirection =
    temporal.riskAcceleration > 0.2  ? "악화" :
    temporal.riskAcceleration < -0.2 ? "개선" : "횡보";

  return {
    headline,
    dominantForce: physics.dominantForce,
    riskDirection,
    statePhrase:   regime.statePhrase,
  };
}

// ── Change Drivers (일간 변화 기여 요인, 주로 VIX·HY 중심)
function buildChangeDrivers(temporal, physics, sefconResult) {
  const drivers = [];

  if (Math.abs(temporal.creditTrend1m) > 0.2)
    drivers.push(temporal.creditTrend1m > 0 ? "HY 스프레드 확대" : "HY 스프레드 축소");
  if (Math.abs(temporal.liquidityTrend1m) > 0.2)
    drivers.push(temporal.liquidityTrend1m > 0 ? "달러 강세" : "달러 약세");
  if (temporal.volatilityCompression > 0.4)
    drivers.push("VIX 변동성 압축 심화");
  else if (temporal.volatilityCompression < -0.3)
    drivers.push("VIX 변동성 확산");
  if (physics.creditStress > 0.7)
    drivers.push("신용 스트레스 고조");
  if (physics.economicMomentum < 0.35)
    drivers.push("경기 모멘텀 약화");

  // C-Index 주요 드라이버 병합
  const ciDrivers = sefconResult?.defconData?.cIndex?.topDrivers || [];
  ciDrivers.forEach(d => { if (!drivers.includes(d)) drivers.push(d); });

  return drivers.slice(0, 5); // 최대 5개
}

// ── Fallback
const FALLBACK_US = {
  state:          { totalRisk:0.5, sefconLevel:3, sefconScore:50, creditRisk:0.5, liquidityRisk:0.5, speculationRisk:0.5, macroRisk:0.5, volatilityRisk:0.5, valuationRisk:0.5 },
  temporal:       { liquidityTrend:0, creditAcceleration:0, volatilityCompression:0, riskAcceleration:0, labels:{ liquidityTrend:"횡보", creditAcceleration:"횡보", volatilityCompression:"중립", riskAcceleration:"횡보" } },
  physics:        { liquidityPressure:0.5, valuationGravity:0.5, creditStress:0.5, volatilityEnergy:0.3, economicMomentum:0.5, dominantForce:"데이터 로딩 중" },
  regime:         { primaryLabel:"혼합/불확실형", tags:[], statePhrase:"중립 국면", direction:"유지", transitionPath:null, confidence:0.5 },
  interpretation: { summary:"미국 데이터를 불러오는 중입니다.", lines:[], direction:"횡보", riskScore:50 },
  strategy:       { cashBias:30, defenseBias:50, growthExposure:30, riskLevel:"보통", message:"데이터 로딩 후 전략이 생성됩니다.", actions:[] },
  dailySummary:   { headline:"미국 시장 데이터 로딩 중입니다.", dominantForce:"-", riskDirection:"횡보", statePhrase:"중립 국면" },
  changeDrivers:  [],
};

// ── Main Orchestrator
export function runCoreIntelligenceUS({ usData, sefconResult }) {
  if (!usData || !sefconResult) return FALLBACK_US;
  try {
    const state          = buildState(usData, sefconResult);
    const temporal       = buildTemporal(usData);
    const physics        = buildPhysics(sefconResult);
    const regime         = buildRegime(sefconResult, state, temporal);
    const interpretation = buildInterpretation(state, temporal, physics, regime);
    const strategy       = buildStrategy(state, temporal, physics);
    const dailySummary   = buildDailySummary(state, physics, regime, temporal);
    const changeDrivers  = buildChangeDrivers(temporal, physics, sefconResult);

    return { state, temporal, physics, regime, interpretation, strategy, dailySummary, changeDrivers };
  } catch (err) {
    console.warn("[CoreIntelligenceUS] 오류:", err);
    return {
      ...FALLBACK_US,
      interpretation: { ...FALLBACK_US.interpretation, summary: "일시적 계산 오류 — 새로고침 후 다시 시도해 주세요." },
    };
  }
}
