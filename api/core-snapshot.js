/**
 * SEQUOIA GLOBAL — Core Snapshot API
 * api/core-snapshot.js
 *
 * Vercel Cron 기반 자동 저장.
 * market=KOREA → /api/macro 호출 후 저장
 * market=US    → /api/us-macro 호출 후 계산·저장
 *
 * 핵심: src/ 파일 직접 import 없음 → 서버리스 번들링 문제 회피
 * 보안: CRON_SECRET 헤더 검증
 */

const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

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
  // VERCEL_URL은 배포 URL (https 없음), VERCEL_PROJECT_PRODUCTION_URL은 프로덕션 고정 URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL)
    return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ── KOREA: /api/macro가 이미 defconData, coreIntel 다 계산해서 내려줌
async function makeKoreaSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/macro`, {
    headers: { "User-Agent": "sequoia-cron/1.0" }
  });
  if (!r.ok) throw new Error(`/api/macro ${r.status}`);
  const d = await r.json();

  const dc     = d?.defconData        || {};
  const intel  = d?.coreIntel         || {};
  const state  = intel?.state         || { sefconScore: dc?.totalScore ?? null, sefconLevel: dc?.defcon ?? null };
  const temp   = intel?.temporal      || {};
  const phys   = intel?.physics       || {};
  const regime = intel?.regime        || { primaryLabel: dc?.defconLabel ?? "" };
  const interp = intel?.interpretation|| {};
  const strat  = intel?.strategy      || {};

  return {
    snapshot_date:  todayStr(),
    market:         "KOREA",
    sefcon_score:   dc?.totalScore ?? null,
    sefcon_level:   dc?.defcon    ?? null,
    state_json:     state,
    temporal_json:  temp,
    physics_json:   phys,
    regime_json:    regime,
    interpretation: interp?.summary ?? "",
    strategy_json:  strat,
    updated_at:     new Date().toISOString(),
  };
}

// ── US: /api/us-macro 호출 후 서버에서 계산
// sefconUS, coreIntelligenceUS를 인라인으로 처리 (import 없이)
async function makeUSSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/us-macro`, {
    headers: { "User-Agent": "sequoia-cron/1.0" }
  });
  if (!r.ok) throw new Error(`/api/us-macro ${r.status}`);
  const usData = await r.json();

  // 핵심 지표만 추출해서 저장 (엔진 import 없이 간소화)
  const last = arr => arr?.slice(-1)[0]?.value ?? null;
  const lastYoy = arr => [...(arr||[])].reverse().find(r=>r.yoy!=null)?.yoy ?? null;

  const vix    = last(usData?.vix)    ?? 20;
  const baml   = last(usData?.baml)   ?? 3.5;
  const t10y2y = last(usData?.t10y2y) ?? 0;
  const sloos  = last(usData?.sloos)  ?? 0;
  const lei    = last(usData?.lei)    ?? 100;
  const unrate = last(usData?.unrate) ?? 4;
  const m2yoy  = lastYoy(usData?.m2YoY) ?? 0;

  // 간이 SEFCON 점수 (0~100, 높을수록 안전)
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

  // Regime 간이 판별
  let regime = "혼합/불확실형";
  if (t10y2y < -0.5 && sloos > 25)         regime = "금리 인상 막바지";
  else if (t10y2y < -0.2 && sloos > 10)    regime = "금리 인상 시작";
  else if (t10y2y >= -0.3 && sloos <= 10)  regime = "금리 전환 기대";
  else if (vix < 15 && lei >= 100.5)       regime = "돈 풀리는 시기";
  else if (vix > 30 && baml > 5.5)         regime = "경기 하강 시작";
  else if (lei >= 99.5 && m2yoy >= 0)      regime = "경기 회복 시작";

  // Physics 간이
  const liqP  = Math.round(Math.min(1, Math.max(0, (last(usData?.dxy)??25-22)/8*0.5 + (last(usData?.tnx)??4)/6*0.5)) * 100) / 100;
  const credS = Math.round(Math.min(1, Math.max(0, (baml-2.5)/8*0.6 + Math.max(0,sloos/50)*0.4)) * 100) / 100;

  return {
    snapshot_date:  todayStr(),
    market:         "US",
    sefcon_score:   score,
    sefcon_level:   defcon,
    state_json:     { sefconScore: score, sefconLevel: defcon, vix, baml, t10y2y, sloos, lei, unrate, m2yoy },
    temporal_json:  { m2yoy, t10y2y, vix },
    physics_json:   { liquidityPressure: liqP, creditStress: credS, dominantForce: liqP > credS ? "유동성 압력" : "신용 응력" },
    regime_json:    { primaryLabel: regime, direction: defcon <= 2 ? "악화" : defcon >= 4 ? "개선" : "유지" },
    interpretation: `미국 시장은 ${regime} 국면입니다. SEFCON ${defcon}단계 (점수 ${score}).`,
    strategy_json:  { cashBias: defcon <= 2 ? 60 : defcon === 3 ? 35 : 15, riskLevel: defcon <= 2 ? "높음" : defcon === 3 ? "보통" : "낮음" },
    updated_at:     new Date().toISOString(),
  };
}

// ── Handler
export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers["authorization"] || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const market = (req.query?.market || "KOREA").toUpperCase();
  if (!["KOREA", "US"].includes(market)) {
    return res.status(400).json({ error: `Unknown market: ${market}` });
  }

  try {
    const snap = market === "KOREA"
      ? await makeKoreaSnapshot()
      : await makeUSSnapshot();

    await upsertSnapshot(snap);
    console.info(`[core-snapshot] ${market} 저장 완료: ${snap.snapshot_date} SEFCON=${snap.sefcon_level}`);
    return res.status(200).json({
      ok: true, market,
      snapshot_date: snap.snapshot_date,
      sefcon_level:  snap.sefcon_level,
    });

  } catch (e) {
    console.error(`[core-snapshot] ${market} 오류:`, e.message);
    return res.status(500).json({ error: e.message, market });
  }
}
