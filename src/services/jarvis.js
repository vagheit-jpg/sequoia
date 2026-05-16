/**
 * 자비스 (J.A.R.V.I.S.) — 세콰이어 AI 해석 엔진 v2
 * Just A Rather Very Intelligent System
 *
 * v2 추가사항:
 * - Claude API 연결 (오건영 스타일 해석)
 * - 유사 국면 기반 확률론적 시나리오
 * - 1시간 캐시 (Supabase jarvis_cache)
 * - SMA 스마트머니 데이터 연동
 *
 * 사용법:
 *   import { jarvisMatch, jarvisInterpret } from './jarvis.js';
 *   const result = await jarvisMatch({ topN: 5, region: 'KOREA' });
 *   const interp = await jarvisInterpret({ tabType: 'sefcon', region: 'KOREA' });
 */

// ─────────────────────────────────────────────
//  Supabase 설정 (기존 constants/supabase.js 방식)
// ─────────────────────────────────────────────
import { SB_URL, SB_KEY } from '../constants/supabase';

const sbFetch = async (path, opts = {}) => {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
};

// ─────────────────────────────────────────────
//  매칭 변수 정의
// ─────────────────────────────────────────────
const MATCH_SPEC = {
  KOREA: [
    { key: 'sefcon_score', weight: 3.0 },
    { key: 'kospi_last',   weight: 2.5 },
    { key: 'fred_t10y2y',  weight: 1.5 },
    { key: 'fred_vix',     weight: 1.2 },
    { key: 'dxy',          weight: 1.0 },
    { key: 'krw_usd',      weight: 0.8 },
    { key: 'kr_rate',      weight: 0.6 },
  ],
  US: [
    { key: 'sefcon_score',       weight: 3.0 },
    { key: 'sp500_last',         weight: 2.5 },
    { key: 'fred_t10y2y',        weight: 1.5 },
    { key: 'fred_vix',           weight: 1.2 },
    { key: 'dxy',                weight: 1.0 },
    { key: 'liquidity_pressure', weight: 1.0 },
    { key: 'credit_stress',      weight: 1.0 },
  ],
  GLOBAL: [
    { key: 'sefcon_score',       weight: 3.0 },
    { key: 'kospi_last',         weight: 1.5 },
    { key: 'sp500_last',         weight: 1.5 },
    { key: 'fred_t10y2y',        weight: 1.5 },
    { key: 'fred_vix',           weight: 1.2 },
    { key: 'dxy',                weight: 1.0 },
    { key: 'krw_usd',            weight: 0.8 },
    { key: 'liquidity_pressure', weight: 1.0 },
    { key: 'credit_stress',      weight: 1.0 },
  ],
};

// ─────────────────────────────────────────────
//  키 값 추출 (makeMetric 객체 or 단순 숫자 모두 처리)
// ─────────────────────────────────────────────
function kiNum(ki, key) {
  const v = ki[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const n = parseFloat(v.value ?? v.val);
    return isNaN(n) ? null : n;
  }
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function extractVec(row, spec) {
  let ki = row.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }

  return spec.map(({ key, weight }) => {
    // top-level 또는 key_indicators 안 둘 다 시도
    let value = kiNum(ki, key);
    if (value === null) {
      const v = parseFloat(row[key]);
      value = isNaN(v) ? null : v;
    }
    return { value, weight };
  });
}

// ─────────────────────────────────────────────
//  정규화 범위 계산
// ─────────────────────────────────────────────
function computeNormRanges(rows, spec) {
  const dims = spec.length;
  const mins = new Array(dims).fill(Infinity);
  const maxs = new Array(dims).fill(-Infinity);

  for (const row of rows) {
    const vec = extractVec(row, spec);
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
//  가중 유클리드 거리
// ─────────────────────────────────────────────
function weightedEuclidean(vecA, vecB, mins, maxs) {
  let sumSq = 0, totalWeight = 0, validDims = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i], b = vecB[i];
    if (a.value === null || b.value === null) continue;
    const range = maxs[i] - mins[i];
    if (range === 0) continue;
    const normA = (a.value - mins[i]) / range;
    const normB = (b.value - mins[i]) / range;
    sumSq += a.weight * (normA - normB) ** 2;
    totalWeight += a.weight;
    validDims++;
  }

  if (validDims === 0) return 1;
  return Math.sqrt(sumSq / totalWeight);
}

function distToSimilarity(dist) {
  const clipped = Math.min(dist, 0.8);
  return Math.round((1 - clipped / 0.8) * 100);
}

// ─────────────────────────────────────────────
//  미래 수익률 계산
// ─────────────────────────────────────────────
function computeForwardReturn(rows, targetDate, horizonMonths) {
  const sorted = [...rows].sort((a, b) =>
    (a.snapshot_date || a.date || '').localeCompare(b.snapshot_date || b.date || '')
  );
  const idx = sorted.findIndex(r =>
    (r.snapshot_date || r.date) === targetDate
  );
  if (idx < 0) return null;

  let ki = sorted[idx].key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
  const baseKospi = kiNum(ki, 'kospi_last') || parseFloat(sorted[idx].kospi_last);
  if (!baseKospi || baseKospi === 0) return null;

  const futureIdx = idx + horizonMonths;
  if (futureIdx >= sorted.length) return null;

  let futureKi = sorted[futureIdx].key_indicators || {};
  if (typeof futureKi === 'string') { try { futureKi = JSON.parse(futureKi); } catch(e) { futureKi = {}; } }
  const futureKospi = kiNum(futureKi, 'kospi_last') || parseFloat(sorted[futureIdx].kospi_last);
  if (!futureKospi || futureKospi === 0) return null;

  return ((futureKospi - baseKospi) / baseKospi) * 100;
}

// ─────────────────────────────────────────────
//  레짐 한글화
// ─────────────────────────────────────────────
const REGIME_KR = {
  CRISIS: '⚡ 위기', HIGH_STRESS: '🔴 고위기',
  ELEVATED: '🟠 주의', CAUTION: '🟡 경계',
  MODERATE: '🟢 보통', STABLE: '🔵 안정',
  RECOVERY: '🌱 회복', EXPANSION: '🚀 확장',
};

function localizeRegime(label) {
  if (!label) return '—';
  for (const [k, v] of Object.entries(REGIME_KR)) {
    if (label.toUpperCase().includes(k)) return v;
  }
  return label;
}

// ─────────────────────────────────────────────
//  날짜 유틸
// ─────────────────────────────────────────────
function daysBetween(dateA, dateB) {
  return Math.round(Math.abs(new Date(dateB) - new Date(dateA)) / (1000 * 60 * 60 * 24));
}

// ─────────────────────────────────────────────
//  메인 — 패턴 매칭
// ─────────────────────────────────────────────
export async function jarvisMatch({
  region = 'KOREA',
  topN = 5,
  forwardDays = 22,
  targetDate = null,
  overrideToday = null,
} = {}) {

  const allRows = await sbFetch(
    `core_intelligence_snapshots?select=*&market=eq.${region}&order=snapshot_date.asc&limit=2000`
  );

  if (!allRows || allRows.length < 10)
    throw new Error(`데이터 부족: ${region} ${allRows?.length || 0}건`);

  let todayRow;
  if (overrideToday) {
    todayRow = overrideToday;
  } else if (targetDate) {
    todayRow = allRows.find(r => (r.snapshot_date || r.date) === targetDate);
    if (!todayRow) throw new Error(`날짜 없음: ${targetDate}`);
  } else {
    todayRow = [...allRows].sort((a, b) =>
      (b.snapshot_date || b.date || '').localeCompare(a.snapshot_date || a.date || '')
    )[0];
  }

  const todayDate = todayRow.snapshot_date || todayRow.date;
  const spec = MATCH_SPEC[region] || MATCH_SPEC.KOREA;

  const historyRows = allRows.filter(r => {
    const d = r.snapshot_date || r.date;
    return daysBetween(d, todayDate) > forwardDays + 5;
  });

  if (historyRows.length < topN)
    throw new Error(`비교 가능한 과거 데이터 부족: ${historyRows.length}건`);

  const { mins, maxs } = computeNormRanges(allRows, spec);
  const todayVec = extractVec(todayRow, spec);

  const scored = historyRows.map(row => {
    const vec = extractVec(row, spec);
    const dist = weightedEuclidean(todayVec, vec, mins, maxs);
    return { row, dist, similarity: distToSimilarity(dist) };
  });

  scored.sort((a, b) => a.dist - b.dist);
  const top = scored.slice(0, topN);

  const matches = top.map(({ row, similarity }) => {
    const rowDate = row.snapshot_date || row.date;
    const fwd3m  = computeForwardReturn(allRows, rowDate, 3);
    const fwd6m  = computeForwardReturn(allRows, rowDate, 6);
    const fwd12m = computeForwardReturn(allRows, rowDate, 12);

    return {
      date:             rowDate,
      similarity,
      sefcon_score:     row.sefcon_score,
      sefcon_level:     row.sefcon_level,
      regime_label:     localizeRegime(row.regime_label),
      crisis_proximity: row.crisis_proximity,
      fwd_3m:           fwd3m  !== null ? +fwd3m.toFixed(2)  : null,
      fwd_6m:           fwd6m  !== null ? +fwd6m.toFixed(2)  : null,
      fwd_12m:          fwd12m !== null ? +fwd12m.toFixed(2) : null,
      key_indicators:   row.key_indicators || {},
    };
  });

  // 합성 신호
  const validFwd3m = matches.filter(m => m.fwd_3m !== null);
  const avgFwd3m = validFwd3m.length
    ? validFwd3m.reduce((s, m) => s + m.fwd_3m, 0) / validFwd3m.length
    : null;

  const bullishCount = matches.filter(m => m.fwd_3m > 5).length;
  const bearishCount = matches.filter(m => m.fwd_3m < -5).length;

  let compositeSignal, signalColor;
  if (bullishCount >= Math.ceil(topN * 0.6)) {
    compositeSignal = '🟢 상승 우위'; signalColor = '#22c55e';
  } else if (bearishCount >= Math.ceil(topN * 0.6)) {
    compositeSignal = '🔴 하락 우위'; signalColor = '#ef4444';
  } else {
    compositeSignal = '🟡 혼조'; signalColor = '#eab308';
  }

  return {
    region, todayDate,
    todayScore:   todayRow.sefcon_score,
    todayRegime:  localizeRegime(todayRow.regime_label),
    topN, forwardDays, matches,
    summary: {
      avgFwd3m: avgFwd3m !== null ? +avgFwd3m.toFixed(2) : null,
      upProb:   Math.round(bullishCount / topN * 100),
      downProb: Math.round(bearishCount / topN * 100),
      flatProb: Math.round((topN - bullishCount - bearishCount) / topN * 100),
      bullishCount, bearishCount,
      compositeSignal, signalColor,
      totalHistoryRows: historyRows.length,
    },
  };
}

// ─────────────────────────────────────────────
//  오늘 스냅샷 주입용
// ─────────────────────────────────────────────
export async function jarvisMatchWithToday(todaySnapshot, opts = {}) {
  return jarvisMatch({ ...opts, overrideToday: todaySnapshot });
}

// ─────────────────────────────────────────────
//  Claude API 해석 — 핵심 추가
// ─────────────────────────────────────────────

const JARVIS_SYSTEM = `당신은 자비스(Jarvis)입니다. 세콰이어 투자 앱의 AI 해석 엔진입니다.

말투와 스타일:
- 오건영 부부장처럼 복잡한 내용을 쉽고 친근하게 설명합니다
- "지금 시장을 보면요", "여기서 중요한 게", "근데 이게 왜 중요하냐면" 같은 자연스러운 표현
- 숫자를 나열하지 않고 서사(narrative)로 풀어냅니다
- 확률론적으로 말합니다. "반드시"가 아닌 "가능성이 높다", "주의가 필요하다"
- 개인 투자자 눈높이에서 설명합니다
- 결론은 명확하게 냅니다

원칙:
- 특정 종목 매수/매도 추천 절대 금지
- 근거없는 확신 금지
- 어려운 금융 용어 남발 금지
- 항상 리스크도 함께 언급`;

async function callClaudeAPI(userPrompt) {
  const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || '';

  // 프론트에서 직접 호출 (Vercel API Route 경유)
  const res = await fetch('/api/jarvis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: JARVIS_SYSTEM,
      prompt: userPrompt,
    }),
  });

  if (!res.ok) throw new Error(`자비스 API 오류: ${res.status}`);
  const data = await res.json();
  return data.interpretation;
}

// ─────────────────────────────────────────────
//  캐시 확인/저장
// ─────────────────────────────────────────────
async function getCached(cacheKey) {
  try {
    const rows = await sbFetch(
      `jarvis_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`
    );
    if (!rows || rows.length === 0) return null;
    const cached = rows[0];
    if (cached.expires_at && new Date(cached.expires_at) < new Date()) return null;
    return cached;
  } catch (e) {
    return null;
  }
}

// 탭별 캐시 시간 (분 단위)
const CACHE_TTL = {
  sefcon:    60 * 6,  // 6시간 — 거시 데이터는 하루 1번만 바뀜
  market:    60 * 6,  // 6시간
  financial: 60 * 6,  // 6시간
  valuation: 60 * 6,  // 6시간
  stock:     60 * 1,  // 1시간 — 종목 탭
  technical: 60 * 6,  // 6시간 — SMA 데이터는 하루 1번 업데이트
};

async function saveCache(cacheKey, tabType, ticker, market, interpretation, similarPeriods) {
  try {
    const ttlMinutes = CACHE_TTL[tabType] || 60;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    await sbFetch('jarvis_cache', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        cache_key:      cacheKey,
        tab_type:       tabType,
        ticker:         ticker || null,
        market:         market,
        interpretation: interpretation,
        similar_periods: similarPeriods,
        expires_at:     expiresAt,
      }),
    });
  } catch (e) {
    console.warn('캐시 저장 실패:', e);
  }
}

// ─────────────────────────────────────────────
//  자비스 해석 메인 함수
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.tabType   - 'sefcon' | 'market' | 'stock' | 'financial' | 'valuation' | 'technical'
 * @param {string} opts.region    - 'KOREA' | 'US' | 'GLOBAL'
 * @param {string} opts.ticker    - 종목코드 (종목 탭일 경우)
 * @param {boolean} opts.useCache - 캐시 사용 여부 (기본 true)
 * @returns {Promise<JarvisInterpretation>}
 */
export async function jarvisInterpret({
  tabType = 'sefcon',
  region  = 'KOREA',
  ticker  = null,
  useCache = true,
} = {}) {

  // 캐시 키 — 탭별 TTL에 맞게 시간 단위 조정
  const now = new Date();
  const ttlMinutes = CACHE_TTL[tabType] || 60;
  const slotMinutes = Math.floor(now.getMinutes() / ttlMinutes) * ttlMinutes;
  const timeSlot = `${now.toISOString().slice(0, 11)}${String(now.getHours()).padStart(2,'0')}${String(slotMinutes).padStart(2,'0')}`;
  const cacheKey = `${tabType}_${ticker || region}_${timeSlot}`;

  // 캐시 확인
  if (useCache) {
    const cached = await getCached(cacheKey);
    if (cached) {
      return {
        interpretation: cached.interpretation,
        similar_periods: cached.similar_periods || [],
        from_cache: true,
      };
    }
  }

  // 패턴 매칭 실행
  const matchResult = await jarvisMatch({ region, topN: 5 });
  const { matches, summary, todayDate, todayScore, todayRegime } = matchResult;

  // 최신 지표 추출
  const allRows = await sbFetch(
    `core_intelligence_snapshots?select=*&market=eq.${region}&order=snapshot_date.desc&limit=1`
  );
  const latest = allRows[0] || {};
  let ki = latest.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }

  const getKi = (key) => {
    const v = ki[key];
    if (!v) return '—';
    if (typeof v === 'object') return v.value ?? '—';
    return v;
  };

  // SMA 데이터 (종목 탭)
  let smaText = '';
  if (ticker) {
    try {
      const smaRows = await sbFetch(
        `smart_money_daily?ticker=eq.${ticker}&order=trade_date.desc&limit=1&select=*`
      );
      if (smaRows && smaRows.length > 0) {
        const s = smaRows[0];
        const syncLabel = s.sma_sync === 2 ? '쌍끌이 매수 🔥'
          : s.sma_sync === -2 ? '쌍매도 ⚠️' : '혼조';
        smaText = `
[스마트머니 수급 - ${ticker}]
시그널: ${s.sma_signal} (점수: ${s.sma_score})
외인 순매수: ${(s.foreign_net_value / 1e8).toFixed(1)}억원
기관 순매수: ${(s.institution_net_value / 1e8).toFixed(1)}억원
외인+기관 동기화: ${syncLabel}
가속도: ${s.sma_acceleration} (평소 대비 ${s.sma_acceleration > 1 ? '강한' : '약한'} 에너지)`;
      }
    } catch(e) { /* SMA 데이터 없으면 무시 */ }
  }

  // 유사 국면 텍스트
  const similarText = matches.map(m =>
    `- ${m.date}: 유사도 ${m.similarity}%, SEFCON ${m.sefcon_score}, ` +
    `3개월 후 ${m.fwd_3m !== null ? (m.fwd_3m > 0 ? '+' : '') + m.fwd_3m + '%' : '데이터없음'}, ` +
    `6개월 후 ${m.fwd_6m !== null ? (m.fwd_6m > 0 ? '+' : '') + m.fwd_6m + '%' : '데이터없음'}`
  ).join('\n');

  // ── 탭별 맞춤 프롬프트 생성
  const buildPrompt = () => {
    const base = `
[현재 거시 지표 - ${todayDate}]
SEFCON: ${todayScore} / ${todayRegime}
VIX: ${getKi('fred_vix')} | 장단기금리차: ${getKi('fred_t10y2y')}
유동성압력: ${getKi('liquidity_pressure')} | 신용스트레스: ${getKi('credit_stress')}
KRW/USD: ${getKi('krw_usd')} | 코스피: ${getKi('kospi_last')}
한국금리: ${getKi('kr_rate')}% | DXY: ${getKi('dxy')}
LEI: ${getKi('fred_lei')} | SLOOS: ${getKi('fred_sloos')}

[역사적 유사 국면 TOP5 - 26년치 ${matchResult.summary.totalHistoryRows}개 중]
${similarText}

[시나리오 확률]
상승(+5% 초과): ${summary.upProb}%
횡보(-5%~+5%): ${summary.flatProb}%
하락(-5% 미만): ${summary.downProb}%
유사 국면 평균 3개월 수익률: ${summary.avgFwd3m !== null ? (summary.avgFwd3m > 0 ? '+' : '') + summary.avgFwd3m + '%' : '계산불가'}`;

    if (tabType === 'sefcon') {
      return base + `

[지시사항 - SEFCON 거시 국면]
① 현재 거시 국면을 오건영 스타일로 쉽게 설명 (2-3문장)
② 금융위기 경보 수준 — 현재가 위기 전조인지, 회복 중인지, 확장 중인지 판단
   과거 유사 국면(2008 금융위기, 2020 코로나, 2022 긴축 쇼크 등)과 비교해서 구체적으로
③ 경기 전환 시점 예측 — 지금이 확장/둔화/침체/회복 중 어느 단계인지
   전환이 임박했다면 그 신호와 예상 시점 언급
④ 3개월 시나리오 (낙관/중립/비관 각 1문장)
⑤ 지금 가장 주목할 핵심 변수 1개
전체 600자 이내`;
    }

    if (tabType === 'market') {
      return base + `

[지시사항 - 시장 탭]
① 현재 코스피/코스닥 방향성을 거시 국면과 연결해서 해석 (2문장)
② 역사적 유사 국면에서 지수가 어떻게 움직였는지 구체적으로
③ 외국인/기관 수급 흐름이 지수에 미치는 영향
④ 3개월 지수 방향 시나리오 (낙관/중립/비관)
⑤ 지금 시장에서 가장 중요한 변수 1개
전체 500자 이내`;
    }

    if (tabType === 'technical') {
      return base + `
${smaText}

[지시사항 - 기술분석 + 수급]
먼저 [수급] 섹션을 작성하세요:
- 외인/기관 수급 현황과 최근 변화
- SMA 시그널 해석 (SUPERNOVA/ACCUMULATION/NOISE/ESCAPE 의미 설명)
- 외인+기관 동기화 여부 (쌍끌이 매수인지, 엇갈리는지)
- 월봉 기준으로 의미있는 수급 변화가 있으면 매수/매도 시점으로 언급

그 다음 [기술적 위치] 섹션:
- 현재 가격의 기술적 위치 (거시 국면과 연결)
- 매수 고려 시점 또는 매도 주의 시점 판단
- 단기/중기 방향성

전체 600자 이내`;
    }

    if (tabType === 'financial') {
      return base + `

[지시사항 - 재무 해석]
① 현재 거시 환경(금리/환율/유동성)이 이 기업 재무에 미치는 영향
② 매출/영업이익/현금흐름 트렌드를 서사로 풀어서
③ 지금 거시 국면에서 이 기업 재무의 강점과 취약점
④ 향후 실적에 영향을 줄 핵심 거시 변수 1개
전체 500자 이내`;
    }

    if (tabType === 'valuation') {
      return base + `

[지시사항 - 가치평가]
① 현재 가격과 내재가치 사이의 괴리 — 고평가/저평가/적정 판단
② 역사적으로 비슷한 괴리가 있었던 시점과 그 이후 주가 흐름
③ 괴리가 좁혀지는 시나리오와 예상 기간
   - 낙관: 어떤 조건에서, 얼마나 빨리
   - 중립: 기본 시나리오
   - 비관: 괴리가 더 벌어지는 경우
④ 지금 가격에서 매수/보유/관망 중 어떤 판단이 합리적인지
전체 600자 이내`;
    }

    // 기본 (stock 등)
    return base + `
${smaText}

[지시사항]
① 현재 거시 국면과 이 종목의 연관성
② 스마트머니 흐름 해석
③ 3개월 시나리오
④ 핵심 변수 1개
전체 500자 이내`;
  };

  const userPrompt = buildPrompt();

  // Claude API 호출
  const interpretation = await callClaudeAPI(userPrompt);

  // 캐시 저장
  await saveCache(cacheKey, tabType, ticker, region, interpretation, matches);

  return {
    interpretation,
    similar_periods: matches,
    summary,
    todayDate,
    from_cache: false,
  };
}
