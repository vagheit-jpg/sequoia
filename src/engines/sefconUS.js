/**
 * SEQUOIA GLOBAL — SEFCON_US
 * engines/sefconUS.js
 *
 * 미국 시장 위험도 측정 엔진.
 * Physics_US + Regime_US + Market Profile 통합 포함.
 * 한국 SEFCON과 동일한 1~5단계 출력 구조.
 */

// ── 유틸 ─────────────────────────────────────────────────────
const last    = arr => arr?.slice(-1)[0]?.value ?? null;
const lastYoy = arr => [...(arr || [])].reverse().find(r => r.yoy != null)?.yoy ?? null;

const scoreV = (v, [bad2, bad1, good1, good2], dir = 1) => {
  if (v == null) return 0;
  if (v * dir >= bad2  * dir) return -2;
  if (v * dir >= bad1  * dir) return -1;
  if (v * dir <= good2 * dir) return +2;
  if (v * dir <= good1 * dir) return +1;
  return 0;
};

const clamp01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));
const safeNum = (v, fb = 0) => Number.isFinite(Number(v)) ? Number(v) : fb;

// ── Market Profile 가중치 (미국은 신용·유동성·변동성 더 중요)
const US_PROFILE = {
  신용위험: 0.32,
  유동성:   0.20,
  시장공포: 0.22,
  실물경기: 0.18,
  물가:     0.08,
};

// ── 데이터 freshness 체크 (정규화 레이어)
function normalizeSeries(arr, frequency = "monthly") {
  if (!arr || arr.length === 0) return { value: null, stale: true, frequency };
  const latest = arr[arr.length - 1];
  return {
    value:     latest?.value ?? null,
    updatedAt: latest?.date  ?? null,
    frequency,
    stale:     false,
  };
}

// ── SEFCON 점수 산출
function calcDefcon(indicators) {
  const cats = Object.keys(US_PROFILE);
  const catScores = cats.map(cat => {
    const inds   = indicators.filter(i => i.cat === cat);
    const catRaw = inds.reduce((s, i) => s + i.score, 0);
    const catMax = inds.reduce((s, i) => {
      const abs = Math.abs(i.score);
      if (abs > 3) return s + 4;
      if (abs > 2) return s + 3;
      return s + 2;
    }, 0) || (inds.length * 2);
    const score = catMax > 0
      ? Math.round((catRaw + catMax) / (catMax * 2) * 100)
      : 50;
    return { cat, score: Math.max(0, Math.min(100, score)), count: inds.length, weight: US_PROFILE[cat] };
  });

  const totalScore = Math.round(catScores.reduce((s, c) => s + c.score * c.weight, 0));
  return { totalScore, catScores, indicators, ...labelFromScore(totalScore) };
}

function labelFromScore(score) {
  if      (score <= 30) return { defcon:1, defconLabel:"SEFCON 1  붕괴임박", defconColor:"#FF1A1A", defconDesc:"복수의 위기 신호 동시 발생. 현금 비중 최우선." };
  else if (score <= 45) return { defcon:2, defconLabel:"SEFCON 2  위기",     defconColor:"#FF6B00", defconDesc:"선행지표 다수 경고. 리스크 자산 비중 축소 검토." };
  else if (score <= 58) return { defcon:3, defconLabel:"SEFCON 3  경계",     defconColor:"#F0C800", defconDesc:"일부 지표 악화. 포트폴리오 방어 태세 준비." };
  else if (score <= 72) return { defcon:4, defconLabel:"SEFCON 4  관망",     defconColor:"#38BDF8", defconDesc:"대체로 양호. 선별적 기회 탐색 가능." };
  else                  return { defcon:5, defconLabel:"SEFCON 5  안정",     defconColor:"#00C878", defconDesc:"전 지표 정상. 적극적 투자 환경." };
}

// ── C-Index 보정 (클러스터 페널티)
function applyCIndex(defconData) {
  const indicators = defconData.indicators || [];
  const hasRisk    = kw => (indicators.find(i => i.key?.includes(kw))?.score ?? 0) <= -1;

  const signals = {
    vix:   hasRisk("VIX"),
    hy:    hasRisk("BAML") || hasRisk("HY"),
    t10:   hasRisk("T10Y2Y"),
    sloos: hasRisk("SLOOS"),
    lei:   hasRisk("LEI"),
    dxy:   hasRisk("DXY"),
    m2:    hasRisk("M2"),
    ism:   hasRisk("ISM"),
  };

  const clusterCount = Object.values(signals).filter(Boolean).length;
  let clusterPenalty = 0;
  if (clusterCount >= 2) clusterPenalty += 3;
  if (clusterCount >= 3) clusterPenalty += 6;
  if (clusterCount >= 4) clusterPenalty += 10;

  let triggerPenalty = 0;
  if (signals.vix  && signals.hy)              triggerPenalty += 7;
  if (signals.t10  && signals.sloos)           triggerPenalty += 6;
  if (signals.dxy  && signals.m2)              triggerPenalty += 4;
  if (signals.vix  && signals.hy && signals.lei) triggerPenalty += 5;

  let confirmPenalty = 0;
  if (signals.lei)               confirmPenalty += 3;
  if (signals.ism)               confirmPenalty += 3;
  if (signals.lei && signals.ism) confirmPenalty += 3;

  const totalPenalty  = Math.min(30, clusterPenalty + triggerPenalty + confirmPenalty);
  const adjustedScore = Math.max(0, Math.min(100, defconData.totalScore - totalPenalty));

  // 위기 유형 판별
  let crisisType = "혼합형";
  if (signals.vix && signals.hy && signals.lei) crisisType = "복합 금융위기형";
  else if (signals.t10 && signals.sloos)         crisisType = "긴축·신용경색형";
  else if (signals.dxy && signals.m2)            crisisType = "달러 유동성 압박형";
  else if (signals.lei && signals.ism)           crisisType = "실물경기 둔화형";

  const topDrivers = Object.entries({
    "VIX 공포 확대":       signals.vix,
    "HY 스프레드 확대":    signals.hy,
    "장단기 금리 역전":    signals.t10,
    "대출기준 강화":       signals.sloos,
    "경기선행지수 둔화":   signals.lei,
    "달러 강세":           signals.dxy,
    "M2 위축":             signals.m2,
    "ISM 제조업 수축":     signals.ism,
  }).filter(([, v]) => v).map(([k]) => k);

  return {
    adjustedScore,
    totalPenalty, clusterCount, crisisType, topDrivers,
    ...labelFromScore(adjustedScore),
  };
}

// ── Physics_US
function buildPhysicsUS(usData, catScores) {
  const catScore = name => catScores.find(c => c.cat === name)?.score ?? 50;

  const lastVIX   = safeNum(last(usData?.vix),   20);
  const lastHY    = safeNum(last(usData?.hy),    1.8);
  const lastBAML  = safeNum(last(usData?.baml),  3.5);
  const lastDXY   = safeNum(last(usData?.dxy),   25);   // UUP 기준
  const lastTNX   = safeNum(last(usData?.tnx),    4);
  const lastSLOOS = safeNum(last(usData?.sloos),  0);
  const lastLEI   = safeNum(last(usData?.lei),   100);
  const lastISM   = safeNum(last(usData?.ism),    50);

  // 유동성 압력: DXY + 금리 + 연준 대차대조표
  const liquidityPressure = clamp01(
    clamp01((lastDXY - 22) / 8)  * 0.45 +
    clamp01(lastTNX / 6)          * 0.35 +
    clamp01(1 - catScore("유동성") / 100) * 0.20
  );

  // 밸류에이션 중력: 금리 + Baa 스프레드
  const valuationGravity = clamp01(
    clamp01(lastTNX / 6)           * 0.60 +
    clamp01((lastHY - 0.8) / 4.2)  * 0.40
  );

  // 신용 응력: BAML + SLOOS (미국 신용 시장 직접 반영)
  const creditStress = clamp01(
    clamp01((lastBAML - 2.5) / 8.0) * 0.60 +
    clamp01(lastSLOOS / 50)          * 0.40
  );

  // 변동성 에너지: VIX 저점 지속 = 에너지 축적
  const vix6mAvg = (usData?.vix || []).slice(-7)
    .reduce((s, r) => s + safeNum(r?.value, 20), 0) / 7;
  const volatilityEnergy = clamp01(
    Math.max(0, (18 - lastVIX) / 10) * 0.50 +
    Math.max(0, (18 - vix6mAvg) / 10) * 0.30 +
    clamp01(1 - catScore("시장공포") / 100) * 0.20
  );

  // 경기 모멘텀: LEI + ISM
  const economicMomentum = clamp01(
    clamp01((lastLEI - 97) / 5)  * 0.50 +
    clamp01((lastISM - 44) / 16) * 0.50
  );

  const forces = [
    { name: "유동성 압력",    val: liquidityPressure },
    { name: "밸류 중력",      val: valuationGravity },
    { name: "신용 응력",      val: creditStress },
    { name: "변동성 에너지",  val: volatilityEnergy },
    { name: "경기 모멘텀",    val: 1 - economicMomentum }, // 낮을수록 위험
  ];
  const dominantForce = forces.reduce((a, b) => a.val > b.val ? a : b).name;

  return {
    liquidityPressure: +liquidityPressure.toFixed(3),
    valuationGravity:  +valuationGravity.toFixed(3),
    creditStress:      +creditStress.toFixed(3),
    volatilityEnergy:  +volatilityEnergy.toFixed(3),
    economicMomentum:  +economicMomentum.toFixed(3),
    dominantForce,
  };
}

// ── Regime_US (8개 국면)
function buildRegimeUS(usData) {
  const t10y2y = last(usData?.t10y2y) ?? 0;
  const vix    = last(usData?.vix)    ?? 20;
  const lei    = last(usData?.lei)    ?? 100;
  const m2Yoy  = lastYoy(usData?.m2YoY) ?? 0;
  const ism    = last(usData?.ism)    ?? 50;
  const sloos  = last(usData?.sloos)  ?? 0;
  const baml   = last(usData?.baml)   ?? 3.5;

  // SP500 3개월 추세
  const sp = usData?.sp500 || [];
  const spTrend = sp.length >= 4
    ? ((sp.slice(-1)[0]?.value ?? 0) / (sp.slice(-4)[0]?.value ?? 1) - 1) * 100
    : 0;

  let current     = "혼합/불확실형";
  let primaryType = "unknown";
  let confidence  = 0.5;
  let reason      = "";

  if (vix < 15 && lei >= 100.5 && m2Yoy >= 3 && t10y2y >= 0) {
    current = "유동성 확장"; primaryType = "expansion";
    confidence = 0.8; reason = "VIX 저점·M2 확장·LEI 상승 동시";
  } else if (t10y2y < -0.5 && sloos > 25 && baml > 4.5) {
    current = "연준 긴축 후기"; primaryType = "rate_shock_late";
    confidence = 0.85; reason = "장단기역전+대출긴축+HY확대 동시";
  } else if (t10y2y < -0.2 && sloos > 10) {
    current = "연준 긴축 초기"; primaryType = "rate_shock_early";
    confidence = 0.75; reason = "장단기역전 진행+대출기준 강화";
  } else if (t10y2y >= -0.3 && t10y2y <= 0.5 && sloos <= 10 && baml <= 4.0) {
    current = "피봇 기대"; primaryType = "pivot_expect";
    confidence = 0.65; reason = "긴축 완화 신호·금리역전 축소";
  } else if (vix < 15 && spTrend > 10 && m2Yoy > 0 && lei >= 100) {
    current = "과열·버블"; primaryType = "bubble";
    confidence = 0.70; reason = "VIX 저점·주가 급등·유동성 양호";
  } else if (vix > 30 && baml > 5.5 && lei < 99) {
    current = "침체 진입"; primaryType = "recession_entry";
    confidence = 0.80; reason = "VIX 급등+HY확대+LEI 하락";
  } else if (vix > 40 && lei < 98 && ism < 46) {
    current = "침체 바닥"; primaryType = "recession_bottom";
    confidence = 0.75; reason = "공포 극대·실물 수축 동반";
  } else if (lei >= 99.5 && m2Yoy >= 0 && vix < 22 && spTrend > 0) {
    current = "회복 초기"; primaryType = "recovery";
    confidence = 0.70; reason = "LEI 반등·유동성 개선·변동성 안정";
  } else {
    current = "정상 확장"; primaryType = "normal";
    confidence = 0.55; reason = "뚜렷한 위기 신호 미확인";
  }

  // 전이 경로
  const transitionMap = {
    rate_shock_late:  { path: "긴축 후기 → 피봇 기대 또는 침체 진입 분기점",       direction: "경계" },
    rate_shock_early: { path: "긴축 초기 → 긴축 심화 가능성",                       direction: "악화" },
    pivot_expect:     { path: "피봇 기대 → 유동성 확장 전환 탐색",                   direction: "개선" },
    expansion:        { path: "유동성 확장 유지 — 버블 에너지 누적 모니터링",        direction: "주의" },
    bubble:           { path: "과열 국면 → 긴축 또는 유동성 위축 시 전환 위험",      direction: "주의" },
    normal:           { path: "정상 확장 유지 — 선행지표 방향 모니터링",             direction: "유지" },
    recovery:         { path: "회복 초입 → 정상 확장 전환 중",                       direction: "개선" },
    recession_entry:  { path: "침체 진입 → 바닥 탐색 구간",                          direction: "악화" },
    recession_bottom: { path: "침체 바닥 → 회복 초입 신호 탐색",                     direction: "개선" },
    unknown:          { path: null,                                                    direction: "유지" },
  };

  const { path: transitionPath, direction } = transitionMap[primaryType] || transitionMap.unknown;

  return { current, primaryType, transitionPath, direction, confidence: +confidence.toFixed(2), reason };
}

// ── 메인: calcSefconUS
export function calcSefconUS(usData) {
  if (!usData) return null;

  const sp = usData.sp500 || [];
  const spTrend3m = sp.length >= 4
    ? +((sp.slice(-1)[0]?.value ?? 0) / (sp.slice(-4)[0]?.value ?? 1) * 100 - 100).toFixed(1)
    : null;

  const indicators = [
    // ── 신용위험 (5개)
    { cat:"신용위험", key:"T10Y2Y", label:"미국 장단기금리차",
      val: last(usData.t10y2y), unit:"%",
      score: scoreV(last(usData.t10y2y), [-1.0, -0.5, 0.5, 1.0], -1) * 2 },
    { cat:"신용위험", key:"HY",     label:"Baa 신용스프레드",
      val: last(usData.hy), unit:"%p",
      score: Math.round(scoreV(last(usData.hy), [4.0, 3.0, 2.0, 1.5], 1) * 1.5) },
    { cat:"신용위험", key:"BAML",   label:"ICE BofA HY 스프레드",
      val: last(usData.baml), unit:"%p",
      score: Math.round(scoreV(last(usData.baml), [9.0, 6.0, 4.0, 3.0], 1) * 1.5) },
    { cat:"신용위험", key:"SLOOS",  label:"SLOOS 대출기준강화",
      val: last(usData.sloos), unit:"%",
      score: scoreV(last(usData.sloos), [50, 20, -5, -20], 1) },
    { cat:"신용위험", key:"LEI",    label:"미국 LEI 경기선행지수",
      val: last(usData.lei), unit:"",
      score: Math.round(scoreV(last(usData.lei), [98, 99, 100.5, 101.5], -1) * 1.5) },

    // ── 유동성 (4개)
    { cat:"유동성", key:"M2",       label:"미국 M2 YoY",
      val: lastYoy(usData.m2YoY), unit:"%",
      score: (() => { const v = lastYoy(usData.m2YoY); if (v==null) return 0; if (v<-2) return -2; if (v<0) return -1; if (v<=5) return 0; if (v<=10) return 1; return 0; })() },
    { cat:"유동성", key:"DXY",      label:"달러인덱스(UUP)",
      val: last(usData.dxy), unit:"",
      score: scoreV(last(usData.dxy), [29, 27, 24, 22], 1) },
    { cat:"유동성", key:"FEDBAL",   label:"연준 대차대조표 YoY",
      val: lastYoy(usData.fedBalYoY), unit:"%",
      score: (() => { const v = lastYoy(usData.fedBalYoY); if (v==null) return 0; if (v<-15) return -2; if (v<-5) return -1; if (v>=15) return 2; if (v>=5) return 1; return 0; })() },
    { cat:"유동성", key:"TNX",      label:"미국 10년물 국채금리",
      val: last(usData.tnx), unit:"%",
      score: scoreV(last(usData.tnx), [5.0, 4.5, 3.0, 2.0], 1) },

    // ── 시장공포 (3개)
    { cat:"시장공포", key:"VIX",    label:"VIX 공포지수",
      val: last(usData.vix), unit:"",
      score: scoreV(last(usData.vix), [35, 25, 18, 13], 1) },
    { cat:"시장공포", key:"ISM",    label:"ISM 제조업 PMI",
      val: last(usData.ism), unit:"",
      score: scoreV(last(usData.ism), [44, 47, 52, 55], -1) },
    { cat:"시장공포", key:"UMCS",   label:"소비자신뢰지수",
      val: last(usData.umcs), unit:"",
      score: scoreV(last(usData.umcs), [55, 65, 80, 90], -1) },

    // ── 실물경기 (3개)
    { cat:"실물경기", key:"UNRATE", label:"미국 실업률",
      val: last(usData.unrate), unit:"%",
      score: scoreV(last(usData.unrate), [5.5, 4.5, 3.8, 3.0], 1) },
    { cat:"실물경기", key:"ICSA",   label:"주간 실업청구(천건)",
      val: last(usData.icsa), unit:"k",
      score: scoreV(last(usData.icsa), [300, 250, 210, 180], 1) },
    { cat:"실물경기", key:"SP500",  label:"S&P500 3개월 추세",
      val: spTrend3m, unit:"%",
      score: spTrend3m==null ? 0 : spTrend3m<-15?-2:spTrend3m<-8?-1:spTrend3m>15?2:spTrend3m>5?1:0 },

    // ── 물가 (1개, 후행 — 가중치 낮음)
    { cat:"물가", key:"GLD",        label:"금(GLD) 6개월 추세",
      val: (() => { const a=usData.gld||[]; if(a.length<7)return null; const n=a.slice(-1)[0]?.value; const m=a.slice(-7)[0]?.value; return n&&m?+((n/m-1)*100).toFixed(1):null; })(),
      unit:"%",
      score: (() => { const a=usData.gld||[]; if(a.length<7)return 0; const n=a.slice(-1)[0]?.value; const m=a.slice(-7)[0]?.value; const ch=n&&m?(n/m-1)*100:0; return ch>20?-2:ch>10?-1:ch<-10?1:0; })() },
  ];

  const defconData = calcDefcon(indicators);
  const cIndex     = applyCIndex(defconData);

  // C-Index 보정 적용
  defconData.totalScore  = cIndex.adjustedScore;
  defconData.defcon      = cIndex.defcon;
  defconData.defconLabel = cIndex.defconLabel;
  defconData.defconColor = cIndex.defconColor;
  defconData.defconDesc  = cIndex.defconDesc;
  defconData.cIndex      = cIndex;

  const physics = buildPhysicsUS(usData, defconData.catScores);
  const regime  = buildRegimeUS(usData);

  return { defconData, physics, regime, market: "US" };
}
