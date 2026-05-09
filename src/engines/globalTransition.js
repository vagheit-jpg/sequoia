/**
 * SEQUOIA GLOBAL — Global Transition Layer
 * engines/globalTransition.js
 *
 * 한국과 미국을 단순 비교하지 않고, 시장 간 전이 리스크를 해석한다.
 * 핵심: 미국 위험이 한국으로 전이되는 경로와 강도를 측정.
 */

const clamp01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));

/**
 * 전이 리스크 계산
 * @param {object} koreaIntel  - runCoreIntelligence 결과 (KOREA)
 * @param {object} usIntel     - runCoreIntelligenceUS 결과 (US)
 * @param {object} sefconUS    - calcSefconUS 결과
 * @param {object} macroData   - 기존 macro.js 데이터 (한국 FX, 외국인 등)
 */
export function buildGlobalTransition(koreaIntel, usIntel, sefconUS, macroData) {
  if (!koreaIntel || !usIntel || !sefconUS) {
    return {
      usToKorea:              0,
      dollarShock:            0,
      liquidityTransmission:  0,
      volatilitySpillover:    0,
      divergence:             0,
      summary:                "데이터 로딩 중입니다.",
      signals:                [],
      comparisonTable:        [],
    };
  }

  const usState   = usIntel.state   || {};
  const krState   = koreaIntel.state || {};
  const usPhysics = sefconUS.physics || {};
  const krPhysics = koreaIntel.physics || {};
  const usRegime  = sefconUS.regime  || {};

  // ── 1. 달러 충격: DXY 강세 → 한국 원화 압박 → 외국인 이탈
  const lastFX  = (macroData?.fx || []).slice(-1)[0]?.value ?? 1300;
  const dollarShock = clamp01(
    usPhysics.liquidityPressure * 0.5 +
    clamp01((lastFX - 1200) / 400) * 0.5
  );

  // ── 2. 유동성 전이: 미국 M2 위축 → 글로벌 유동성 감소 → 한국 타격
  const liquidityTransmission = clamp01(
    usPhysics.liquidityPressure * 0.6 +
    usState.liquidityRisk       * 0.4
  );

  // ── 3. 변동성 전이: VIX 상승 → 한국 변동성 동반 상승
  const volatilitySpillover = clamp01(
    usPhysics.volatilityEnergy  * 0.5 +
    usState.volatilityRisk      * 0.5
  );

  // ── 4. 미국→한국 전이 종합 리스크
  const usToKorea = clamp01(
    dollarShock            * 0.35 +
    liquidityTransmission  * 0.35 +
    volatilitySpillover    * 0.30
  );

  // ── 5. 한·미 SEFCON 다이버전스 (한국이 미국보다 덜 위험하면 과거 따라잡기 위험)
  const usSEF = sefconUS.defconData?.totalScore ?? 50;
  const krSEF = koreaIntel.state?.sefconScore   ?? 50;
  const divergence = clamp01(Math.abs(usSEF - krSEF) / 50);
  const koreaLagging = krSEF > usSEF; // 한국이 미국보다 안전 → 전이 위험

  // ── 전이 신호 목록
  const signals = [];
  if (dollarShock > 0.6)           signals.push("달러 강세 압력 → 원화 약세 위험");
  if (liquidityTransmission > 0.6) signals.push("미국 유동성 위축 → 글로벌 전이 경로 활성");
  if (volatilitySpillover > 0.6)   signals.push("VIX 에너지 → 한국 변동성 동반 상승 가능");
  if (koreaLagging && divergence > 0.3) signals.push("한국이 미국보다 완화적 — 전이 시 추격 하락 주의");

  // ── 전이 강도 레이블
  const intensityLabel =
    usToKorea > 0.70 ? "🔴 강한 전이 위험" :
    usToKorea > 0.50 ? "🟠 전이 위험 상승" :
    usToKorea > 0.30 ? "🟡 전이 가능성 관찰" : "🟢 전이 위험 낮음";

  // ── 요약 문장 (해석형, 예언 금지)
  const usSEFLabel   = sefconUS.defconData?.defconLabel?.split(" ").slice(-1)[0] ?? "";
  const krSEFLabel   = `${koreaIntel.state?.sefconLevel ?? 3}단계`;
  const regimeLabel  = usRegime.current ?? "혼합";

  let summary = `미국은 ${regimeLabel} 국면(${usSEFLabel}), 한국은 SEFCON ${krSEFLabel}입니다. `;
  if (usToKorea > 0.5) {
    summary += `미국 ${usPhysics.dominantForce ?? "시장"} 압력이 한국으로 전이될 가능성이 상승하고 있습니다.`;
  } else if (koreaLagging && divergence > 0.3) {
    summary += `한국과 미국의 위험 수준 차이가 관찰됩니다. 미국 위험 확대 시 한국 추격 조정 가능성을 모니터링할 시기입니다.`;
  } else {
    summary += `현재 전이 위험은 제한적이나 미국 선행 지표 변화에 주목할 필요가 있습니다.`;
  }

  // ── 비교 테이블 (GLOBAL 화면용)
  const comparisonTable = [
    {
      label: "SEFCON",
      korea: `${koreaIntel.state?.sefconLevel ?? "-"}단계`,
      us:    `${sefconUS.defconData?.defcon ?? "-"}단계`,
      note:  koreaLagging ? "한국 상대적 완화" : "유사 수준",
    },
    {
      label: "지배적 힘",
      korea: krPhysics.dominantForce ?? "-",
      us:    usPhysics.dominantForce ?? "-",
      note:  krPhysics.dominantForce === usPhysics.dominantForce ? "동조화" : "분리",
    },
    {
      label: "국면",
      korea: koreaIntel.regime?.primaryLabel ?? "-",
      us:    usRegime.current ?? "-",
      note:  "",
    },
    {
      label: "전이 리스크",
      korea: "-",
      us:    intensityLabel,
      note:  "",
    },
  ];

  return {
    usToKorea:             +usToKorea.toFixed(3),
    dollarShock:           +dollarShock.toFixed(3),
    liquidityTransmission: +liquidityTransmission.toFixed(3),
    volatilitySpillover:   +volatilitySpillover.toFixed(3),
    divergence:            +divergence.toFixed(3),
    koreaLagging,
    intensityLabel,
    summary,
    signals,
    comparisonTable,
  };
}
