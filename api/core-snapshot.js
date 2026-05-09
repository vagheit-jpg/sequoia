/**
 * SEQUOIA GLOBAL — Core Snapshot API
 * api/core-snapshot.js
 *
 * Vercel Cron 기반 자동 저장.
 * market=KOREA → 기존 Core Intelligence 저장
 * market=US    → Core Intelligence US 저장
 *
 * 보안: CRON_SECRET 헤더 검증
 * 저장: SUPABASE_SERVICE_KEY (서버 전용, 프론트 노출 금지)
 */

import { runCoreIntelligence }   from "../engines/intelligence/coreIntelligence";
import { calcSefconUS }          from "../engines/sefconUS";
import { runCoreIntelligenceUS } from "../engines/intelligence/coreIntelligenceUS";

const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

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
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function makeKoreaSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/macro`);
  if (!r.ok) throw new Error(`/api/macro 응답 오류: ${r.status}`);
  const macroData = await r.json();
  const intel = runCoreIntelligence({ macroData });
  return {
    snapshot_date:  todayStr(),
    market:         "KOREA",
    sefcon_score:   macroData?.defconData?.totalScore ?? null,
    sefcon_level:   macroData?.defconData?.defcon     ?? null,
    state_json:     intel.state,
    temporal_json:  intel.temporal,
    physics_json:   intel.physics,
    regime_json:    intel.regime,
    interpretation: intel.interpretation?.summary ?? "",
    strategy_json:  intel.strategy,
    updated_at:     new Date().toISOString(),
  };
}

async function makeUSSnapshot() {
  const r = await fetch(`${getBaseUrl()}/api/us-macro`);
  if (!r.ok) throw new Error(`/api/us-macro 응답 오류: ${r.status}`);
  const usData = await r.json();
  const sefconResult = calcSefconUS(usData);
  const intel        = runCoreIntelligenceUS({ usData, sefconResult });
  return {
    snapshot_date:  todayStr(),
    market:         "US",
    sefcon_score:   sefconResult?.defconData?.totalScore ?? null,
    sefcon_level:   sefconResult?.defconData?.defcon     ?? null,
    state_json:     intel.state,
    temporal_json:  intel.temporal,
    physics_json:   intel.physics,
    regime_json:    intel.regime,
    interpretation: intel.interpretation?.summary ?? "",
    strategy_json:  intel.strategy,
    updated_at:     new Date().toISOString(),
  };
}

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
    return res.status(200).json({ ok:true, market, snapshot_date:snap.snapshot_date, sefcon_level:snap.sefcon_level });

  } catch (e) {
    console.error(`[core-snapshot] ${market} 오류:`, e.message);
    return res.status(500).json({ error: e.message, market });
  }
}
