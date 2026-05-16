/**
 * 자비스 (J.A.R.V.I.S.) — 세콰이어 AI 해석 엔진 v3
 *
 * v3 변경사항:
 * - 캐시 전략 통일: Supabase jarvis_cache 단일화 (localStorage 제거)
 * - 탭별 분기: sefcon/market → GitHub Actions 미리 생성된 캐시 즉시 반환
 * - 개별 종목 탭(technical/financial/valuation/stock) → 클릭 시 최근 1건만 조회 + Claude API
 * - 26년치 패턴 매칭은 sefcon/market 전용 (generateJarvis.js에서 처리)
 */

import { SB_URL, SB_KEY } from '../constants/supabase';

// ─────────────────────────────────────────────
//  Supabase fetch 헬퍼
// ─────────────────────────────────────────────
const sbFetch = async (path, opts = {}) => {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SB_KEY,
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
//  캐시 조회
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

// ─────────────────────────────────────────────
//  캐시 저장
// ─────────────────────────────────────────────
async function saveCache(cacheKey, tabType, ticker, market, interpretation, similarPeriods, ttlMinutes = 120) {
  try {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    await sbFetch('jarvis_cache', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        cache_key:       cacheKey,
        tab_type:        tabType,
        ticker:          ticker || null,
        market:          market,
        interpretation:  interpretation,
        similar_periods: similarPeriods || [],
        expires_at:      expiresAt,
      }),
    });
  } catch (e) {
    console.warn('캐시 저장 실패:', e);
  }
}

// ─────────────────────────────────────────────
//  Claude API 호출 (Vercel API Route 경유)
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
  const res = await fetch('/api/jarvis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: JARVIS_SYSTEM, prompt: userPrompt }),
  });
  if (!res.ok) throw new Error(`자비스 API 오류: ${res.status}`);
  const data = await res.json();
  return data.interpretation;
}

// ─────────────────────────────────────────────
//  최근 거시 지표 1건 조회 (개별 종목 탭용)
// ─────────────────────────────────────────────
async function getLatestSnapshot(region = 'KOREA') {
  const rows = await sbFetch(
    `core_intelligence_snapshots?select=*&market=eq.${region}&order=snapshot_date.desc&limit=1`
  );
  const latest = rows[0] || {};
  let ki = latest.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
  const getKi = (key) => {
    const v = ki[key];
    if (!v) return '—';
    if (typeof v === 'object') return v.value ?? '—';
    return v;
  };
  return { latest, getKi, snapshotDate: latest.snapshot_date };
}

// ─────────────────────────────────────────────
//  SMA 수급 데이터 조회
// ─────────────────────────────────────────────
async function getSmaData(ticker) {
  try {
    const rows = await sbFetch(
      `smart_money_daily?ticker=eq.${ticker}&order=trade_date.desc&limit=1&select=*`
    );
    if (!rows || rows.length === 0) return '';
    const s = rows[0];
    const syncLabel = s.sma_sync === 2 ? '쌍끌이 매수 🔥'
      : s.sma_sync === -2 ? '쌍매도 ⚠️' : '혼조';
    return `
[스마트머니 수급 - ${ticker}]
시그널: ${s.sma_signal} (점수: ${s.sma_score})
외인 순매수: ${(s.foreign_net_value / 1e8).toFixed(1)}억원
기관 순매수: ${(s.institution_net_value / 1e8).toFixed(1)}억원
외인+기관 동기화: ${syncLabel}
가속도: ${s.sma_acceleration}`;
  } catch(e) {
    return '';
  }
}

// ─────────────────────────────────────────────
//  개별 종목 탭 프롬프트 생성
// ─────────────────────────────────────────────
function buildStockPrompt(tabType, { snapshotDate, getKi }, smaText = '', ticker = '') {
  const base = `
[현재 거시 지표 - ${snapshotDate}]
SEFCON: ${getKi('sefcon_score')} 
VIX: ${getKi('fred_vix')} | 장단기금리차: ${getKi('fred_t10y2y')}
유동성압력: ${getKi('liquidity_pressure')} | 신용스트레스: ${getKi('credit_stress')}
KRW/USD: ${getKi('krw_usd')} | 코스피: ${getKi('kospi_last')}
한국금리: ${getKi('kr_rate')}% | DXY: ${getKi('dxy')}`;

  if (tabType === 'technical') {
    return base + `
${smaText}

[지시사항 - 기술분석 + 수급]
먼저 [수급] 섹션:
- 외인/기관 수급 현황과 최근 변화
- SMA 시그널 해석
- 외인+기관 동기화 여부

그 다음 [기술적 위치] 섹션:
- 현재 거시 환경에서의 기술적 위치
- 매수 고려 또는 매도 주의 시점 판단
전체 600자 이내`;
  }

  if (tabType === 'financial') {
    return base + `

[지시사항 - 재무 해석 / 종목: ${ticker}]
① 현재 거시 환경(금리/환율/유동성)이 이 기업 재무에 미치는 영향
② 지금 거시 국면에서 이 기업 재무의 강점과 취약점
③ 향후 실적에 영향을 줄 핵심 거시 변수 1개
전체 500자 이내`;
  }

  if (tabType === 'valuation') {
    return base + `

[지시사항 - 가치평가 / 종목: ${ticker}]
① 현재 거시 환경에서 고평가/저평가/적정 판단 근거
② 괴리가 좁혀지는 시나리오 (낙관/중립/비관)
③ 지금 가격에서 매수/보유/관망 중 합리적 판단
전체 600자 이내`;
  }

  // stock (주가 탭)
  return base + `
${smaText}

[지시사항 - 주가 탭 / 종목: ${ticker}]
① 현재 거시 국면과 이 종목의 연관성
② 스마트머니 흐름 해석
③ 3개월 시나리오
④ 핵심 변수 1개
전체 500자 이내`;
}

// ─────────────────────────────────────────────
//  메인 — 자비스 해석
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.tabType   - 'sefcon' | 'market' | 'technical' | 'financial' | 'valuation' | 'stock'
 * @param {string} opts.region    - 'KOREA' | 'US' | 'GLOBAL'
 * @param {string} opts.ticker    - 종목코드 (개별 종목 탭)
 * @param {boolean} opts.useCache - 캐시 사용 여부 (기본 true)
 */
export async function jarvisInterpret({
  tabType  = 'sefcon',
  region   = 'KOREA',
  ticker   = null,
  useCache = true,
} = {}) {

  const today    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const isMacro  = tabType === 'sefcon' || tabType === 'market';

  // ── 캐시 키 결정
  // 거시 탭: 날짜 기반 (GitHub Actions가 매일 생성)
  // 종목 탭: ticker + tabType + 날짜 기반 (2시간 TTL)
  const cacheKey = isMacro
    ? `${tabType}_${region}_${today}`
    : `${tabType}_${ticker || region}_${today}`;

  // ── 캐시 확인
  if (useCache) {
    const cached = await getCached(cacheKey);
    if (cached) {
      return {
        interpretation:  cached.interpretation,
        similar_periods: cached.similar_periods || [],
        from_cache:      true,
      };
    }
  }

  // ── 거시 탭: 캐시 미스 시 경고 (GitHub Actions가 아직 안 돌았거나 오류)
  if (isMacro) {
    console.warn(`[자비스] ${tabType} 캐시 없음 — GitHub Actions 확인 필요`);
    return {
      interpretation:  '자비스 준비 중입니다. 잠시 후 다시 시도해주세요.',
      similar_periods: [],
      from_cache:      false,
    };
  }

  // ── 개별 종목 탭: 최근 1건만 조회 + Claude API 호출
  const snapshotData = await getLatestSnapshot(region);
  const smaText      = ticker ? await getSmaData(ticker) : '';
  const prompt       = buildStockPrompt(tabType, snapshotData, smaText, ticker);
  const interpretation = await callClaudeAPI(prompt);

  // 2시간 캐시 저장
  await saveCache(cacheKey, tabType, ticker, region, interpretation, [], 120);

  return {
    interpretation,
    similar_periods: [],
    from_cache:      false,
  };
}

// ─────────────────────────────────────────────
//  기존 함수 유지 (호환성)
// ─────────────────────────────────────────────
export async function jarvisMatch(opts = {}) {
  // generateJarvis.js로 이전됨 — 직접 호출 필요 시 사용
  throw new Error('jarvisMatch는 generateJarvis.js에서 실행됩니다.');
}

export async function jarvisMatchWithToday(todaySnapshot, opts = {}) {
  throw new Error('jarvisMatchWithToday는 generateJarvis.js에서 실행됩니다.');
}
