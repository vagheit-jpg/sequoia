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

const clamp01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0));

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

const makeMetric = (value, options = {}) => {
  const {
    fallback = 0,
    isImputed = false,
    freshness = 1.0,
    volatility = 0.0
  } = options;

  const missing = value == null || Number.isNaN(Number(value));

  let confidence = 1.0;

  if (missing) confidence *= 0.6;
  if (isImputed || missing) confidence *= 0.7;

  confidence *= freshness;
  confidence *= (1 - volatility);

  return {
    value: missing ? fallback : Number(value),
    imputed: missing || isImputed,
    confidence: Math.max(0.1, Math.min(1.0, confidence))
  };
};

// ════════════════════════════════════════
// KOREA 스냅샷 (수신율 강화 버전)
// ════════════════════════════════════════

// fetch 안정화 유틸
async function safeFetch(url, options = {}, retry = 2, timeoutMs = 8000) {
  for (let i = 0; i <= retry; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "User-Agent": "sequoia-cron/1.0",
          "Cache-Control": "no-cache",
          ...(options.headers || {})
        }
      });

      clearTimeout(timeout);

      if (res.ok) return await res.json();

      console.warn(`[safeFetch] fail ${url} status=${res.status}`);

    } catch (e) {
      console.warn(`[safeFetch] error ${url}`, e.message);
    } finally {
      clearTimeout(timeout);
    }

    // retry backoff
    await new Promise(r => setTimeout(r, 300 * (i + 1)));
  }

  return null; // 완전 실패 시에도 시스템 유지
}

async function makeKoreaSnapshot() {
  const base = getBaseUrl();

  // ── PRIMARY + FALLBACK 구조
const d = await safeFetch(`${base}/api/macro`, {}, 2, 9000);

if (!d) {
  throw new Error("KOREA DATA FETCH FAILED");
}

  if (!d) {
    throw new Error("KOREA DATA FETCH FAILED (both primary & fallback)");
  }

  const dc     = d?.defconData         || {};
  const intel  = d?.coreIntel          || {};
  const state  = intel?.state          || {};
  const temp   = intel?.temporal       || {};
  const phys   = intel?.physics        || {};
  const regime = intel?.regime         || {};
  const interp = intel?.interpretation || {};
  const strat  = intel?.strategy       || {};

const key_indicators = {
  sefcon_score: makeMetric(dc?.totalScore),
  sefcon_level: makeMetric(dc?.defcon),

  krw_usd:      makeMetric(last(d?.fx)),
  kr_rate:      makeMetric(last(d?.rate)),
  kr_bond10y:   makeMetric(last(d?.bond10Y)),
  kr_bond3y:    makeMetric(last(d?.bond3Y)),
  cd_spread:    makeMetric(last(d?.cdSpread)),

  fred_vix:     makeMetric(last(d?.fredVIX)),
  fred_baa:     makeMetric(last(d?.fredHY)),
  fred_hy:      makeMetric(last(d?.fredBAML)),
  fred_t10y2y:  makeMetric(last(d?.fredT10Y2Y)),
  fred_sloos:   makeMetric(last(d?.fredSLOOS)),
  fred_lei:     makeMetric(last(d?.fredLEI)),
  dxy:          makeMetric(last(d?.yahooDXY)),

  us_m2_yoy:    makeMetric(lastYoy(d?.usM2YoY)),
  kr_m2_yoy:    makeMetric(lastYoy(d?.krM2YoY)),

  kr_cpi:       makeMetric(last(d?.cpi)),
  kr_ppi:       makeMetric(last(d?.ppi)),
  kr_export_yoy:makeMetric(lastYoy(d?.exportYoY)),
  kr_gdp:       makeMetric(last(d?.gdp)),

  foreign_net:  makeMetric(last(d?.foreignNet)),
  hh_debt_gdp:  makeMetric(last(d?.hhDebtGDP)),

  kospi_last:   makeMetric(d?.kospiMonthly?.slice(-1)[0]?.price),
  kosdaq_last:  makeMetric(d?.kosdaqMonthly?.slice(-1)[0]?.price),

  cat_credit:   makeMetric((dc?.catScores||[]).find(c=>c.cat==="신용위험")?.score),
  cat_liquidity:makeMetric((dc?.catScores||[]).find(c=>c.cat==="유동성")?.score),
  cat_fear:     makeMetric((dc?.catScores||[]).find(c=>c.cat==="시장공포")?.score),
  cat_real:     makeMetric((dc?.catScores||[]).find(c=>c.cat==="실물경기")?.score),
  cat_inflation:makeMetric((dc?.catScores||[]).find(c=>c.cat==="물가")?.score),

  crisis_proximity: makeMetric(d?.crisisAnalysis?.navigation?.proximityScore),

  crisis_top: {
    value: d?.crisisAnalysis?.navigation?.topCrisis?.label ?? "UNKNOWN",
    imputed: !d?.crisisAnalysis?.navigation?.topCrisis,
    confidence: d?.crisisAnalysis?.navigation?.topCrisis ? 1 : 0.3
  },

  liquidity_pressure: makeMetric(phys?.liquidityPressure),
  valuation_gravity:  makeMetric(phys?.valuationGravity),
  credit_stress:      makeMetric(phys?.creditStress),
  volatility_energy:  makeMetric(phys?.volatilityEnergy),
  bubble_energy:      makeMetric(phys?.bubbleEnergy),

  dominant_force: {
    value: phys?.dominantForce ?? "UNKNOWN",
    imputed: !phys?.dominantForce,
    confidence: phys?.dominantForce ? 1 : 0.3
  },

  risk_acceleration:    makeMetric(temp?.riskAcceleration),
  liquidity_trend:      makeMetric(temp?.liquidityTrend),
  credit_acceleration:  makeMetric(temp?.creditAcceleration),
  vol_compression:      makeMetric(temp?.volatilityCompression),
  speculation_momentum: makeMetric(temp?.speculationMomentum),

  regime_label: {
    value: regime?.primaryLabel ?? "UNKNOWN",
    imputed: !regime?.primaryLabel,
    confidence: regime?.primaryLabel ? 1 : 0.3
  },

  regime_direction: makeMetric(regime?.direction),
  transition_path: {
    value: regime?.transitionPath ?? null,
    imputed: !regime?.transitionPath,
    confidence: regime?.transitionPath ? 1 : 0.4
  }
};

  return {
    snapshot_date:  todayStr(),
    market:         "KOREA",
    sefcon_score:   dc?.totalScore ?? null,
    sefcon_level:   dc?.defcon ?? null,
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
// sefconUS.js import
// ════════════════════════════════════════
import { calcSefconUS } from "../engines/sefconUS.js";






// ════════════════════════════════════════
// US 스냅샷 — calcSefconUS 엔진 사용
// ════════════════════════════════════════
async function makeUSSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/us-macro`, {
    headers: { "User-Agent": "sequoia-cron/1.0" }
  });
  if (!r.ok) throw new Error(`/api/us-macro ${r.status}`);
  const usData = await r.json();

  // sefconUS.js 엔진으로 계산
  const result = calcSefconUS(usData);
  const dc     = result?.defconData || {};
  const phys   = result?.physics    || {};
  const regime = result?.regime     || {};

  const score  = safeNum(dc.totalScore, 50);
  const defcon = safeNum(dc.defcon,     3);

  const vix    = safeNum(last(usData?.vix),    20);
  const baml   = safeNum(last(usData?.baml),   3.5);
  const t10y2y = safeNum(last(usData?.t10y2y), 0);
  const sloos  = safeNum(last(usData?.sloos),  0);
  const lei    = safeNum(last(usData?.lei),    100);
  const unrate = safeNum(last(usData?.unrate), 4);
  const m2yoy  = safeNum(lastYoy(usData?.m2YoY), 0);
  const dxy    = safeNum(last(usData?.dxy),    25);
  const tnx    = safeNum(last(usData?.tnx),    4);
  const sp500  = safeNum(last(usData?.sp500),  null);

  const regimeLabel = regime.current || "혼합/불확실형";
  const regimeDir   = regime.direction || "유지";

  const key_indicators = {
    sefcon_score:        score,
    sefcon_level:        defcon,
    fred_vix:            vix,
    fred_hy:             baml,
    fred_t10y2y:         t10y2y,
    fred_sloos:          sloos,
    fred_lei:            lei,
    us_unrate:           unrate,
    us_m2_yoy:           m2yoy,
    dxy,
    us_10y:              tnx,
    sp500_last:          sp500,
    regime_label:        regimeLabel,
    regime_direction:    regimeDir,
    transition_path:     regime.transitionPath ?? null,
    liquidity_pressure:  safeNum(phys.liquidityPressure),
    credit_stress:       safeNum(phys.creditStress),
    valuation_gravity:   safeNum(phys.valuationGravity),
    volatility_energy:   safeNum(phys.volatilityEnergy),
    bubble_energy:       safeNum(phys.volatilityEnergy),
    dominant_force:      phys.dominantForce ?? null,
    nq_trend_12m:        safeNum(phys.nqTrend12m),
    // SEFCON 카테고리 점수
    cat_credit:    safeNum((dc.catScores||[]).find(c => c.cat === "신용위험")?.score),
    cat_liquidity: safeNum((dc.catScores||[]).find(c => c.cat === "유동성")?.score),
    cat_fear:      safeNum((dc.catScores||[]).find(c => c.cat === "시장공포")?.score),
    cat_real:      safeNum((dc.catScores||[]).find(c => c.cat === "실물경기")?.score),
    cat_bubble:    safeNum((dc.catScores||[]).find(c => c.cat === "밸류버블")?.score),
    // C-Index
    c_index_penalty:  safeNum(dc.cIndex?.totalPenalty),
    c_index_clusters: safeNum(dc.cIndex?.clusterCount),
    crisis_type:      dc.cIndex?.crisisType ?? null,
  };

  const interpretation =
    `미국 시장은 ${regimeLabel} 국면입니다. ` +
    `SEFCON ${defcon}단계 (${score}점). ` +
    `${regime.reason ? regime.reason + ". " : ""}` +
    `${regime.transitionPath || ""}`;

  return {
    snapshot_date:  todayStr(),
    market:         "US",
    sefcon_score:   score,
    sefcon_level:   defcon,
    state_json:     { sefconScore: score, sefconLevel: defcon, ...dc },
    temporal_json:  { m2yoy, t10y2y, vix, dxy },
    physics_json:   phys,
    regime_json:    { primaryLabel: regimeLabel, direction: regimeDir, transitionPath: regime.transitionPath, confidence: regime.confidence },
    interpretation,
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
    kospi_last:          safeNum(kr?.kospiMonthly?.slice(-1)[0]?.price),
    kosdaq_last:         safeNum(kr?.kosdaqMonthly?.slice(-1)[0]?.price),
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
