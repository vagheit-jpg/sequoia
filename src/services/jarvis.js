/**
 * 자비스 (J.A.R.V.I.S.) — SEFCON 패턴 매칭 엔진
 * Just A Rather Very Intelligent System
 *
 * 역할: 오늘의 거시 벡터를 Supabase 히스토리(684건+)와 비교해
 *       유사도 Top N 날짜를 찾고, 이후 KOSPI 등 결과를 반환
 *
 * 사용법:
 *   import { jarvisMatch } from './jarvis.js';
 *   const result = await jarvisMatch({ topN: 5, region: 'KOREA' });
 */

// ─────────────────────────────────────────────
//  Supabase 설정
// ─────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const sbFetch = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
};

// ─────────────────────────────────────────────
//  매칭에 사용할 핵심 변수 정의
// ─────────────────────────────────────────────
/**
 * 각 변수의 weight: 중요도 비례
 * sefcon_score가 핵심 앵커, 나머지는 보조
 */
const MATCH_FIELDS = [
  { key: 'sefcon_score',         weight: 3.0 },
  { key: 'liquidity_pressure',   weight: 1.5 },
  { key: 'credit_stress',        weight: 1.5 },
  { key: 'valuation_gravity',    weight: 1.0 },
  { key: 'volatility_energy',    weight: 1.0 },
  { key: 'crisis_proximity',     weight: 1.2 },
];

// key_indicators JSON 필드 안의 하위 키 (있는 경우)
const KI_FIELDS = [
  { key: 't10y2y',    weight: 1.2 },
  { key: 'baml',      weight: 1.0 },
  { key: 'vix',       weight: 0.8 },
  { key: 'dxy',       weight: 0.6 },
  { key: 'm2_yoy',    weight: 0.5 },
];

// ─────────────────────────────────────────────
//  벡터 추출
// ─────────────────────────────────────────────
function extractVector(row) {
  const ki = row.key_indicators || {};
  const vec = [];

  for (const { key, weight } of MATCH_FIELDS) {
    const v = parseFloat(row[key]);
    vec.push({ value: isNaN(v) ? null : v, weight });
  }

  for (const { key, weight } of KI_FIELDS) {
    const v = parseFloat(ki[key]);
    vec.push({ value: isNaN(v) ? null : v, weight });
  }

  return vec;
}

// ─────────────────────────────────────────────
//  정규화 범위 계산
// ─────────────────────────────────────────────
function computeNormRanges(rows) {
  const dims = MATCH_FIELDS.length + KI_FIELDS.length;
  const mins = new Array(dims).fill(Infinity);
  const maxs = new Array(dims).fill(-Infinity);

  for (const row of rows) {
    const vec = extractVector(row);
    vec.forEach(({ value }, i) => {
      if (value !== null) {
        if (value < mins[i]) mins[i] = value;
        if (value > maxs[i]) maxs[i] = value;
      }
    });
  }

  return { mins, maxs };
}

// ─────────────────────────────────────────────
//  가중 유클리드 거리 계산
// ─────────────────────────────────────────────
function weightedEuclidean(vecA, vecB, mins, maxs) {
  let sumSq = 0;
  let totalWeight = 0;
  let validDims = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];

    if (a.value === null || b.value === null) continue;

    const range = maxs[i] - mins[i];
    if (range === 0) continue;

    const normA = (a.value - mins[i]) / range;
    const normB = (b.value - mins[i]) / range;
    const w = a.weight;

    sumSq += w * (normA - normB) ** 2;
    totalWeight += w;
    validDims++;
  }

  if (validDims === 0) return 1; // 최대 거리
  return Math.sqrt(sumSq / totalWeight);
}

// ─────────────────────────────────────────────
//  유사도 → 퍼센트 변환
// ─────────────────────────────────────────────
function distToSimilarity(dist) {
  // dist 0 → 100%, dist 1 → 0%
  // 보정: 실제 분포에서 dist > 0.6이면 의미 없음
  const clipped = Math.min(dist, 0.8);
  return Math.round((1 - clipped / 0.8) * 100);
}

// ─────────────────────────────────────────────
//  KOSPI 미래 수익률 계산
// ─────────────────────────────────────────────
function computeForwardReturn(rows, targetDate, horizonDays) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const idx = sorted.findIndex(r => r.date === targetDate);
  if (idx < 0) return null;

  const baseKospi = parseFloat(sorted[idx].kospi_last);
  if (isNaN(baseKospi) || baseKospi === 0) return null;

  // 가장 가까운 미래 날짜 찾기 (약 horizonDays 영업일)
  const targetIdx = idx + horizonDays;
  if (targetIdx >= sorted.length) return null;

  const futureKospi = parseFloat(sorted[targetIdx].kospi_last);
  if (isNaN(futureKospi) || futureKospi === 0) return null;

  return ((futureKospi - baseKospi) / baseKospi) * 100;
}

// ─────────────────────────────────────────────
//  레짐 레이블 한글화
// ─────────────────────────────────────────────
const REGIME_KR = {
  CRISIS:      '⚡ 위기',
  HIGH_STRESS: '🔴 고위기',
  ELEVATED:    '🟠 주의',
  CAUTION:     '🟡 경계',
  MODERATE:    '🟢 보통',
  STABLE:      '🔵 안정',
  RECOVERY:    '🌱 회복',
  EXPANSION:   '🚀 확장',
};

function localizeRegime(label) {
  if (!label) return '—';
  for (const [k, v] of Object.entries(REGIME_KR)) {
    if (label.toUpperCase().includes(k)) return v;
  }
  return label;
}

// ─────────────────────────────────────────────
//  메인 — 패턴 매칭 실행
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.region          - 'KOREA' | 'US' | 'GLOBAL'
 * @param {number} opts.topN            - 반환할 매칭 개수 (기본 5)
 * @param {number} opts.forwardDays     - 미래 수익률 horizon (기본 22, 약 1개월)
 * @param {string} opts.targetDate      - 비교할 날짜 (기본 null → DB에서 최신)
 * @param {object} opts.overrideToday   - 오늘 행을 직접 주입할 때 사용
 * @returns {Promise<JarvisResult>}
 */
export async function jarvisMatch({
  region = 'KOREA',
  topN = 5,
  forwardDays = 22,
  targetDate = null,
  overrideToday = null,
} = {}) {

  // 1. 전체 히스토리 조회
  const allRows = await sbFetch(
    `core_intelligence_snapshots?select=*&region=eq.${region}&order=date.asc&limit=2000`
  );

  if (!allRows || allRows.length < 10) {
    throw new Error(`데이터 부족: ${region} ${allRows?.length || 0}건`);
  }

  // 2. 오늘(기준일) 결정
  let todayRow;
  if (overrideToday) {
    todayRow = overrideToday;
  } else if (targetDate) {
    todayRow = allRows.find(r => r.date === targetDate);
    if (!todayRow) throw new Error(`날짜 없음: ${targetDate}`);
  } else {
    // DB 최신 날짜
    todayRow = [...allRows].sort((a, b) => b.date.localeCompare(a.date))[0];
  }

  const todayDate = todayRow.date;

  // 3. 과거 행만 필터 (기준일보다 최소 forwardDays+5 이상 앞선 날짜)
  const historyRows = allRows.filter(r => {
    const daysApart = daysBetween(r.date, todayDate);
    return daysApart > forwardDays + 5; // 결과값 계산 가능한 행만
  });

  if (historyRows.length < topN) {
    throw new Error(`비교 가능한 과거 데이터 부족: ${historyRows.length}건`);
  }

  // 4. 정규화 범위 (전체 데이터 기준)
  const { mins, maxs } = computeNormRanges(allRows);

  // 5. 오늘 벡터
  const todayVec = extractVector(todayRow);

  // 6. 거리 계산
  const scored = historyRows.map(row => {
    const vec = extractVector(row);
    const dist = weightedEuclidean(todayVec, vec, mins, maxs);
    const similarity = distToSimilarity(dist);
    return { row, dist, similarity };
  });

  // 7. 거리 오름차순 정렬 → Top N
  scored.sort((a, b) => a.dist - b.dist);
  const top = scored.slice(0, topN);

  // 8. 미래 수익률 붙이기
  const matches = top.map(({ row, similarity }) => {
    const fwd22 = computeForwardReturn(allRows, row.date, forwardDays);
    const fwd60 = computeForwardReturn(allRows, row.date, forwardDays * 3);
    const fwd5  = computeForwardReturn(allRows, row.date, 5);

    return {
      date:           row.date,
      similarity,
      sefcon_score:   row.sefcon_score,
      regime_label:   localizeRegime(row.regime_label),
      crisis_proximity: row.crisis_proximity,
      fwd_5d:         fwd5  !== null ? +fwd5.toFixed(2)  : null,
      fwd_22d:        fwd22 !== null ? +fwd22.toFixed(2) : null,
      fwd_60d:        fwd60 !== null ? +fwd60.toFixed(2) : null,
      key_indicators: row.key_indicators || {},
    };
  });

  // 9. 합성 신호 계산
  const validFwd22 = matches.filter(m => m.fwd_22d !== null);
  const avgFwd22 = validFwd22.length
    ? validFwd22.reduce((s, m) => s + m.fwd_22d, 0) / validFwd22.length
    : null;

  const bullishCount = matches.filter(m => m.fwd_22d > 2).length;
  const bearishCount = matches.filter(m => m.fwd_22d < -2).length;

  let compositeSignal = '중립';
  let signalColor = '#888';
  if (bullishCount >= Math.ceil(topN * 0.6)) {
    compositeSignal = '🟢 상승 우위';
    signalColor = '#22c55e';
  } else if (bearishCount >= Math.ceil(topN * 0.6)) {
    compositeSignal = '🔴 하락 우위';
    signalColor = '#ef4444';
  } else {
    compositeSignal = '🟡 혼조';
    signalColor = '#eab308';
  }

  return {
    region,
    todayDate,
    todayScore:       todayRow.sefcon_score,
    todayRegime:      localizeRegime(todayRow.regime_label),
    topN,
    forwardDays,
    matches,
    summary: {
      avgFwd22d:      avgFwd22 !== null ? +avgFwd22.toFixed(2) : null,
      bullishCount,
      bearishCount,
      compositeSignal,
      signalColor,
      totalHistoryRows: historyRows.length,
    },
  };
}

// ─────────────────────────────────────────────
//  오늘 스냅샷 실시간 주입용
//  (Vercel API에서 오늘 계산값을 직접 넘길 때)
// ─────────────────────────────────────────────
export async function jarvisMatchWithToday(todaySnapshot, opts = {}) {
  return jarvisMatch({ ...opts, overrideToday: todaySnapshot });
}

// ─────────────────────────────────────────────
//  유틸: 두 날짜 사이 일수 (단순 차이)
// ─────────────────────────────────────────────
function daysBetween(dateA, dateB) {
  const msA = new Date(dateA).getTime();
  const msB = new Date(dateB).getTime();
  return Math.round(Math.abs(msB - msA) / (1000 * 60 * 60 * 24));
}
