/**
 * SEQUOIA Core Intelligence v2
 * ─────────────────────────────────────────
 * SEFCON을 해석하는 상위 사고체계.
 * 점수 계산기가 아닌 시장 전략 브리핑 엔진.
 *
 * 흐름:
 *   RAW DATA
 *   → State Layer        (현재 상태)
 *   → Temporal Layer     (시간 흐름 · 변화 방향) ← 강화
 *   → Physics Layer      (시장 힘 해석)          ← 강화
 *   → Regime Layer       (국면 + 전이 방향)      ← 신규
 *   → Interpretation     (브리핑 텍스트)         ← 강화
 *   → Strategy Layer     (전략 보정)
 */

// ── 안전 유틸 ────────────────────────────────────────────
const safeNum = (v, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

const clamp01 = (v) => Math.max(0, Math.min(1, safeNum(v)));
const clamp = (v, min, max) => Math.max(min, Math.min(max, safeNum(v, min)));

/** 배열 마지막 n번째 value (없으면 null) */
const lastN = (arr, n = 1) =>
  Array.isArray(arr) && arr.length >= n
    ? safeNum(arr[arr.length - n]?.value, null)
    : null;

/** 1m / 3m / 6m 변화율 */
const changeRate = (curr, prev) =>
  curr != null && prev != null && prev !== 0
    ? (curr - prev) / Math.abs(prev)
    : 0;

const safe = (arr) => (Array.isArray(arr) ? arr : []);

// ── 1. State Layer ────────────────────────────────────────
function buildState(macroData) {
  const dc = macroData?.defconData;
  const catScores = dc?.catScores || [];

  const catRisk = (catName) => {
    const cat = catScores.find((c) => c.cat === catName);
    return cat ? clamp01(1 - cat.score / 100) : 0.5;
  };

  const lastVIX   = safeNum(lastN(macroData?.fredVIX),   20);
  const lastBaa   = safeNum(lastN(macroData?.fredHY),    1.8);  // Baa 스프레드
  const lastHY    = safeNum(lastN(macroData?.fredBAML),  3.5);  // ICE BofA HY
  const lastDXY   = safeNum(lastN(macroData?.yahooDXY),  100);
  const lastRate  = safeNum(lastN(macroData?.rate),        2);
  const lastLEI   = safeNum(lastN(macroData?.fredLEI),     0);
  const lastSLOOS = safeNum(lastN(macroData?.fredSLOOS),   0);

  const creditRisk = clamp01(
    catRisk("신용위험") * 0.5 +
    clamp01((lastBaa - 1.0) / 4.0) * 0.3 +
    clamp01((lastHY  - 2.5) / 8.0) * 0.2
  );
  const liquidityRisk  = clamp01(catRisk("유동성")   * 0.7 + clamp01((lastDXY - 95) / 20) * 0.3);
  const speculationRisk = clamp01(catRisk("시장공포") * 0.6 + clamp01((lastVIX - 15) / 50) * 0.4);
  const macroRisk      = clamp01(catRisk("실물경기") * 0.6 + clamp01((-lastLEI) / 5) * 0.4);
  const volatilityRisk = clamp01(clamp01((lastVIX - 12) / 40) * 0.6 + catRisk("시장공포") * 0.4);
  const valuationRisk  = clamp01(clamp01(lastRate / 8) * 0.6 + clamp01((lastBaa - 1.0) / 4.0) * 0.4);

  const sefBase = dc?.totalScore != null ? clamp01(1 - dc.totalScore / 100) : 0.5;
  const totalRisk = clamp01(
    sefBase * 0.5 +
    (creditRisk + liquidityRisk + speculationRisk + macroRisk + volatilityRisk + valuationRisk) / 6 * 0.5
  );

  return {
    creditRisk, liquidityRisk, speculationRisk,
    macroRisk, volatilityRisk, valuationRisk,
    totalRisk,
    sefconLevel: dc?.defcon ?? 3,
    sefconScore: dc?.totalScore ?? 50,
  };
}

// ── 2. Temporal Layer v2 (강화) ───────────────────────────
function buildTemporal(macroData) {
  // DXY: 유동성 압력
  const dxy = safe(macroData?.yahooDXY);
  const dxy0 = lastN(dxy, 1), dxy1m = lastN(dxy, 2), dxy3m = lastN(dxy, 4), dxy6m = lastN(dxy, 7);
  const liquidityTrend1m = clamp(changeRate(dxy0, dxy1m) * 3, -1, 1);
  const liquidityTrend3m = clamp(changeRate(dxy0, dxy3m) * 2, -1, 1);

  // 금리
  const rate = safe(macroData?.rate);
  const rate0 = lastN(rate, 1), rate3m = lastN(rate, 4);
  const rateTrend = clamp(changeRate(rate0, rate3m) * 5, -1, 1);

  // M2 추세 (낮을수록 유동성 압박)
  const m2 = safe(macroData?.usM2YoY);
  const m2_0 = lastN(m2, 1), m2_3m = lastN(m2, 4);
  const m2Trend = clamp(changeRate(m2_0, m2_3m) * 2, -1, 1) * -1; // M2 감소 = 압박 증가

  // 종합 유동성 트렌드 (DXY 주도)
  const liquidityTrend = clamp(liquidityTrend1m * 0.5 + liquidityTrend3m * 0.3 + rateTrend * 0.2, -1, 1);

  // HY 신용 가속도 (ICE BofA HY — 빠른 선행)
  const hy = safe(macroData?.fredBAML);
  const hy0 = lastN(hy, 1), hy1m = lastN(hy, 2), hy3m = lastN(hy, 4), hy6m = lastN(hy, 7);
  const creditTrend1m = clamp(changeRate(hy0, hy1m) * 3, -1, 1);
  const creditTrend3m = clamp(changeRate(hy0, hy3m) * 2, -1, 1);
  const creditAcceleration = clamp(
    creditTrend1m * 0.6 + (creditTrend1m - creditTrend3m / 3) * 0.4,
    -1, 1
  );

  // VIX 변동성 압축
  const vix = safe(macroData?.fredVIX);
  const vix0  = safeNum(lastN(vix, 1), 20);
  const vix3m = vix.slice(-4).reduce((s, r) => s + safeNum(r?.value, 20), 0) / Math.max(vix.slice(-4).length, 1);
  const vix6m = vix.slice(-7).reduce((s, r) => s + safeNum(r?.value, 20), 0) / Math.max(vix.slice(-7).length, 1);
  const volatilityCompression = clamp((vix6m - vix0) / 15, -1, 1); // 양수 = 압축 중

  // 투기 모멘텀 (VIX 하락 = 투기 과열)
  const speculationMomentum = clamp(changeRate(vix0, vix3m) * -2, -1, 1);

  // 전체 위험 가속도
  const riskAcceleration = clamp(
    creditAcceleration * 0.5 + liquidityTrend * 0.3 + rateTrend * 0.2,
    -1, 1
  );

  const dirLabel = (v) =>
    v > 0.35 ? "빠르게 악화" :
    v > 0.15 ? "점진 악화" :
    v < -0.35 ? "빠르게 개선" :
    v < -0.15 ? "점진 개선" : "횡보";

  return {
    liquidityTrend, liquidityTrend1m, liquidityTrend3m,
    creditTrend1m, creditTrend3m, creditAcceleration,
    volatilityCompression, speculationMomentum, riskAcceleration,
    m2Trend,
    labels: {
      liquidityTrend:        dirLabel(liquidityTrend),
      liquidityTrend1m:      dirLabel(liquidityTrend1m),
      creditAcceleration:    dirLabel(creditAcceleration),
      volatilityCompression: volatilityCompression > 0.3 ? "압축 심화" : volatilityCompression > 0.1 ? "압축 중" : volatilityCompression < -0.2 ? "확산 중" : "중립",
      speculationMomentum:   dirLabel(speculationMomentum),
      riskAcceleration:      dirLabel(riskAcceleration),
    },
  };
}

// ── 3. Physics Layer v2 (확장) ────────────────────────────
function buildPhysics(macroData, state, temporal) {
  const lastRate  = safeNum(lastN(macroData?.rate),       2);
  const lastBaa   = safeNum(lastN(macroData?.fredHY),    1.8);
  const lastHY    = safeNum(lastN(macroData?.fredBAML),  3.5);
  const lastDXY   = safeNum(lastN(macroData?.yahooDXY),  100);
  const lastSLOOS = safeNum(lastN(macroData?.fredSLOOS),   0);
  const lastVIX   = safeNum(lastN(macroData?.fredVIX),    20);

  // 유동성 압력: DXY + 금리 + 유동성 위험
  const liquidityPressure = clamp01(
    clamp01((lastDXY - 90) / 25) * 0.5 +
    clamp01(lastRate / 7) * 0.3 +
    state.liquidityRisk * 0.2
  );

  // 밸류에이션 중력: 금리 + Baa 스프레드
  const valuationGravity = clamp01(
    clamp01(lastRate / 6) * 0.6 +
    clamp01((lastBaa - 0.8) / 4.2) * 0.4
  );

  // 신용 응력: HY + SLOOS
  const creditStress = clamp01(
    clamp01((lastHY - 2.5) / 8.0) * 0.6 +
    clamp01(lastSLOOS / 50) * 0.4
  );

  // 변동성 에너지: 장기 VIX 압축이 쌓인 폭발 잠재력
  // VIX가 낮게 오래 유지될수록 에너지 축적
  const vix6mAvg = safe(macroData?.fredVIX).slice(-7)
    .reduce((s, r) => s + safeNum(r?.value, 20), 0) / 7;
  const volatilityEnergy = clamp01(
    Math.max(0, (18 - lastVIX) / 10) * 0.5 +   // 현재 VIX 낮을수록
    temporal.volatilityCompression * 0.3 +        // 압축 심할수록
    Math.max(0, (18 - vix6mAvg) / 10) * 0.2      // 6개월 평균 VIX 낮을수록
  );

  // 투기 에너지: 투기 모멘텀 + speculationRisk
  const bubbleEnergy = clamp01(
    temporal.speculationMomentum * 0.5 +
    state.speculationRisk * 0.5
  );

  // 지배적 힘
  const forces = [
    { name: "유동성 압력", val: liquidityPressure },
    { name: "밸류 중력",   val: valuationGravity },
    { name: "신용 응력",   val: creditStress },
    { name: "변동성 에너지", val: volatilityEnergy },
  ];
  const dominantForce = forces.reduce((a, b) => a.val > b.val ? a : b).name;

  return {
    liquidityPressure, valuationGravity, creditStress,
    volatilityEnergy, bubbleEnergy, dominantForce,
  };
}

// ── 4. Regime Layer v2 (전이 방향 추가) ───────────────────
function buildRegime(macroData, state, temporal, physics) {
  const primaryLabel = macroData?.regimeInsight?.regime?.primaryLabel || "혼합/불확실형";
  const crisisProximity = macroData?.crisisAnalysis?.navigation?.proximityScore ?? 0;
  const topCrisis = macroData?.crisisAnalysis?.navigation?.topCrisis?.label ?? null;

  // 레짐 태그
  const tags = [primaryLabel];
  if (crisisProximity >= 60) tags.push("위기 패턴 근접");
  if (temporal.riskAcceleration > 0.3) tags.push("위험 가속화");
  if (temporal.volatilityCompression > 0.4) tags.push("변동성 에너지 축적");
  if (state.speculationRisk > 0.7) tags.push("투기 과열");
  if (state.creditRisk > 0.7) tags.push("신용 경색 위험");
  if (temporal.liquidityTrend > 0.3) tags.push("유동성 이탈 중");

  // 국면 전이 경로 (현재 레짐 → 가능한 다음 국면)
  const r = primaryLabel;
  let transitionPath = null;
  let direction = "유지"; // "악화" | "개선" | "유지"

  if (r.includes("정상") || r.includes("확장")) {
    if (temporal.riskAcceleration > 0.2 || physics.bubbleEnergy > 0.5) {
      transitionPath = "정상 확장 → 버블 초입 가능성";
      direction = "주의";
    } else {
      transitionPath = "정상 확장 유지 중";
    }
  } else if (r.includes("버블") && r.includes("초입")) {
    transitionPath = "버블 초입 → 버블 말기 진행 중";
    direction = "주의";
  } else if (r.includes("버블") && r.includes("말기")) {
    transitionPath = "버블 말기 → 긴축·유동성 스트레스 전이 가능";
    direction = "악화";
  } else if (r.includes("긴축") || r.includes("금리")) {
    if (temporal.creditAcceleration > 0.3) {
      transitionPath = "긴축 국면 → 유동성·신용 스트레스 전이 위험";
      direction = "악화";
    } else {
      transitionPath = "긴축 압력 지속 — 피벗 신호 탐색 중";
      direction = "경계";
    }
  } else if (r.includes("유동성")) {
    transitionPath = "유동성 위기 → 신용경색 전이 경계";
    direction = "악화";
  } else if (r.includes("신용")) {
    transitionPath = "신용경색 → 복합위기 또는 정책 안정화 분기";
    direction = "악화";
  } else if (r.includes("복합")) {
    transitionPath = "복합위기 심화 — 정책 대응 대기";
    direction = "악화";
  } else if (r.includes("침체") || r.includes("바닥")) {
    transitionPath = "침체 바닥 → 회복 초입 신호 탐색";
    direction = "개선";
  } else if (r.includes("회복")) {
    transitionPath = "회복 초입 → 정상 확장 전환 중";
    direction = "개선";
  }

  const statePhrase =
    state.totalRisk > 0.75 ? "고위험 국면" :
    state.totalRisk > 0.55 ? "경계 국면" :
    state.totalRisk > 0.35 ? "중립 국면" : "안정 국면";

  return {
    primaryLabel, tags, statePhrase,
    direction, transitionPath,
    crisisProximity, topCrisis,
  };
}


// ── 5. Cycle Intelligence Layer ───────────────────────────
/**
 * Howard Marks / Stanley Druckenmiller / Ray Dalio 철학을
 * 하나의 사이클 판단 계층으로 통합한다.
 * - Marks: 사이클 위치와 공격/방어 판단
 * - Druckenmiller: 유동성·추세 모멘텀
 * - Dalio: 부채·금리·유동성 사이클 압력
 */
function buildCycle(state, temporal, physics, regime) {
  let position = "낙관 확산";

  if (state.creditRisk > 0.75 || physics.creditStress > 0.75) {
    position = "유동성/신용 스트레스";
  } else if (physics.bubbleEnergy > 0.7 && physics.valuationGravity > 0.6) {
    position = "후기 긴축";
  } else if (physics.bubbleEnergy > 0.7 || state.speculationRisk > 0.7) {
    position = "투기 과열";
  } else if (state.totalRisk < 0.35 && temporal.riskAcceleration < -0.1) {
    position = "회복 초입";
  } else if (state.totalRisk < 0.35 && temporal.riskAcceleration <= 0) {
    position = "건전 확장";
  } else if (state.totalRisk > 0.55 && temporal.riskAcceleration > 0.2) {
    position = "후기 긴축";
  } else if (state.totalRisk > 0.70) {
    position = "공포/침체 저점";
  }

  const attackDefenseMap = {
    "공포/침체 저점": "점진 공격",
    "회복 초입": "공격 확대",
    "건전 확장": "균형",
    "낙관 확산": "선택적 공격",
    "투기 과열": "방어 준비",
    "후기 긴축": "방어 우위",
    "유동성/신용 스트레스": "초방어",
  };

  const psychology =
    position === "공포/침체 저점" ? "공포 우세" :
    position === "회복 초입" ? "비관 완화" :
    position === "건전 확장" ? "균형 심리" :
    position === "낙관 확산" ? "낙관 확산" :
    position === "투기 과열" ? "탐욕 과열" :
    position === "후기 긴축" ? "낙관 잔존·경계 확대" :
    "공포 전이";

  const riskAppetite =
    position === "공포/침체 저점" ? "낮음" :
    position === "회복 초입" ? "회복 중" :
    position === "건전 확장" ? "정상" :
    position === "낙관 확산" ? "상승" :
    position === "투기 과열" ? "과도" :
    position === "후기 긴축" ? "둔화 시작" :
    "급격히 위축";

  const liquidityMomentum =
    temporal.liquidityTrend > 0.25 || physics.liquidityPressure > 0.65
      ? "유동성 역풍"
      : temporal.liquidityTrend < -0.2
      ? "유동성 순풍"
      : "유동성 중립";

  const trendMomentum =
    temporal.riskAcceleration > 0.2
      ? "Risk-Off 전환"
      : temporal.riskAcceleration < -0.2
      ? "Risk-On 회복"
      : "추세 중립";

  const debtCycle =
    physics.creditStress > 0.7
      ? "부채 스트레스"
      : physics.valuationGravity > 0.65 && physics.liquidityPressure > 0.6
      ? "긴축 사이클"
      : state.creditRisk < 0.4 && state.liquidityRisk < 0.45
      ? "신용 확장"
      : "중립 부채 사이클";

  const transition =
    position === "투기 과열" ? "투기 과열 → 후기 긴축 가능성" :
    position === "후기 긴축" ? "후기 긴축 → 유동성/신용 스트레스 가능성" :
    position === "유동성/신용 스트레스" ? "스트레스 → 정책 대응/침체 바닥 분기" :
    position === "공포/침체 저점" ? "공포 → 회복 초입 가능성" :
    position === "회복 초입" ? "회복 초입 → 건전 확장 가능성" :
    position === "건전 확장" ? "건전 확장 → 낙관 확산 가능성" :
    "낙관 확산 → 투기 과열 가능성";

  const confidence = clamp01(
    0.45 +
    Math.abs(state.totalRisk - 0.5) * 0.35 +
    Math.abs(temporal.riskAcceleration) * 0.12 +
    Math.max(physics.liquidityPressure, physics.valuationGravity, physics.creditStress, physics.volatilityEnergy) * 0.08
  );

  const memo = (() => {
    if (position === "후기 긴축" || position === "유동성/신용 스트레스") {
      return "사이클은 후반부에 위치합니다. 기대수익 극대화보다 손실 회피와 방어력이 더 중요한 구간입니다.";
    }
    if (position === "투기 과열") {
      return "투자자 낙관과 위험 감수 성향이 강합니다. 상승 관성은 남아 있으나 안전마진은 축소되는 구간입니다.";
    }
    if (position === "공포/침체 저점" || position === "회복 초입") {
      return "공포가 상당 부분 가격에 반영된 구간입니다. 완전한 확신보다 점진적 공격과 분산이 중요합니다.";
    }
    return "사이클은 중립권에 가깝습니다. 과도한 확신보다 가격·유동성·신용의 균형을 함께 확인해야 합니다.";
  })();

  return {
    position,
    psychology,
    riskAppetite,
    attackDefenseMode: attackDefenseMap[position] || "균형",
    liquidityMomentum,
    trendMomentum,
    debtCycle,
    transition,
    confidence,
    memo,
    lenses: {
      marks: `${position} / ${attackDefenseMap[position] || "균형"}`,
      druckenmiller: `${liquidityMomentum} · ${trendMomentum}`,
      dalio: debtCycle,
    },
  };
}

// ── 5. Interpretation Layer v2 (브리핑형 4구조) ───────────
function buildInterpretation(state, temporal, physics, regime, cycle) {
  // ① 현재 상태
  const part1 = (() => {
    const r = regime.primaryLabel;
    const dominantDesc =
      physics.dominantForce === "유동성 압력" ? "유동성 압력이 지배적인" :
      physics.dominantForce === "밸류 중력"   ? "밸류에이션 부담이 지배적인" :
      physics.dominantForce === "신용 응력"   ? "신용 스트레스가 주도하는" :
      physics.dominantForce === "변동성 에너지" ? "변동성 에너지가 축적된" : "";
    return `현재 시장은 ${r} 국면으로, ${dominantDesc} 환경입니다.`;
  })();

  // ② 시간 방향
  const part2 = (() => {
    const parts = [];
    if (temporal.liquidityTrend > 0.15) {
      parts.push(`유동성 압력은 ${temporal.labels.liquidityTrend} 흐름`);
    } else if (temporal.liquidityTrend < -0.15) {
      parts.push(`유동성은 ${temporal.labels.liquidityTrend} 흐름`);
    }
    if (temporal.creditAcceleration > 0.15) {
      parts.push(`신용 스트레스가 ${temporal.labels.creditAcceleration}`);
    }
    if (temporal.volatilityCompression > 0.3) {
      parts.push(`변동성이 ${temporal.labels.volatilityCompression} 에너지가 축적되는 중`);
    }
    if (!parts.length) return null;
    return parts.join(", ") + "입니다.";
  })();

  // ③ 지배적 힘
  const part3 = (() => {
    if (physics.liquidityPressure > 0.65)
      return `달러 강세와 금리 환경이 시장 유동성을 흡수하는 힘으로 작용하고 있습니다.`;
    if (physics.creditStress > 0.65)
      return `하이일드 스프레드 확대와 대출 기준 강화가 신용 시장을 압박하고 있습니다.`;
    if (physics.valuationGravity > 0.65)
      return `현재 금리 수준은 고밸류 자산에 강한 하방 압력을 가하고 있습니다.`;
    if (physics.volatilityEnergy > 0.6)
      return `장기 저변동성 구간이 지속되며 갑작스러운 가격 재조정 가능성이 누적되고 있습니다.`;
    return null;
  })();

  // ④ 전략 시사점
  const part4 = (() => {
    if (regime.transitionPath) return `국면 전이: ${regime.transitionPath}.`;
    return null;
  })();

  // ⑤ 사이클 인텔리전스
  const part5 = cycle?.memo ? `사이클 해석: ${cycle.memo}` : null;

  const lines = [part1, part2, part3, part4, part5].filter(Boolean);

  // 방향
  const direction =
    temporal.riskAcceleration > 0.15 ? "악화" :
    temporal.riskAcceleration < -0.15 ? "개선" : "횡보";

  return {
    summary: lines.join(" "),
    lines,
    direction,
    riskScore: Math.round(state.totalRisk * 100), // 내부용 (UI 비표시)
  };
}

// ── 6. Strategy Layer ─────────────────────────────────────
function buildStrategy(state, temporal, physics, regime, cycle) {
  const sefLv = state.sefconLevel;
  let cashBias = sefLv <= 1 ? 0.7 : sefLv === 2 ? 0.5 : sefLv === 3 ? 0.3 : sefLv === 4 ? 0.15 : 0.1;
  if (physics.creditStress > 0.65) cashBias = Math.min(1, cashBias + 0.1);
  if (temporal.riskAcceleration > 0.3) cashBias = Math.min(1, cashBias + 0.05);
  if (cycle?.attackDefenseMode === "초방어") cashBias = Math.min(1, cashBias + 0.15);
  if (cycle?.attackDefenseMode === "방어 우위") cashBias = Math.min(1, cashBias + 0.08);
  if (cycle?.attackDefenseMode === "공격 확대") cashBias = Math.max(0, cashBias - 0.08);
  cashBias = clamp01(cashBias);

  const defenseBias   = clamp01(state.totalRisk * 0.7 + physics.liquidityPressure * 0.3);
  const growthExposure = clamp01(1 - state.totalRisk * 0.8 - physics.valuationGravity * 0.2);

  const riskLevel =
    state.totalRisk > 0.75 ? "매우 높음" :
    state.totalRisk > 0.55 ? "높음" :
    state.totalRisk > 0.35 ? "보통" : "낮음";

  let message;
  if (cashBias >= 0.6)      message = "현금·국채 중심 방어 최우선. 공격 포지션 즉각 축소.";
  else if (cashBias >= 0.4) message = "현금 비중 확대, 방어자산 중심 재편.";
  else if (cashBias >= 0.2) message = "현금흐름 우량주·방어주 중심 선별적 운용.";
  else                      message = "우량 성장주 중심 적극 운용 가능.";

  const actions = [];
  if (physics.creditStress > 0.6)      actions.push("레버리지·저유동성 자산 회피");
  if (physics.valuationGravity > 0.6)  actions.push("고PER·성장주 비중 축소");
  if (temporal.liquidityTrend > 0.25)  actions.push("달러 자산 비중 점검");
  if (physics.volatilityEnergy > 0.5)  actions.push("변동성 확대 대비 분산");
  if (cycle?.attackDefenseMode === "방어 우위" || cycle?.attackDefenseMode === "초방어") actions.push("사이클 후반부 기준 방어 우선");
  if (cycle?.attackDefenseMode === "점진 공격" || cycle?.attackDefenseMode === "공격 확대") actions.push("사이클 저점/회복 기준 분할 공격 검토");
  if (state.totalRisk < 0.35 && growthExposure > 0.6) actions.push("우량 성장주 비중 확대 검토");

  return { cashBias: Math.round(cashBias * 100), defenseBias: Math.round(defenseBias * 100),
           growthExposure: Math.round(growthExposure * 100), riskLevel, message, actions,
           attackDefenseMode: cycle?.attackDefenseMode || "균형" };
}

// ── Main Orchestrator ─────────────────────────────────────
const FALLBACK = {
  state:          { totalRisk:0.5, sefconLevel:3, sefconScore:50, creditRisk:0.5, liquidityRisk:0.5, speculationRisk:0.5, macroRisk:0.5, volatilityRisk:0.5, valuationRisk:0.5 },
  temporal:       { liquidityTrend:0, liquidityTrend1m:0, liquidityTrend3m:0, creditTrend1m:0, creditTrend3m:0, creditAcceleration:0, volatilityCompression:0, speculationMomentum:0, riskAcceleration:0, m2Trend:0, labels:{ liquidityTrend:"횡보", liquidityTrend1m:"횡보", creditAcceleration:"횡보", volatilityCompression:"중립", speculationMomentum:"횡보", riskAcceleration:"횡보" } },
  physics:        { liquidityPressure:0.5, valuationGravity:0.5, creditStress:0.5, volatilityEnergy:0.3, bubbleEnergy:0.3, dominantForce:"데이터 로딩 중" },
  regime:         { primaryLabel:"혼합/불확실형", tags:[], statePhrase:"중립 국면", direction:"유지", transitionPath:null, crisisProximity:0, topCrisis:null },
  cycle:          { position:"판단 대기", psychology:"데이터 부족", riskAppetite:"중립", attackDefenseMode:"균형", liquidityMomentum:"중립", trendMomentum:"중립", debtCycle:"중립", transition:"데이터 축적 후 판단", confidence:0, memo:"사이클 판단을 위한 데이터 로딩 중입니다.", lenses:{marks:"대기", druckenmiller:"대기", dalio:"대기"} },
  interpretation: { summary:"데이터를 불러오는 중입니다.", lines:["데이터를 불러오는 중입니다."], direction:"횡보", riskScore:50 },
  strategy:       { cashBias:30, defenseBias:50, growthExposure:30, riskLevel:"보통", message:"데이터 로딩 후 전략이 생성됩니다.", actions:[], attackDefenseMode:"균형" },
};

export function runCoreIntelligence({ macroData }) {
  if (!macroData) return FALLBACK;
  try {
    const state          = buildState(macroData);
    const temporal       = buildTemporal(macroData);
    const physics        = buildPhysics(macroData, state, temporal);
    const regime         = buildRegime(macroData, state, temporal, physics);
    const cycle          = buildCycle(state, temporal, physics, regime);
    const interpretation = buildInterpretation(state, temporal, physics, regime, cycle);
    const strategy       = buildStrategy(state, temporal, physics, regime, cycle);
    return { state, temporal, physics, regime, cycle, interpretation, strategy };
  } catch (err) {
    console.warn("[CoreIntelligence v2] 계산 오류:", err);
    return { ...FALLBACK,
      interpretation: { ...FALLBACK.interpretation, summary:"일시적 계산 오류 — 새로고침 후 다시 시도해 주세요." }
    };
  }
}

