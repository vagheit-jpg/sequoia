/**
 * SEQUOIA GLOBAL — SEFCON_US v2 (캘리브레이션 완료)
 * engines/sefconUS.js
 *
 * 주요 변경:
 * 1. 한국과 동일한 점수 스케일 (100=안정, 0=시스템위기)
 * 2. 미국 낙관 편향 제거 — 밸류에이션·버블에너지 가중치 강화
 * 3. Freshness 시스템 — SLOOS(분기), LEI(월) 영향력 감쇠
 * 4. changeDrivers — 변화 원인 레이어 추가
 */

const last    = arr => arr?.slice(-1)[0]?.value ?? null;
const lastYoy = arr => [...(arr || [])].reverse().find(r => r.yoy != null)?.yoy ?? null;
const clamp01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));
const safeNum = (v, fb = 0) => Number.isFinite(Number(v)) ? Number(v) : fb;

const scoreV = (v, [bad2, bad1, good1, good2], dir = 1) => {
  if (v == null) return 0;
  if (v * dir >= bad2  * dir) return -2;
  if (v * dir >= bad1  * dir) return -1;
  if (v * dir <= good2 * dir) return +2;
  if (v * dir <= good1 * dir) return +1;
  return 0;
};

// ── Freshness: 데이터 신선도 가중치
// stale 데이터는 영향력을 감쇠시킴
function getFreshness(arr, freqDays) {
  if (!arr || arr.length === 0) return 0.3; // 데이터 없으면 영향 최소화
  const lastDate = arr[arr.length - 1]?.date;
  if (!lastDate) return 0.7;
  // date가 YYYYMM 형태
  const ym = String(lastDate).replace(/\D/g, '').slice(0, 6);
  const y = parseInt(ym.slice(0, 4)), m = parseInt(ym.slice(4, 6));
  const dataDate = new Date(y, m - 1, 1);
  const ageDays = (Date.now() - dataDate.getTime()) / (1000 * 86400);
  return Math.max(0.3, Math.min(1.0, 1 - (ageDays - freqDays) / (freqDays * 2)));
}

// ── Market Profile 가중치 (캘리브레이션: 밸류에이션 강화, 신용위험 완화)
const US_PROFILE = {
  신용위험: 0.25,   // 기존 0.32 → 낙관편향 원인, 하향
  유동성:   0.18,
  시장공포: 0.22,
  실물경기: 0.17,
  밸류버블: 0.18,   // 신규: 고밸류·버블 에너지 카테고리
};

// ── SEFCON 점수 산출 (한국과 동일 구조)
function calcDefcon(indicators) {
  const cats = Object.keys(US_PROFILE);
  const catScores = cats.map(cat => {
    const inds   = indicators.filter(i => i.cat === cat);
    if (inds.length === 0) return { cat, score: 50, count: 0, weight: US_PROFILE[cat] };
    const catRaw = inds.reduce((s, i) => s + i.score * (i.freshness ?? 1.0), 0);
    const catMax = inds.reduce((s, i) => {
      const abs = Math.abs(i.score);
      const fw  = i.freshness ?? 1.0;
      if (abs > 3) return s + 4 * fw;
      if (abs > 2) return s + 3 * fw;
      return s + 2 * fw;
    }, 0) || (inds.length * 2);
    const score = catMax > 0
      ? Math.round((catRaw + catMax) / (catMax * 2) * 100)
      : 50;
    return { cat, score: Math.max(0, Math.min(100, score)), count: inds.length, weight: US_PROFILE[cat] };
  });

  const totalScore = Math.round(catScores.reduce((s, c) => s + c.score * c.weight, 0));
  return { totalScore, catScores, indicators, ...labelFromScore(totalScore) };
}

// ── 단계 레이블 (한국과 동일 기준)
function labelFromScore(score) {
  if      (score <= 30) return { defcon:1, defconLabel:"SEFCON 1  붕괴임박", defconColor:"#FF1A1A", defconDesc:"복수의 위기 신호 동시 발생. 현금 비중 최우선." };
  else if (score <= 45) return { defcon:2, defconLabel:"SEFCON 2  위기",     defconColor:"#FF6B00", defconDesc:"선행지표 다수 경고. 리스크 자산 비중 축소 검토." };
  else if (score <= 58) return { defcon:3, defconLabel:"SEFCON 3  경계",     defconColor:"#F0C800", defconDesc:"일부 지표 악화. 포트폴리오 방어 태세 준비." };
  else if (score <= 72) return { defcon:4, defconLabel:"SEFCON 4  관망",     defconColor:"#38BDF8", defconDesc:"대체로 양호. 선별적 기회 탐색 가능." };
  else                  return { defcon:5, defconLabel:"SEFCON 5  안정",     defconColor:"#00C878", defconDesc:"전 지표 정상. 적극적 투자 환경." };
}

// ── C-Index 클러스터 페널티 (한국과 동일 구조)
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
    val:   hasRisk("CAPE") || hasRisk("NASDAQ"),  // 밸류버블 신호
  };

  const clusterCount = Object.values(signals).filter(Boolean).length;
  let clusterPenalty = 0;
  if (clusterCount >= 2) clusterPenalty += 3;
  if (clusterCount >= 3) clusterPenalty += 6;
  if (clusterCount >= 4) clusterPenalty += 10;
  if (clusterCount >= 5) clusterPenalty += 5;  // 복합위기 추가 페널티

  let triggerPenalty = 0;
  if (signals.vix  && signals.hy)                    triggerPenalty += 7;
  if (signals.t10  && signals.sloos)                  triggerPenalty += 6;
  if (signals.dxy  && signals.m2)                     triggerPenalty += 4;
  if (signals.vix  && signals.hy  && signals.lei)     triggerPenalty += 5;
  if (signals.val  && signals.vix)                    triggerPenalty += 5;  // 버블+공포 복합

  let confirmPenalty = 0;
  if (signals.lei)                confirmPenalty += 3;
  if (signals.val)                confirmPenalty += 4;  // 고밸류 지속 패널티 강화
  if (signals.lei && signals.val) confirmPenalty += 3;

  const totalPenalty  = Math.min(35, clusterPenalty + triggerPenalty + confirmPenalty);
  const adjustedScore = Math.max(0, Math.min(100, defconData.totalScore - totalPenalty));

  let crisisType = "혼합형";
  if (signals.vix && signals.hy && signals.lei) crisisType = "복합 금융위기형";
  else if (signals.t10 && signals.sloos)         crisisType = "긴축·신용경색형";
  else if (signals.dxy && signals.m2)            crisisType = "달러 유동성 압박형";
  else if (signals.val && signals.vix)           crisisType = "버블 붕괴 위험형";
  else if (signals.lei)                          crisisType = "실물경기 둔화형";

  const topDrivers = Object.entries({
    "VIX 공포 확대":       signals.vix,
    "HY 스프레드 확대":    signals.hy,
    "장단기 금리 역전":    signals.t10,
    "대출기준 강화":       signals.sloos,
    "경기선행지수 둔화":   signals.lei,
    "달러 강세":           signals.dxy,
    "M2 위축":             signals.m2,
    "밸류에이션 과열":     signals.val,
  }).filter(([, v]) => v).map(([k]) => k);

  return {
    adjustedScore,
    totalPenalty, clusterCount, crisisType, topDrivers,
    ...labelFromScore(adjustedScore),
  };
}

// ── Physics_US (밸류에이션 가중치 강화)
function buildPhysicsUS(usData, catScores) {
  const catScore = name => catScores.find(c => c.cat === name)?.score ?? 50;

  const lastVIX   = safeNum(last(usData?.vix),   20);
  const lastHY    = safeNum(last(usData?.hy),    1.8);
  const lastBAML  = safeNum(last(usData?.baml),  3.5);
  const lastDXY   = safeNum(last(usData?.dxy),   25);
  const lastTNX   = safeNum(last(usData?.tnx),    4);
  const lastSLOOS = safeNum(last(usData?.sloos),  0);
  const lastLEI   = safeNum(last(usData?.lei),   100);
  const lastISM   = safeNum(last(usData?.ism),   100);

  // 나스닥 12개월 상승률 (버블 에너지 측정)
  const nq = usData?.nasdaq || [];
  const nqTrend12m = nq.length >= 13
    ? ((nq.slice(-1)[0]?.value ?? 0) / (nq.slice(-13)[0]?.value ?? 1) - 1) * 100
    : nq.length >= 7
      ? ((nq.slice(-1)[0]?.value ?? 0) / (nq.slice(-7)[0]?.value ?? 1) - 1) * 100
      : 0;

  // 유동성 압력
  const liquidityPressure = clamp01(
    clamp01((lastDXY - 22) / 8)  * 0.45 +
    clamp01(lastTNX / 6)          * 0.35 +
    clamp01(1 - catScore("유동성") / 100) * 0.20
  );

  // 밸류에이션 중력 (강화: 나스닥 과열 반영)
  const valuationGravity = clamp01(
    clamp01(lastTNX / 6)           * 0.40 +
    clamp01((lastHY - 0.8) / 4.2)  * 0.30 +
    clamp01(Math.max(0, nqTrend12m) / 50) * 0.30  // 나스닥 급등 = 밸류 부담
  );

  // 신용 응력
  const creditStress = clamp01(
    clamp01((lastBAML - 2.5) / 8.0) * 0.60 +
    clamp01(lastSLOOS / 50)          * 0.40
  );

  // 변동성 에너지 (VIX 저점 장기화 = 잠재 에너지 축적)
  const vix6mAvg = (usData?.vix || []).slice(-7)
    .reduce((s, r) => s + safeNum(r?.value, 20), 0) / 7;
  const volatilityEnergy = clamp01(
    Math.max(0, (18 - lastVIX) / 10) * 0.40 +
    Math.max(0, (18 - vix6mAvg) / 10) * 0.30 +
    clamp01(Math.max(0, nqTrend12m) / 60) * 0.30  // 급등 시 변동성 에너지 증가
  );

  // 경기 모멘텀
  const economicMomentum = clamp01(
    clamp01((lastLEI - 97) / 5)   * 0.50 +
    clamp01((lastISM - 97) / 6)   * 0.50
  );

  const forces = [
    { name: "미국으로의 유동성 쏠림", val: liquidityPressure },
    { name: "밸류에이션 고평가",       val: valuationGravity },
    { name: "대출 난이도",             val: creditStress },
    { name: "변동성 급변 에너지",      val: volatilityEnergy },
    { name: "경기 침체 위험",          val: 1 - economicMomentum },
  ];
  const dominantForce = forces.reduce((a, b) => a.val > b.val ? a : b).name;

  return {
    liquidityPressure: +liquidityPressure.toFixed(3),
    valuationGravity:  +valuationGravity.toFixed(3),
    creditStress:      +creditStress.toFixed(3),
    volatilityEnergy:  +volatilityEnergy.toFixed(3),
    economicMomentum:  +economicMomentum.toFixed(3),
    dominantForce,
    nqTrend12m:         +nqTrend12m.toFixed(1),
  };
}

// ── Regime_US (8개 국면, 브리핑 확률적 표현)
function buildRegimeUS(usData) {
  const t10y2y = last(usData?.t10y2y) ?? 0;
  const vix    = last(usData?.vix)    ?? 20;
  const lei    = last(usData?.lei)    ?? 100;
  const m2Yoy  = lastYoy(usData?.m2YoY) ?? 0;
  const ism    = last(usData?.ism)    ?? 100;
  const sloos  = last(usData?.sloos)  ?? 0;
  const baml   = last(usData?.baml)   ?? 3.5;
  const sp     = usData?.sp500 || [];
  const spTrend = sp.length >= 4
    ? ((sp.slice(-1)[0]?.value ?? 0) / (sp.slice(-4)[0]?.value ?? 1) - 1) * 100 : 0;
  const nq     = usData?.nasdaq || [];
  const nqTrend12m = nq.length >= 7
    ? ((nq.slice(-1)[0]?.value ?? 0) / (nq.slice(-7)[0]?.value ?? 1) - 1) * 100 : 0;

  let current     = "혼합/불확실형";
  let primaryType = "unknown";
  let confidence  = 0.5;
  let reason      = "";

  if (vix < 15 && lei >= 100.5 && m2Yoy >= 3 && t10y2y >= 0) {
    current = "돈 풀리는 시기"; primaryType = "expansion";
    confidence = 0.8; reason = "VIX 저점·M2 확장·LEI 상승 동시";
  } else if (nqTrend12m > 25 && vix < 18 && spTrend > 10) {
    current = "시장 과열"; primaryType = "bubble";
    confidence = 0.75; reason = "나스닥 6개월 급등·VIX 저점·S&P 강세";
  } else if (t10y2y < -0.5 && sloos > 25 && baml > 4.5) {
    current = "금리 인상 막바지"; primaryType = "rate_shock_late";
    confidence = 0.85; reason = "장단기역전+대출긴축+HY확대 동시";
  } else if (t10y2y < -0.2 && sloos > 10) {
    current = "금리 인상 시작"; primaryType = "rate_shock_early";
    confidence = 0.75; reason = "장단기역전 진행+대출기준 강화";
  } else if (t10y2y >= -0.3 && t10y2y <= 0.5 && sloos <= 10 && baml <= 4.0) {
    current = "금리 전환 기대"; primaryType = "pivot_expect";
    confidence = 0.65; reason = "긴축 완화 신호·금리역전 축소";
  } else if (vix > 30 && baml > 5.5 && lei < 99) {
    current = "경기 하강 시작"; primaryType = "recession_entry";
    confidence = 0.80; reason = "VIX 급등+HY확대+LEI 하락";
  } else if (vix > 40 && lei < 98 && ism < 98) {
    current = "경기 최저점"; primaryType = "recession_bottom";
    confidence = 0.75; reason = "공포 극대·실물 수축 동반";
  } else if (lei >= 99.5 && m2Yoy >= 0 && vix < 22 && spTrend > 0) {
    current = "경기 회복 시작"; primaryType = "recovery";
    confidence = 0.70; reason = "LEI 반등·유동성 개선·변동성 안정";
  } else {
    current = "정상 확장"; primaryType = "normal";
    confidence = 0.55; reason = "뚜렷한 위기 신호 미확인";
  }

  // 확률적 표현으로 전이 경로 작성
  const transitionMap = {
    rate_shock_late:  { path: "금리 인상 막바지 — 긴축 완화 기대가 일부 반영되는 구간. 금리 전환 기대 또는 경기 하강으로의 분기 가능성이 관찰됩니다.", direction: "경계" },
    rate_shock_early: { path: "금리 인상 초기 — 추가 긴축 심화 가능성이 높은 구간입니다.",                                                                   direction: "악화" },
    pivot_expect:     { path: "긴축 완화 기대가 일부 반영된 관망 국면 — 금리 인하·유동성 확장 전환 탐색 중입니다.",                                           direction: "개선" },
    expansion:        { path: "유동성 확장 유지 중 — 버블 에너지 누적 여부를 모니터링할 시기입니다.",                                                          direction: "주의" },
    bubble:           { path: "시장 과열 구간 — 금리 재상승 또는 유동성 위축 시 급격한 조정 가능성이 누적되고 있습니다.",                                       direction: "주의" },
    normal:           { path: "정상 확장 유지 — 선행지표 방향 변화에 주목할 시기입니다.",                                                                       direction: "유지" },
    recovery:         { path: "경기 회복 초입 — 정상 확장 전환 가능성이 관찰됩니다.",                                                                          direction: "개선" },
    recession_entry:  { path: "경기 하강 시작 — 바닥 탐색 구간으로의 진입 가능성이 높아지고 있습니다.",                                                         direction: "악화" },
    recession_bottom: { path: "경기 최저점 — 회복 초입 신호를 탐색하는 구간입니다.",                                                                           direction: "개선" },
    unknown:          { path: null,                                                                                                                              direction: "유지" },
  };

  const { path: transitionPath, direction } = transitionMap[primaryType] || transitionMap.unknown;
  return { current, primaryType, transitionPath, direction, confidence: +confidence.toFixed(2), reason };
}

// ── changeDrivers: 변화 원인 레이어
function buildChangeDrivers(usData, defconData) {
  const drivers = [];
  const dc = defconData || {};
  const cIndex = dc.cIndex || {};

  // C-Index에서 topDrivers 활용
  (cIndex.topDrivers || []).forEach(d => drivers.push({ label: d, direction: "위험↑", impact: "high" }));

  // 추가 변화 감지
  const vix = usData?.vix || [];
  if (vix.length >= 2) {
    const v0 = vix.slice(-1)[0]?.value, v1 = vix.slice(-2)[0]?.value;
    if (v0 && v1) {
      const chg = v0 - v1;
      if (Math.abs(chg) > 2)
        drivers.push({ label: `VIX ${chg > 0 ? "상승" : "하락"} (${chg > 0 ? "+" : ""}${chg.toFixed(1)})`, direction: chg > 0 ? "위험↑" : "위험↓", impact: Math.abs(chg) > 5 ? "high" : "medium" });
    }
  }

  const baml = usData?.baml || [];
  if (baml.length >= 2) {
    const b0 = baml.slice(-1)[0]?.value, b1 = baml.slice(-2)[0]?.value;
    if (b0 && b1 && Math.abs(b0 - b1) > 0.1)
      drivers.push({ label: `HY 스프레드 ${b0 > b1 ? "확대" : "축소"} (${b0.toFixed(2)}%p)`, direction: b0 > b1 ? "위험↑" : "위험↓", impact: "medium" });
  }

  return drivers.slice(0, 6);
}

// ── 메인: calcSefconUS
export function calcSefconUS(usData) {
  if (!usData) return null;

  const sp = usData.sp500 || [];
  const nq = usData.nasdaq || [];
  const spTrend3m = sp.length >= 4
    ? +((sp.slice(-1)[0]?.value ?? 0) / (sp.slice(-4)[0]?.value ?? 1) * 100 - 100).toFixed(1)
    : null;
  const nqTrend12m = nq.length >= 13
    ? +((nq.slice(-1)[0]?.value ?? 0) / (nq.slice(-13)[0]?.value ?? 1) * 100 - 100).toFixed(1)
    : nq.length >= 7
      ? +((nq.slice(-1)[0]?.value ?? 0) / (nq.slice(-7)[0]?.value ?? 1) * 100 - 100).toFixed(1)
      : null;

  // Freshness 계산
  const fSLOOS = getFreshness(usData?.sloos, 90);   // 분기 데이터
  const fLEI   = getFreshness(usData?.lei,   30);   // 월간
  const fBAML  = getFreshness(usData?.baml,  30);   // 월간
  const fVIX   = getFreshness(usData?.vix,   30);   // 월간

  const indicators = [
    // ── 신용위험 (4개, 기존 5개에서 축소 — 낙관편향 원인 제거)
    { cat:"신용위험", key:"T10Y2Y", label:"미국 장단기금리차", freshness: 1.0,
      val: last(usData.t10y2y), unit:"%",
      score: scoreV(last(usData.t10y2y), [-1.0, -0.5, 0.5, 1.0], -1) * 2 },
    { cat:"신용위험", key:"BAML",   label:"ICE BofA HY 스프레드", freshness: fBAML,
      val: last(usData.baml), unit:"%p",
      score: Math.round(scoreV(last(usData.baml), [7.0, 5.0, 3.5, 2.5], 1) * 1.5) },  // 임계값 완화(기존 9/6/4/3)
    { cat:"신용위험", key:"SLOOS",  label:"SLOOS 대출기준강화", freshness: fSLOOS,
      val: last(usData.sloos), unit:"%",
      score: scoreV(last(usData.sloos), [50, 20, -5, -20], 1) },
    { cat:"신용위험", key:"LEI",    label:"미국 LEI 경기선행지수", freshness: fLEI,
      val: last(usData.lei), unit:"",
      score: Math.round(scoreV(last(usData.lei), [98, 99, 100.5, 101.5], -1) * 1.5) },

    // ── 유동성 (3개)
    { cat:"유동성", key:"M2",     label:"미국 M2 YoY", freshness: 1.0,
      val: lastYoy(usData.m2YoY), unit:"%",
      score: (() => { const v = lastYoy(usData.m2YoY); if (v==null) return 0; if (v<-2) return -2; if (v<0) return -1; if (v<=5) return 0; if (v<=10) return 1; return 0; })() },
    { cat:"유동성", key:"DXY",    label:"달러인덱스(UUP)", freshness: 1.0,
      val: last(usData.dxy), unit:"",
      score: scoreV(last(usData.dxy), [29, 27, 24, 22], 1) },
    { cat:"유동성", key:"TNX",    label:"미국 10년물 국채금리", freshness: 1.0,
      val: last(usData.tnx), unit:"%",
      score: scoreV(last(usData.tnx), [5.0, 4.5, 3.0, 2.0], 1) },

    // ── 시장공포 (3개)
    { cat:"시장공포", key:"VIX",  label:"VIX 공포지수", freshness: fVIX,
      val: last(usData.vix), unit:"",
      score: scoreV(last(usData.vix), [35, 25, 18, 13], 1) },
    { cat:"시장공포", key:"UMCS", label:"소비자신뢰지수", freshness: 1.0,
      val: last(usData.umcs), unit:"",
      score: scoreV(last(usData.umcs), [55, 65, 80, 90], -1) },
    { cat:"시장공포", key:"ISM",  label:"미국 산업생산지수", freshness: 1.0,
      val: last(usData.ism), unit:"",
      score: scoreV(last(usData.ism), [98, 99, 101, 102], -1) },

    // ── 실물경기 (3개)
    { cat:"실물경기", key:"UNRATE", label:"미국 실업률", freshness: 1.0,
      val: last(usData.unrate), unit:"%",
      score: scoreV(last(usData.unrate), [5.5, 4.5, 3.8, 3.0], 1) },
    { cat:"실물경기", key:"ICSA",   label:"주간 실업청구(천건)", freshness: 1.0,
      val: last(usData.icsa), unit:"k",
      score: scoreV(last(usData.icsa), [300, 250, 210, 180], 1) },
    { cat:"실물경기", key:"SP500",  label:"S&P500 3개월 추세", freshness: 1.0,
      val: spTrend3m, unit:"%",
      score: spTrend3m==null ? 0 : spTrend3m<-15?-2:spTrend3m<-8?-1:spTrend3m>15?2:spTrend3m>5?1:0 },

    // ── 밸류버블 (신규 카테고리 — 미국 낙관편향 제거 핵심)
    { cat:"밸류버블", key:"NASDAQ", label:"나스닥 12개월 상승률", freshness: 1.0,
      val: nqTrend12m, unit:"%",
      // 급등 = 버블 에너지 = 위험 증가
      score: nqTrend12m==null ? 0 : nqTrend12m>40?-2:nqTrend12m>20?-1:nqTrend12m<-25?2:nqTrend12m<-12?1:0 },  // 12개월 기준 임계값
    { cat:"밸류버블", key:"GLD",    label:"금(GLD) 6개월 추세", freshness: 1.0,
      val: (() => { const a=usData.gld||[]; if(a.length<7)return null; const n=a.slice(-1)[0]?.value; const m=a.slice(-7)[0]?.value; return n&&m?+((n/m-1)*100).toFixed(1):null; })(),
      unit:"%",
      // 금 급등 = 인플레·위기 헤지 = 위험 신호
      score: (() => { const a=usData.gld||[]; if(a.length<7)return 0; const n=a.slice(-1)[0]?.value; const m=a.slice(-7)[0]?.value; const ch=n&&m?(n/m-1)*100:0; return ch>25?-2:ch>15?-1:ch<-10?1:0; })() },
  ];

  const defconData    = calcDefcon(indicators);
  const cIndex        = applyCIndex(defconData);

  defconData.totalScore  = cIndex.adjustedScore;
  defconData.defcon      = cIndex.defcon;
  defconData.defconLabel = cIndex.defconLabel;
  defconData.defconColor = cIndex.defconColor;
  defconData.defconDesc  = cIndex.defconDesc;
  defconData.cIndex      = cIndex;

  const physics      = buildPhysicsUS(usData, defconData.catScores);
  const regime       = buildRegimeUS(usData);
  const changeDrivers = buildChangeDrivers(usData, defconData);

  return { defconData, physics, regime, changeDrivers, market: "US" };
}
