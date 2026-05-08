/**
 * SEQUOIA Core Intelligence Nervous System
 * ─────────────────────────────────────────
 * 기존 SEFCON / CrisisNav / Regime / AEGIS 데이터를
 * 하나의 인지 흐름으로 통합하는 중앙 오케스트레이터.
 *
 * 새로운 계산식을 만들지 않는다.
 * 기존 macroData 구조를 최대한 재활용한다.
 *
 * 흐름:
 *   RAW DATA
 *   → State Layer    (현재 상태 인식)
 *   → Temporal Layer (시간 변화·가속도 인식)
 *   → Physics Layer  (시장 힘 해석)
 *   → Regime Layer   (시장 상태 언어화)
 *   → Interpretation (종합 판단)
 *   → Strategy Layer (행동 전략)
 */

// ── 안전 유틸 ────────────────────────────────────────────
const safeNum = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

const clamp01 = (v) => Math.max(0, Math.min(1, safeNum(v)));

const clamp = (v, min, max) => Math.max(min, Math.min(max, safeNum(v, min)));

/** 배열 마지막 n개의 value 필드 평균 */
const avgLast = (arr, n) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const slice = arr.slice(-n).map((r) => safeNum(r?.value, null)).filter((v) => v !== null);
  if (!slice.length) return null;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
};

/** 두 값의 변화율 (없으면 0) */
const changeRate = (curr, prev) => {
  if (curr == null || prev == null || prev === 0) return 0;
  return (curr - prev) / Math.abs(prev);
};

// ── 1. State Layer ────────────────────────────────────────
/**
 * 현재 시장 상태 인식.
 * 기존 defconData.catScores 를 재활용하고
 * 필요한 부분만 FRED 시계열로 보완한다.
 *
 * 반환: 0~1 범위 위험도 (1에 가까울수록 위험)
 *
 * ── 데이터 키 정의 (macro.js 기준) ──
 * fredHY   : 무디스 Baa 회사채 스프레드 (DBAA - DGS10)
 *            투자등급 회사채 신용 위험. 정상 ~1.5%p, 위험 4%p↑
 * fredBAML : ICE BofA HY 스프레드 (BAMLH0A0HYM2)
 *            고위험(정크) 채권 스프레드. 정상 ~3~4%p, 위험 9%p↑
 *            fredBAML이 fredHY보다 변동성 크고 선행 반응 빠름
 * fredSLOOS: 미국 SLOOS 대출기준강화 (양수 = 대출 조이기)
 */
function buildState(macroData) {
  const dc = macroData?.defconData;
  const catScores = dc?.catScores || [];

  // catScores는 0~100 점수 (100이 안전, 0이 위험)
  // → 0~1 위험도로 변환: risk = 1 - (score/100)
  const catRisk = (catName) => {
    const cat = catScores.find((c) => c.cat === catName);
    return cat ? clamp01(1 - cat.score / 100) : 0.5;
  };

  // FRED 보조 데이터
  const lastVIX  = safeNum((macroData?.fredVIX  || []).slice(-1)[0]?.value, 20);
  // fredHY  = Baa 신용스프레드 (무디스, 투자등급 하단). 정상 ~1.5%p
  const lastBaa  = safeNum((macroData?.fredHY   || []).slice(-1)[0]?.value, 1.8);
  // fredBAML = ICE BofA HY 스프레드 (정크본드). 정상 ~3.5%p, 위기 9%p↑
  const lastHY   = safeNum((macroData?.fredBAML || []).slice(-1)[0]?.value, 3.5);
  const lastDXY  = safeNum((macroData?.yahooDXY || []).slice(-1)[0]?.value, 100);
  const lastRate = safeNum((macroData?.rate     || []).slice(-1)[0]?.value, 2);
  const lastLEI  = safeNum((macroData?.fredLEI  || []).slice(-1)[0]?.value, 0);
  const lastSLOOS= safeNum((macroData?.fredSLOOS|| []).slice(-1)[0]?.value, 0);

  // 신용 위험: Baa 스프레드(선행) + ICE BofA HY(선행+변동성) + catScores
  // Baa 정상 <2%p, 경계 3%p, 위험 4%p↑
  const creditRisk = clamp01(
    catRisk("신용위험") * 0.5 +
    clamp01((lastBaa - 1.0) / 4.0) * 0.3 +   // Baa: 1%p~5%p → 0~1
    clamp01((lastHY  - 2.5) / 8.0) * 0.2      // HY:  2.5%p~10.5%p → 0~1
  );

  const liquidityRisk  = clamp01(catRisk("유동성")   * 0.7 + clamp01((lastDXY - 95) / 20) * 0.3);
  const speculationRisk = clamp01(catRisk("시장공포") * 0.6 + clamp01((lastVIX - 15) / 50) * 0.4);
  const macroRisk      = clamp01(catRisk("실물경기") * 0.6 + clamp01((-lastLEI) / 5) * 0.4);
  const volatilityRisk = clamp01(clamp01((lastVIX - 12) / 40) * 0.6 + catRisk("시장공포") * 0.4);

  // 밸류에이션 위험: 금리 레벨 + Baa 스프레드 (투자등급 자산 할인율 상승)
  const valuationRisk  = clamp01(clamp01(lastRate / 8) * 0.6 + clamp01((lastBaa - 1.0) / 4.0) * 0.4);

  // 종합: SEFCON totalScore를 기반으로 앵커
  const sefBase = dc?.totalScore != null ? clamp01(1 - dc.totalScore / 100) : 0.5;
  const totalRisk = clamp01(
    sefBase * 0.5 +
    (creditRisk + liquidityRisk + speculationRisk + macroRisk + volatilityRisk + valuationRisk) / 6 * 0.5
  );

  return {
    creditRisk,
    liquidityRisk,
    speculationRisk,
    macroRisk,
    volatilityRisk,
    valuationRisk,
    totalRisk,
    sefconLevel: dc?.defcon ?? 3,
    sefconScore: dc?.totalScore ?? 50,
  };
}

// ── 2. Temporal Layer ─────────────────────────────────────
/**
 * 시간 흐름과 변화 방향 인식.
 * 현재 값이 아니라 변화율·가속도·압력 누적을 추적한다.
 *
 * 반환: -1(개선 방향) ~ 0(중립) ~ +1(악화 방향)
 */
function buildTemporal(macroData) {
  const safe = (arr) => Array.isArray(arr) ? arr : [];

  // 유동성 트렌드: DXY 변화 (DXY↑ = 유동성 압박)
  const dxy = safe(macroData?.yahooDXY);
  const dxyNow  = safeNum(dxy.slice(-1)[0]?.value);
  const dxy1M   = safeNum(dxy.slice(-2)[0]?.value);
  const dxy3M   = safeNum(dxy.slice(-4)[0]?.value);
  const liquidityTrend = dxy.length >= 2
    ? clamp(changeRate(dxyNow, dxy1M) * 3, -1, 1)   // DXY 상승 = 유동성 압박 증가
    : 0;

  // 신용 가속도: ICE BofA HY 스프레드 변화 속도 (fredBAML = 빠른 선행 신호)
  // HY는 Baa보다 변동성 크고 위기 시 먼저 반응 → 가속도 측정에 적합
  const hy = safe(macroData?.fredBAML);  // ICE BofA HY
  const hyNow = safeNum(hy.slice(-1)[0]?.value);
  const hy1M  = safeNum(hy.slice(-2)[0]?.value);
  const hy3M  = safeNum(hy.slice(-4)[0]?.value);
  const hyChange1M = changeRate(hyNow, hy1M);
  const hyChange3M = changeRate(hyNow, hy3M);
  // 가속도: 최근 변화가 3개월 변화보다 빠른가
  const creditAcceleration = clamp(
    hyChange1M * 2 + (hyChange1M - hyChange3M / 3) * 1,
    -1, 1
  );

  // 변동성 압축: VIX가 낮게 유지되면 압축 (반등 잠재력 축적)
  const vix = safe(macroData?.fredVIX);
  const vixNow = safeNum(vix.slice(-1)[0]?.value, 20);
  const vix3M  = avgLast(vix, 3) ?? vixNow;
  const vix6M  = avgLast(vix, 6) ?? vixNow;
  // VIX가 3~6개월 평균보다 낮으면 압축 중 (양수 = 압축)
  const volatilityCompression = clamp((vix6M - vixNow) / 15, -1, 1);

  // 투기 모멘텀: VIX 하락 속도 (VIX↓ + 시장 상승 = 투기 과열)
  const speculationMomentum = clamp(
    changeRate(vixNow, vix3M) * -2,  // VIX 하락 = 투기 증가
    -1, 1
  );

  // 전체 위험 가속도: 신용 + 유동성 방향 종합
  const riskAcceleration = clamp(
    creditAcceleration * 0.5 + liquidityTrend * 0.5,
    -1, 1
  );

  // 방향 언어화 (UI 표시용)
  const dirLabel = (v) =>
    v > 0.3 ? "악화 가속" :
    v > 0.1 ? "소폭 악화" :
    v < -0.3 ? "개선 중" :
    v < -0.1 ? "소폭 개선" : "횡보";

  return {
    liquidityTrend,
    creditAcceleration,
    volatilityCompression,
    speculationMomentum,
    riskAcceleration,
    labels: {
      liquidityTrend:        dirLabel(liquidityTrend),
      creditAcceleration:    dirLabel(creditAcceleration),
      volatilityCompression: volatilityCompression > 0.2 ? "압축 중" : volatilityCompression < -0.2 ? "확산 중" : "중립",
      speculationMomentum:   dirLabel(speculationMomentum),
      riskAcceleration:      dirLabel(riskAcceleration),
    },
  };
}

// ── 3. Physics Layer ──────────────────────────────────────
/**
 * 시장 내부 힘 해석.
 * "왜 시장이 움직이는가?"를 경제 힘 관점에서 해석한다.
 *
 * fredHY   = Baa 신용스프레드 (투자등급 하단, 정상 ~1.5%p)
 * fredBAML = ICE BofA HY 스프레드 (정크본드, 정상 ~3.5%p)
 * fredSLOOS = 대출기준강화 지수 (양수 = 조임)
 */
function buildPhysics(macroData, state) {
  const lastRate = safeNum((macroData?.rate     || []).slice(-1)[0]?.value, 2);
  // Baa 스프레드: 투자등급 신용 비용 → 밸류에이션 중력에 사용
  const lastBaa  = safeNum((macroData?.fredHY   || []).slice(-1)[0]?.value, 1.8);
  // HY 스프레드: 고위험 채권 신용 비용 → 신용 응력에 사용
  const lastHY   = safeNum((macroData?.fredBAML || []).slice(-1)[0]?.value, 3.5);
  const lastDXY  = safeNum((macroData?.yahooDXY || []).slice(-1)[0]?.value, 100);
  const lastSLOOS= safeNum((macroData?.fredSLOOS|| []).slice(-1)[0]?.value, 0);

  // 유동성 압력: DXY 강세 + 금리 레벨 → 자금이 빠져나가는 힘
  const liquidityPressure = clamp01(
    clamp01((lastDXY - 90) / 25) * 0.5 +
    clamp01(lastRate / 7) * 0.3 +
    state.liquidityRisk * 0.2
  );

  // 밸류에이션 중력: 금리↑ + Baa 스프레드↑ → 투자등급 자산 할인율 상승
  // Baa 1%p~5%p → 0~1 정규화
  const valuationGravity = clamp01(
    clamp01(lastRate / 6) * 0.6 +
    clamp01((lastBaa - 0.8) / 4.2) * 0.4
  );

  // 신용 응력: HY 스프레드(정크본드) + SLOOS(대출 조임)
  // HY 2.5%p~10.5%p → 0~1 정규화
  const creditStress = clamp01(
    clamp01((lastHY - 2.5) / 8.0) * 0.6 +
    clamp01(lastSLOOS / 50) * 0.4
  );

  // 힘 벡터 요약
  const dominantForce =
    liquidityPressure > valuationGravity && liquidityPressure > creditStress
      ? "유동성 압력 우세"
      : valuationGravity > creditStress
      ? "밸류 중력 우세"
      : "신용 응력 우세";

  return {
    liquidityPressure,
    valuationGravity,
    creditStress,
    dominantForce,
  };
}

// ── 4. Regime Layer ───────────────────────────────────────
/**
 * 현재 시장 상태 언어화.
 * 기존 regimeInsight를 재활용하고 State + Temporal 로 보강한다.
 */
function buildRegime(macroData, state, temporal) {
  const primaryLabel = macroData?.regimeInsight?.regime?.primaryLabel || "혼합/불확실형";
  const crisisProximity = macroData?.crisisAnalysis?.navigation?.proximityScore ?? 0;
  const topCrisis = macroData?.crisisAnalysis?.navigation?.topCrisis?.label ?? null;

  // 복합 레짐 태그 생성
  const tags = [primaryLabel];

  if (crisisProximity >= 60) tags.push("위기 패턴 근접");
  if (temporal.riskAcceleration > 0.3) tags.push("위험 가속화");
  if (temporal.volatilityCompression > 0.4) tags.push("변동성 압축");
  if (state.speculationRisk > 0.7) tags.push("투기 과열");
  if (state.creditRisk > 0.7) tags.push("신용 경색 위험");
  if (temporal.liquidityTrend > 0.3) tags.push("유동성 이탈 중");

  // 시장 상태 한 줄 요약
  const statePhrase =
    state.totalRisk > 0.75 ? "고위험 국면" :
    state.totalRisk > 0.55 ? "경계 국면" :
    state.totalRisk > 0.35 ? "중립 국면" : "안정 국면";

  return {
    primaryLabel,
    tags,
    statePhrase,
    crisisProximity,
    topCrisis,
  };
}

// ── 5. Interpretation Layer ───────────────────────────────
/**
 * State + Temporal + Physics + Regime을 하나의 의미로 통합.
 * 단순 수치 나열이 아니라 "왜 위험한가?" "어떤 방향인가?"를 해석.
 */
function buildInterpretation(state, temporal, physics, regime) {
  const lines = [];

  // 현재 국면 진단
  lines.push(
    `현재 시장은 ${regime.primaryLabel} 국면입니다. ` +
    `종합 위험도는 ${Math.round(state.totalRisk * 100)}점으로 ${regime.statePhrase}에 해당합니다.`
  );

  // 유동성 방향
  if (physics.liquidityPressure > 0.6) {
    lines.push(
      `유동성 압력이 강합니다(${Math.round(physics.liquidityPressure * 100)}점). ` +
      `달러 강세와 금리 환경이 시장에서 자금을 이탈시키는 힘으로 작용하고 있습니다.`
    );
  } else if (temporal.liquidityTrend > 0.2) {
    lines.push(`유동성이 ${temporal.labels.liquidityTrend} 흐름입니다. 방향성을 주시할 필요가 있습니다.`);
  }

  // 신용 상태
  if (state.creditRisk > 0.65) {
    const accelStr = temporal.creditAcceleration > 0.2 ? "가속되는 흐름이 감지됩니다" : "다소 안정된 수준입니다";
    lines.push(
      `신용 스트레스가 높습니다(${Math.round(state.creditRisk * 100)}점). ` +
      `${accelStr}.`
    );
  }

  // 변동성 압축 경고
  if (temporal.volatilityCompression > 0.35) {
    lines.push(
      `변동성이 압축되어 있습니다. ` +
      `장기간 낮은 변동성이 유지될수록 향후 급격한 변동성 확대 가능성이 높아집니다.`
    );
  }

  // 밸류에이션 중력
  if (physics.valuationGravity > 0.6) {
    lines.push(
      `현재 금리 환경은 고PER 자산에 강한 하방 압력(밸류에이션 중력)을 가하고 있습니다.`
    );
  }

  // 주도 힘
  lines.push(`현재 시장을 지배하는 힘: ${physics.dominantForce}.`);

  // 위기 패턴 근접
  if (regime.crisisProximity >= 55) {
    lines.push(
      `과거 위기 패턴과의 유사도가 ${regime.crisisProximity}%로 높습니다. ` +
      (regime.topCrisis ? `특히 ${regime.topCrisis} 패턴과 유사한 흐름입니다.` : "")
    );
  }

  return {
    summary: lines.join(" "),
    lines,
    riskScore: Math.round(state.totalRisk * 100),
    direction: temporal.riskAcceleration > 0.15 ? "악화" :
               temporal.riskAcceleration < -0.15 ? "개선" : "횡보",
  };
}

// ── 6. Strategy Layer ─────────────────────────────────────
/**
 * AEGIS 행동 전략 연결.
 * 기존 AEGIS 전략(레짐 × SEFCON)에 Physics + Temporal 보정을 추가한다.
 */
function buildStrategy(state, temporal, physics, regime) {
  const sefLv = state.sefconLevel;

  // 기본 현금 편향: SEFCON 레벨 기반
  let cashBias = sefLv <= 1 ? 0.7 : sefLv === 2 ? 0.5 : sefLv === 3 ? 0.3 : sefLv === 4 ? 0.15 : 0.1;
  // 신용 응력 보정
  if (physics.creditStress > 0.65) cashBias = Math.min(1, cashBias + 0.1);
  // 위험 가속 보정
  if (temporal.riskAcceleration > 0.3) cashBias = Math.min(1, cashBias + 0.05);
  cashBias = clamp01(cashBias);

  // 방어 편향
  const defenseBias = clamp01(state.totalRisk * 0.7 + physics.liquidityPressure * 0.3);

  // 성장 노출도
  const growthExposure = clamp01(1 - state.totalRisk * 0.8 - physics.valuationGravity * 0.2);

  // 위험 레벨 텍스트
  const riskLevel =
    state.totalRisk > 0.75 ? "매우 높음" :
    state.totalRisk > 0.55 ? "높음" :
    state.totalRisk > 0.35 ? "보통" : "낮음";

  // 핵심 메시지
  let message;
  if (cashBias >= 0.6) {
    message = "현금 및 국채 중심 방어가 최우선입니다. 공격적 포지션을 즉각 축소하세요.";
  } else if (cashBias >= 0.4) {
    message = "현금 비중을 높이고 방어자산 중심으로 재편하는 전략이 유리합니다.";
  } else if (cashBias >= 0.2) {
    message = "선별적 접근이 필요합니다. 현금흐름 우량주와 방어주 중심으로 운용하세요.";
  } else {
    message = "안정 국면입니다. 우량 성장주 중심으로 적극적 운용이 가능합니다.";
  }

  // 보조 행동 지침
  const actions = [];
  if (physics.creditStress > 0.6) actions.push("레버리지·저유동성 자산 회피");
  if (physics.valuationGravity > 0.6) actions.push("고PER·성장주 비중 축소");
  if (temporal.liquidityTrend > 0.25) actions.push("달러 자산 비중 점검");
  if (temporal.volatilityCompression > 0.35) actions.push("변동성 확대 대비 분산");
  if (state.totalRisk < 0.35 && growthExposure > 0.6) actions.push("우량 성장주 비중 확대 검토");

  return {
    cashBias: Math.round(cashBias * 100),
    defenseBias: Math.round(defenseBias * 100),
    growthExposure: Math.round(growthExposure * 100),
    riskLevel,
    message,
    actions,
  };
}

// ── Main Orchestrator ─────────────────────────────────────
/**
 * Core Intelligence 메인 함수.
 * macroData 하나만 받아서 전체 인지 흐름을 실행한다.
 *
 * @param {object} input - { macroData }
 * @returns {{ state, temporal, physics, regime, interpretation, strategy }}
 */
export function runCoreIntelligence({ macroData }) {
  // 데이터 없으면 안전한 기본값 반환
  if (!macroData) {
    return {
      state:          { totalRisk: 0.5, sefconLevel: 3, sefconScore: 50, creditRisk: 0.5, liquidityRisk: 0.5, speculationRisk: 0.5, macroRisk: 0.5, volatilityRisk: 0.5, valuationRisk: 0.5 },
      temporal:       { liquidityTrend: 0, creditAcceleration: 0, volatilityCompression: 0, speculationMomentum: 0, riskAcceleration: 0, labels: { liquidityTrend: "횡보", creditAcceleration: "횡보", volatilityCompression: "중립", speculationMomentum: "횡보", riskAcceleration: "횡보" } },
      physics:        { liquidityPressure: 0.5, valuationGravity: 0.5, creditStress: 0.5, dominantForce: "데이터 로딩 중" },
      regime:         { primaryLabel: "혼합/불확실형", tags: [], statePhrase: "중립 국면", crisisProximity: 0, topCrisis: null },
      interpretation: { summary: "데이터를 불러오는 중입니다.", lines: [], riskScore: 50, direction: "횡보" },
      strategy:       { cashBias: 30, defenseBias: 50, growthExposure: 30, riskLevel: "보통", message: "데이터 로딩 후 전략이 생성됩니다.", actions: [] },
    };
  }

  try {
    const state          = buildState(macroData);
    const temporal       = buildTemporal(macroData);
    const physics        = buildPhysics(macroData, state);
    const regime         = buildRegime(macroData, state, temporal);
    const interpretation = buildInterpretation(state, temporal, physics, regime);
    const strategy       = buildStrategy(state, temporal, physics, regime);

    return { state, temporal, physics, regime, interpretation, strategy };
  } catch (err) {
    console.warn("[CoreIntelligence] 계산 중 오류:", err);
    return {
      state:          { totalRisk: 0.5, sefconLevel: 3, sefconScore: 50, creditRisk: 0.5, liquidityRisk: 0.5, speculationRisk: 0.5, macroRisk: 0.5, volatilityRisk: 0.5, valuationRisk: 0.5 },
      temporal:       { liquidityTrend: 0, creditAcceleration: 0, volatilityCompression: 0, speculationMomentum: 0, riskAcceleration: 0, labels: { liquidityTrend: "횡보", creditAcceleration: "횡보", volatilityCompression: "중립", speculationMomentum: "횡보", riskAcceleration: "횡보" } },
      physics:        { liquidityPressure: 0.5, valuationGravity: 0.5, creditStress: 0.5, dominantForce: "계산 오류" },
      regime:         { primaryLabel: "혼합/불확실형", tags: [], statePhrase: "중립 국면", crisisProximity: 0, topCrisis: null },
      interpretation: { summary: "일시적 계산 오류가 발생했습니다. 앱을 새로고침해 주세요.", lines: [], riskScore: 50, direction: "횡보" },
      strategy:       { cashBias: 30, defenseBias: 50, growthExposure: 30, riskLevel: "보통", message: "계산 오류 — 새로고침 후 다시 시도해 주세요.", actions: [] },
    };
  }
}
