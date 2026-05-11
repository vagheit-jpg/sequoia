/**
 * SEQUOIA GLOBAL — Core Snapshot API v2
 * api/core-snapshot.js
 *
 * Vercel Cron 기반 자동 저장.
 * market=KOREA  → /api/macro 호출 후 저장 (UTC 23:00 = KST 08:00)
 * market=US     → /api/us-macro 호출 후 저장 (UTC 23:30 = KST 08:30)
 * market=GLOBAL → KOREA + US 통합 저장 (UTC 00:00 = KST 09:00)
 *
 * 자비스 AI 대비: key_indicators 컬럼에 원시 지표값 함께 저장
 * 보안: CRON_SECRET 헤더 검증
 */

const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

const safeNum = (v, fb = null) =>
  Number.isFinite(Number(v)) ? Number(v) : fb;

const last    = arr => arr?.slice(-1)[0]?.value ?? null;
const lastYoy = arr => [...(arr||[])].reverse().find(r => r.yoy != null)?.yoy ?? null;

// ── Supabase upsert
async function upsertSnapshot(snap) {
  const res = await fetch(
    `${SB_URL}/rest/v1/core_intelligence_snapshots?on_conflict=snapshot_date,market`,
    {
      method: "POST",
      headers: {
        apikey:         SB_KEY,
        Authorization:  `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        "Prefer":       "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(snap),
    }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Supabase upsert ${res.status}: ${err}`);
  }
  return true;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getBaseUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL)
    return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ════════════════════════════════════════
// KOREA 스냅샷
// ════════════════════════════════════════
async function makeKoreaSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/macro`, {
    headers: { "User-Agent": "sequoia-cron/1.0" }
  });
  if (!r.ok) throw new Error(`/api/macro ${r.status}`);
  const d = await r.json();

  const dc     = d?.defconData         || {};
  const intel  = d?.coreIntel          || {};
  const state  = intel?.state          || {};
  const temp   = intel?.temporal       || {};
  const phys   = intel?.physics        || {};
  const regime = intel?.regime         || {};
  const interp = intel?.interpretation || {};
  const strat  = intel?.strategy       || {};

  // ── 자비스 AI용 핵심 원시 지표
  const key_indicators = {
    // SEFCON
    sefcon_score:     safeNum(dc?.totalScore),
    sefcon_level:     safeNum(dc?.defcon),
    // 한국 환율·금리
    krw_usd:          safeNum(last(d?.fx)),
    kr_rate:          safeNum(last(d?.rate)),
    kr_bond10y:       safeNum(last(d?.bond10Y)),
    kr_bond3y:        safeNum(last(d?.bond3Y)),
    cd_spread:        safeNum(last(d?.cdSpread)),
    // 미국 지표 (macroData 내 포함)
    fred_vix:         safeNum(last(d?.fredVIX)),
    fred_baa:         safeNum(last(d?.fredHY)),    // Baa 스프레드
    fred_hy:          safeNum(last(d?.fredBAML)),  // ICE BofA HY
    fred_t10y2y:      safeNum(last(d?.fredT10Y2Y)),
    fred_sloos:       safeNum(last(d?.fredSLOOS)),
    fred_lei:         safeNum(last(d?.fredLEI)),
    dxy:              safeNum(last(d?.yahooDXY)),
    us_m2_yoy:        safeNum(lastYoy(d?.usM2YoY)),
    // 한국 경제
    kr_m2_yoy:        safeNum(lastYoy(d?.krM2YoY)),
    kr_cpi:           safeNum(last(d?.cpi)),
    kr_ppi:           safeNum(last(d?.ppi)),
    kr_export_yoy:    safeNum(lastYoy(d?.exportYoY)),
    kr_gdp:           safeNum(last(d?.gdp)),
    foreign_net:      safeNum(last(d?.foreignNet)),
    hh_debt_gdp:      safeNum(last(d?.hhDebtGDP)),
    // KOSPI/KOSDAQ
    kospi_last:       safeNum(d?.kospiMonthly?.slice(-1)[0]?.close),
    kosdaq_last:      safeNum(d?.kosdaqMonthly?.slice(-1)[0]?.close),
    // SEFCON 카테고리 점수
    cat_credit:       safeNum((dc?.catScores||[]).find(c => c.cat === "신용위험")?.score),
    cat_liquidity:    safeNum((dc?.catScores||[]).find(c => c.cat === "유동성")?.score),
    cat_fear:         safeNum((dc?.catScores||[]).find(c => c.cat === "시장공포")?.score),
    cat_real:         safeNum((dc?.catScores||[]).find(c => c.cat === "실물경기")?.score),
    cat_inflation:    safeNum((dc?.catScores||[]).find(c => c.cat === "물가")?.score),
    // Crisis Navigation
    crisis_proximity: safeNum(d?.crisisAnalysis?.navigation?.proximityScore),
    crisis_top:       d?.crisisAnalysis?.navigation?.topCrisis?.label ?? null,
    // Physics
    liquidity_pressure:  safeNum(phys?.liquidityPressure),
    valuation_gravity:   safeNum(phys?.valuationGravity),
    credit_stress:       safeNum(phys?.creditStress),
    volatility_energy:   safeNum(phys?.volatilityEnergy),
    bubble_energy:       safeNum(phys?.bubbleEnergy),
    dominant_force:      phys?.dominantForce ?? null,
    // Temporal
    risk_acceleration:    safeNum(temp?.riskAcceleration),
    liquidity_trend:      safeNum(temp?.liquidityTrend),
    credit_acceleration:  safeNum(temp?.creditAcceleration),
    vol_compression:      safeNum(temp?.volatilityCompression),
    speculation_momentum: safeNum(temp?.speculationMomentum),
    // Regime
    regime_label:      regime?.primaryLabel   ?? null,
    regime_direction:  regime?.direction      ?? null,
    transition_path:   regime?.transitionPath ?? null,
  };

  return {
    snapshot_date:  todayStr(),
    market:         "KOREA",
    sefcon_score:   dc?.totalScore ?? null,
    sefcon_level:   dc?.defcon    ?? null,
    state_json:     Object.keys(state).length ? state : { sefconScore: dc?.totalScore, sefconLevel: dc?.defcon },
    temporal_json:  temp,
    physics_json:   phys,
    regime_json:    regime,
    interpretation: interp?.summary ?? `한국 시장 SEFCON ${dc?.defcon}단계 (${dc?.totalScore}점)`,
    strategy_json:  strat,
    key_indicators,
    updated_at:     new Date().toISOString(),
  };
}

// ════════════════════════════════════════
// US 스냅샷
// ════════════════════════════════════════
async function makeUSSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/us-macro`, {
    headers: { "User-Agent": "sequoia-cron/1.0" }
  });
  if (!r.ok) throw new Error(`/api/us-macro ${r.status}`);
  const usData = await r.json();

  const vix    = safeNum(last(usData?.vix),    20);
  const baml   = safeNum(last(usData?.baml),   3.5);
  const t10y2y = safeNum(last(usData?.t10y2y), 0);
  const sloos  = safeNum(last(usData?.sloos),  0);
  const lei    = safeNum(last(usData?.lei),    100);
  const unrate = safeNum(last(usData?.unrate), 4);
  const m2yoy  = safeNum(lastYoy(usData?.m2YoY), 0);
  const dxy    = safeNum(last(usData?.dxy),    100);
  const tnx    = safeNum(last(usData?.tnx),    4);
  const sp500  = safeNum(last(usData?.sp500),  null);
  const cpi    = safeNum(last(usData?.cpi),    null);
  const pce    = safeNum(last(usData?.pce),    null);

  // 간이 US SEFCON
  const score = Math.round(Math.max(0, Math.min(100,
    50
    + (t10y2y >= 0 ? 10 : t10y2y >= -0.5 ? 0 : -10)
    + (baml   <= 3 ? 10 : baml <= 4 ? 0 : -10)
    + (vix    <= 18 ? 10 : vix <= 25 ? 0 : -10)
    + (sloos  <= 10 ? 5 : sloos <= 30 ? -5 : -10)
    + (lei    >= 100.5 ? 5 : lei >= 99 ? 0 : -5)
    + (unrate <= 4 ? 5 : unrate <= 5 ? 0 : -5)
    + (m2yoy  >= 2 ? 5 : m2yoy >= 0 ? 0 : -5)
  )));
  const defcon = score <= 30 ? 1 : score <= 45 ? 2 : score <= 58 ? 3 : score <= 72 ? 4 : 5;

  let regime = "혼합/불확실형";
  if      (t10y2y < -0.5 && sloos > 25)        regime = "금리 인상 막바지";
  else if (t10y2y < -0.2 && sloos > 10)        regime = "금리 인상 시작";
  else if (t10y2y >= -0.3 && sloos <= 10)      regime = "금리 전환 기대";
  else if (vix < 15 && lei >= 100.5)           regime = "돈 풀리는 시기";
  else if (vix > 30 && baml > 5.5)             regime = "경기 하강 시작";
  else if (lei >= 99.5 && m2yoy >= 0)          regime = "경기 회복 시작";

  const liqP  = Math.round(Math.min(1, Math.max(0, (dxy-90)/25*0.5 + tnx/7*0.3)) * 100) / 100;
  const credS = Math.round(Math.min(1, Math.max(0, (baml-2.5)/8*0.6 + Math.max(0, sloos/50)*0.4)) * 100) / 100;
  const valG  = Math.round(Math.min(1, Math.max(0, tnx/6*0.7)) * 100) / 100;
  const domForce = liqP > credS && liqP > valG ? "유동성 압력" : credS > valG ? "신용 응력" : "밸류 중력";

  const key_indicators = {
    sefcon_score:       score,
    sefcon_level:       defcon,
    fred_vix:           vix,
    fred_hy:            baml,
    fred_t10y2y:        t10y2y,
    fred_sloos:         sloos,
    fred_lei:           lei,
    us_unrate:          unrate,
    us_m2_yoy:          m2yoy,
    dxy,
    us_10y:             tnx,
    sp500_last:         sp500,
    us_cpi:             cpi,
    us_pce:             pce,
    regime_label:       regime,
    regime_direction:   defcon <= 2 ? "악화" : defcon >= 4 ? "개선" : "유지",
    liquidity_pressure: liqP,
    credit_stress:      credS,
    valuation_gravity:  valG,
    dominant_force:     domForce,
  };

  return {
    snapshot_date:  todayStr(),
    market:         "US",
    sefcon_score:   score,
    sefcon_level:   defcon,
    state_json:     { sefconScore: score, sefconLevel: defcon, vix, baml, t10y2y, sloos, lei, unrate, m2yoy, dxy, tnx },
    temporal_json:  { m2yoy, t10y2y, vix, dxy },
    physics_json:   { liquidityPressure: liqP, creditStress: credS, valuationGravity: valG, dominantForce: domForce },
    regime_json:    { primaryLabel: regime, direction: key_indicators.regime_direction },
    interpretation: `미국 시장은 ${regime} 국면입니다. SEFCON ${defcon}단계 (${score}점). VIX ${vix}, HY ${baml}%p, T10Y2Y ${t10y2y}%p.`,
    strategy_json:  { cashBias: defcon<=2?60:defcon===3?35:15, riskLevel: defcon<=2?"높음":defcon===3?"보통":"낮음" },
    key_indicators,
    updated_at:     new Date().toISOString(),
  };
}

// ════════════════════════════════════════
// GLOBAL 스냅샷 — KOREA + US 통합
// ════════════════════════════════════════
async function makeGlobalSnapshot() {
  // KOREA + US 동시 fetch
  const [krRes, usRes] = await Promise.allSettled([
    fetch(`${getBaseUrl()}/api/macro`,    { headers: { "User-Agent": "sequoia-cron/1.0" } }),
    fetch(`${getBaseUrl()}/api/us-macro`, { headers: { "User-Agent": "sequoia-cron/1.0" } }),
  ]);

  const kr = krRes.status === "fulfilled" && krRes.value.ok ? await krRes.value.json() : null;
  const us = usRes.status === "fulfilled" && usRes.value.ok ? await usRes.value.json() : null;

  const dc    = kr?.defconData  || {};
  const intel = kr?.coreIntel   || {};
  const phys  = intel?.physics  || {};
  const regime= intel?.regime   || {};
  const temp  = intel?.temporal || {};

  const krScore = safeNum(dc?.totalScore, 50);

  // US 간이 계산
  const vix    = safeNum(last(kr?.fredVIX),    20);
  const baml   = safeNum(last(kr?.fredBAML),   3.5);
  const t10y2y = safeNum(last(kr?.fredT10Y2Y), 0);
  const sloos  = safeNum(last(kr?.fredSLOOS),  0);
  const lei    = safeNum(last(kr?.fredLEI),    100);
  const unrate = safeNum(last(us?.unrate ? us.unrate : kr?.fredUNRATE), 4);
  const m2yoy  = safeNum(lastYoy(kr?.usM2YoY), 0);
  const dxy    = safeNum(last(kr?.yahooDXY),   100);

  const usScore = Math.round(Math.max(0, Math.min(100,
    50
    + (t10y2y >= 0 ? 10 : t10y2y >= -0.5 ? 0 : -10)
    + (baml   <= 3 ? 10 : baml <= 4 ? 0 : -10)
    + (vix    <= 18 ? 10 : vix <= 25 ? 0 : -10)
    + (sloos  <= 10 ? 5 : sloos <= 30 ? -5 : -10)
    + (lei    >= 100.5 ? 5 : lei >= 99 ? 0 : -5)
    + (unrate <= 4 ? 5 : unrate <= 5 ? 0 : -5)
    + (m2yoy  >= 2 ? 5 : m2yoy >= 0 ? 0 : -5)
  )));

  // GLOBAL: KOREA 60% + US 40%
  const globalScore = Math.round(krScore * 0.6 + usScore * 0.4);
  const globalLevel = globalScore <= 30 ? 1 : globalScore <= 45 ? 2 : globalScore <= 58 ? 3 : globalScore <= 72 ? 4 : 5;

  const crisis = safeNum(kr?.crisisAnalysis?.navigation?.proximityScore, 0);
  const liqP   = safeNum(phys?.liquidityPressure, 0.5);
  const credS  = safeNum(phys?.creditStress, 0.5);
  const valG   = safeNum(phys?.valuationGravity, 0.5);

  const dominantRegime = regime?.primaryLabel || "혼합/불확실형";

  const key_indicators = {
    // 종합 SEFCON
    sefcon_score:        globalScore,
    sefcon_level:        globalLevel,
    korea_sefcon_score:  krScore,
    korea_sefcon_level:  safeNum(dc?.defcon),
    us_sefcon_score:     usScore,
    // 글로벌 핵심 지표
    fred_vix:            vix,
    fred_hy:             baml,
    fred_t10y2y:         t10y2y,
    fred_sloos:          sloos,
    fred_lei:            lei,
    us_unrate:           unrate,
    us_m2_yoy:           m2yoy,
    dxy,
    krw_usd:             safeNum(last(kr?.fx)),
    kr_rate:             safeNum(last(kr?.rate)),
    foreign_net:         safeNum(last(kr?.foreignNet)),
    kospi_last:          safeNum(kr?.kospiMonthly?.slice(-1)[0]?.close),
    kosdaq_last:         safeNum(kr?.kosdaqMonthly?.slice(-1)[0]?.close),
    // Crisis
    crisis_proximity:    crisis,
    crisis_top:          kr?.crisisAnalysis?.navigation?.topCrisis?.label ?? null,
    // Physics
    liquidity_pressure:  liqP,
    credit_stress:       credS,
    valuation_gravity:   valG,
    dominant_force:      phys?.dominantForce ?? null,
    // Temporal
    risk_acceleration:    safeNum(temp?.riskAcceleration),
    liquidity_trend:      safeNum(temp?.liquidityTrend),
    credit_acceleration:  safeNum(temp?.creditAcceleration),
    vol_compression:      safeNum(temp?.volatilityCompression),
    speculation_momentum: safeNum(temp?.speculationMomentum),
    // Regime
    regime_label:     dominantRegime,
    regime_direction: regime?.direction ?? null,
    transition_path:  regime?.transitionPath ?? null,
    // SEFCON 카테고리
    cat_credit:    safeNum((dc?.catScores||[]).find(c => c.cat === "신용위험")?.score),
    cat_liquidity: safeNum((dc?.catScores||[]).find(c => c.cat === "유동성")?.score),
    cat_fear:      safeNum((dc?.catScores||[]).find(c => c.cat === "시장공포")?.score),
    cat_real:      safeNum((dc?.catScores||[]).find(c => c.cat === "실물경기")?.score),
    cat_inflation: safeNum((dc?.catScores||[]).find(c => c.cat === "물가")?.score),
  };

  const interpretation =
    `글로벌 종합 SEFCON ${globalLevel}단계 (${globalScore}점). ` +
    `한국 ${krScore}점 × 미국 ${usScore}점 통합 분석. ` +
    `현재 한국 시장: ${dominantRegime}. ` +
    `위기 근접도 ${crisis}%. ` +
    `지배적 힘: ${phys?.dominantForce ?? "분석 중"}.`;

  return {
    snapshot_date:  todayStr(),
    market:         "GLOBAL",
    sefcon_score:   globalScore,
    sefcon_level:   globalLevel,
    state_json:     {
      sefconScore:   globalScore,
      sefconLevel:   globalLevel,
      koreaScore:    krScore,
      usScore,
      totalRisk:     safeNum(intel?.state?.totalRisk),
    },
    temporal_json:  { vix, baml, t10y2y, dxy, m2yoy, ...temp },
    physics_json:   phys,
    regime_json:    { ...regime, crisisProximity: crisis },
    interpretation,
    strategy_json:  intel?.strategy || {
      cashBias:  globalLevel <= 2 ? 60 : globalLevel === 3 ? 35 : 15,
      riskLevel: globalLevel <= 2 ? "높음" : globalLevel === 3 ? "보통" : "낮음",
    },
    key_indicators,
    updated_at: new Date().toISOString(),
  };
}

// ════════════════════════════════════════
// Handler
// ════════════════════════════════════════
export default async function handler(req, res) {
  // 보안 검증
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const market = (req.query?.market || "KOREA").toUpperCase();
  if (!["KOREA", "US", "GLOBAL"].includes(market)) {
    return res.status(400).json({ error: `Unknown market: ${market}` });
  }

  try {
    const snap =
      market === "KOREA"  ? await makeKoreaSnapshot()  :
      market === "US"     ? await makeUSSnapshot()     :
                            await makeGlobalSnapshot();

    await upsertSnapshot(snap);
    console.info(
      `[core-snapshot] ${market} 저장 완료: ${snap.snapshot_date} ` +
      `SEFCON ${snap.sefcon_level} (${snap.sefcon_score}점) ` +
      `지표 ${Object.keys(snap.key_indicators || {}).length}개`
    );

    return res.status(200).json({
      ok:            true,
      market,
      snapshot_date: snap.snapshot_date,
      sefcon_level:  snap.sefcon_level,
      sefcon_score:  snap.sefcon_score,
      key_count:     Object.keys(snap.key_indicators || {}).length,
    });

  } catch (e) {
    console.error(`[core-snapshot] ${market} 오류:`, e.message);
    return res.status(500).json({ error: e.message, market });
  }
}
