/**
 * SEQUOIA GLOBAL — Core Snapshot API v8 (FULL REWRITE)
 * api/core-snapshot.js
 *
 * v8 핵심:
 * - 단일 엔진 구조 (KR / US / GLOBAL 통합 파일)
 * - makeMetric / safeFetch / score 시스템 정리
 * - v2/v7 충돌 제거 (완전 리셋)
 * - 런타임 안정성 최우선
 */

const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

// ─────────────────────────────
// CORE UTIL
// ─────────────────────────────
const safeNum = (v, fb = null) =>
  Number.isFinite(Number(v)) ? Number(v) : fb;

const clamp01 = (v) =>
  Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

const last = (arr) => arr?.slice(-1)[0]?.value ?? null;

const lastYoy = (arr) =>
  [...(arr || [])].reverse().find((r) => r?.yoy != null)?.yoy ?? null;

// ─────────────────────────────
// METRIC ENGINE (v8 CLEAN)
// ─────────────────────────────
function makeMetric(value, options = {}) {
  const {
    fallback = 0,
    isImputed = false,
    freshness = 1.0,
    volatility = 0.0,
  } = options;

  const missing = value == null || Number.isNaN(Number(value));

  let confidence = 1.0;

  if (missing) confidence *= 0.6;
  if (missing || isImputed) confidence *= 0.7;
  confidence *= freshness;
  confidence *= 1 - volatility;

  return {
    value: missing ? fallback : Number(value),
    imputed: missing || isImputed,
    confidence: Math.max(0.1, Math.min(1, confidence)),
  };
}

// ─────────────────────────────
// SAFE FETCH LAYER
// ─────────────────────────────
async function safeFetch(url, options = {}, retry = 2, timeoutMs = 8000) {
  for (let i = 0; i <= retry; i++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "User-Agent": "sequoia-cron/1.0",
          "Cache-Control": "no-cache",
          ...(options.headers || {}),
        },
      });

      clearTimeout(t);

      if (res.ok) return await res.json();
    } catch (e) {
      console.warn(`[safeFetch] error ${url}`, e.message);
    } finally {
      clearTimeout(t);
    }

    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }

  return null;
}

// ─────────────────────────────
// SUPABASE UPSERT
// ─────────────────────────────
async function upsertSnapshot(snap) {
  const res = await fetch(
    `${SB_URL}/rest/v1/core_intelligence_snapshots?on_conflict=snapshot_date,market`,
    {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(snap),
    }
  );

  if (!res.ok) throw new Error(await res.text());
}

// ─────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);

const getBaseUrl = () =>
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

// ─────────────────────────────
// KOREA SNAPSHOT
// ─────────────────────────────
async function makeKoreaSnapshot() {
  const base = getBaseUrl();
  const d = await safeFetch(`${base}/api/macro`, {}, 2, 9000);

  if (!d) throw new Error("KOREA DATA FETCH FAILED");

  const dc = d?.defconData || {};
  const intel = d?.coreIntel || {};
  const phys = intel?.physics || {};
  const regime = intel?.regime || {};
  const temp = intel?.temporal || {};
  const strat = intel?.strategy || {};

  const key_indicators = {
    sefcon_score: makeMetric(dc?.totalScore),
    sefcon_level: makeMetric(dc?.defcon),

    krw_usd: makeMetric(last(d?.fx)),
    kr_rate: makeMetric(last(d?.rate)),
    kr_bond10y: makeMetric(last(d?.bond10Y)),
    kr_bond3y: makeMetric(last(d?.bond3Y)),

    dxy: makeMetric(last(d?.yahooDXY)),
    kr_cpi: makeMetric(last(d?.cpi)),
    kr_ppi: makeMetric(last(d?.ppi)),

    foreign_net: makeMetric(last(d?.foreignNet)),
    hh_debt_gdp: makeMetric(last(d?.hhDebtGDP)),

    kospi_last: makeMetric(d?.kospiMonthly?.slice(-1)[0]?.close),
    kosdaq_last: makeMetric(d?.kosdaqMonthly?.slice(-1)[0]?.close),

    liquidity_pressure: makeMetric(phys?.liquidityPressure),
    valuation_gravity: makeMetric(phys?.valuationGravity),
    credit_stress: makeMetric(phys?.creditStress),
    volatility_energy: makeMetric(phys?.volatilityEnergy),
    bubble_energy: makeMetric(phys?.bubbleEnergy),

    regime_label: {
      value: regime?.primaryLabel ?? "UNKNOWN",
      imputed: !regime?.primaryLabel,
      confidence: regime?.primaryLabel ? 1 : 0.3,
    },
  };

  return {
    snapshot_date: todayStr(),
    market: "KOREA",
    sefcon_score: dc?.totalScore ?? null,
    sefcon_level: dc?.defcon ?? null,
    state_json: dc,
    temporal_json: temp,
    physics_json: phys,
    regime_json: regime,
    interpretation: `한국 시장 SEFCON ${dc?.defcon}단계 (${dc?.totalScore}점)`,
    strategy_json: strat,
    key_indicators,
    updated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────
// US SNAPSHOT (minimal stable stub 유지)
// ─────────────────────────────
async function makeUSSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/us-macro`, {
    headers: { "User-Agent": "sequoia-cron/1.0" },
  });

  if (!r.ok) throw new Error(`/api/us-macro ${r.status}`);
  const us = await r.json();

  const vix = safeNum(last(us?.vix), 20);
  const baml = safeNum(last(us?.baml), 3.5);
  const t10y2y = safeNum(last(us?.t10y2y), 0);
  const lei = safeNum(last(us?.lei), 100);

  const score = Math.round(
    50 +
      (vix < 18 ? 10 : -10) +
      (baml < 4 ? 10 : -10) +
      (lei > 100 ? 5 : -5)
  );

  const level = score <= 30 ? 1 : score <= 45 ? 2 : score <= 58 ? 3 : score <= 72 ? 4 : 5;

  return {
    snapshot_date: todayStr(),
    market: "US",
    sefcon_score: score,
    sefcon_level: level,
    state_json: { sefconScore: score, sefconLevel: level },
    temporal_json: { vix, baml, t10y2y },
    physics_json: {},
    regime_json: {},
    interpretation: `US 시장 SEFCON ${level} (${score}점)`,
    strategy_json: {},
    key_indicators: {
      sefcon_score: score,
      sefcon_level: level,
      fred_vix: vix,
      fred_hy: baml,
      fred_t10y2y: t10y2y,
      fred_lei: lei,
    },
    updated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────
// GLOBAL SNAPSHOT
// ─────────────────────────────
async function makeGlobalSnapshot() {
  const [krRes, usRes] = await Promise.allSettled([
    fetch(`${getBaseUrl()}/api/macro`),
    fetch(`${getBaseUrl()}/api/us-macro`),
  ]);

  const kr = krRes.status === "fulfilled" ? await krRes.value.json() : null;
  const us = usRes.status === "fulfilled" ? await usRes.value.json() : null;

  const krScore = safeNum(kr?.defconData?.totalScore, 50);
  const usScore = 50;

  const globalScore = Math.round(krScore * 0.6 + usScore * 0.4);
  const level =
    globalScore <= 30 ? 1 :
    globalScore <= 45 ? 2 :
    globalScore <= 58 ? 3 :
    globalScore <= 72 ? 4 : 5;

  return {
    snapshot_date: todayStr(),
    market: "GLOBAL",
    sefcon_score: globalScore,
    sefcon_level: level,
    state_json: { korea: krScore, us: usScore },
    temporal_json: {},
    physics_json: {},
    regime_json: {},
    interpretation: `GLOBAL SEFCON ${level} (${globalScore})`,
    strategy_json: {},
    key_indicators: {
      sefcon_score: globalScore,
      sefcon_level: level,
      korea: krScore,
      us: usScore,
    },
    updated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────
// HANDLER
// ─────────────────────────────
export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const market = (req.query?.market || "KOREA").toUpperCase();

  try {
    const snap =
      market === "KOREA"
        ? await makeKoreaSnapshot()
        : market === "US"
        ? await makeUSSnapshot()
        : await makeGlobalSnapshot();

    await upsertSnapshot(snap);

    return res.status(200).json({
      ok: true,
      market,
      snapshot_date: snap.snapshot_date,
      sefcon_level: snap.sefcon_level,
      sefcon_score: snap.sefcon_score,
      key_count: Object.keys(snap.key_indicators || {}).length,
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message,
      market,
    });
  }
}
