/**
 * 자비스 (J.A.R.V.I.S.) INSIGHT — 세콰이어 AI 해석 엔진 v4
 *
 * v4 변경사항:
 * - SEFCON 탭: GitHub Actions 미리 생성 캐시 즉시 반환 (25시간 TTL)
 * - 주가 탭: 패널 클릭 시 호출, SEFCON + 수급 해석, 2시간 캐시
 * - 유사국면 매칭 완전 제거
 */

import { SB_URL, SB_KEY } from '../constants/supabase';

// ─────────────────────────────────────────────
//  Supabase fetch 헬퍼
// ─────────────────────────────────────────────
const sbFetch = async (path, opts = {}) => {
  const { headers: extraHeaders, ...restOpts } = opts;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...restOpts,
    headers: {
      apikey:         SB_KEY,
      Authorization:  `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  return JSON.parse(text);
};

// ─────────────────────────────────────────────
//  캐시 조회
// ─────────────────────────────────────────────
async function getCached(cacheKey) {
  try {
    const rows = await sbFetch(
      `jarvis_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=interpretation,similar_periods,expires_at&limit=1`
    );
    if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
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
async function saveCache(cacheKey, tabType, ticker, market, interpretation, ttlMinutes) {
  try {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    await sbFetch('jarvis_cache?on_conflict=cache_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        cache_key:       cacheKey,
        tab_type:        tabType,
        ticker:          ticker || null,
        market:          market,
        interpretation:  interpretation,
        similar_periods: [],
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
const JARVIS_SYSTEM = `당신은 J.A.R.V.I.S. INSIGHT입니다. 세콰이어 투자 앱의 AI 해석 엔진입니다.

말투와 스타일:
- 오건영 부부장처럼 복잡한 내용을 쉽고 친근하게 설명합니다
- "지금 시장을 보면요", "여기서 중요한 게", "근데 이게 왜 중요하냐면" 같은 자연스러운 표현
- 숫자를 나열하지 않고 서사(narrative)로 풀어냅니다
- 확률론적으로 말합니다. "반드시"가 아닌 "가능성이 높다", "주의가 필요하다"
- 개인 투자자 눈높이에서 설명합니다
- 결론은 명확하게 냅니다

형식 규칙 (반드시 준수):
- 마크다운 절대 금지: ##, **, --, ---, >, * 등 사용 금지
- 줄바꿈은 문단 구분할 때만 1회, 연속 빈 줄 금지
- 섹션 제목 없이 자연스러운 문장 흐름으로 연결
- 간결하고 밀도있게, 불필요한 여백 없이
- 전체 400자 이내

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
//  최신 SEFCON 스냅샷 조회
// ─────────────────────────────────────────────
async function getLatestSnapshot(region = 'KOREA') {
  const rows = await sbFetch(
    `core_intelligence_snapshots?select=snapshot_date,sefcon_score,sefcon_level,key_indicators&market=eq.${region}&key_indicators=not.is.null&order=snapshot_date.desc&limit=1`
  );
  const latest = (rows && Array.isArray(rows) && rows[0]) || {};
  let ki = latest.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }

  const getKi = (key) => {
    const v = ki[key];
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return v.value ?? '—';
    return v;
  };

  return { latest, getKi, snapshotDate: latest.snapshot_date || '—' };
}

// ─────────────────────────────────────────────
//  SMA 수급 데이터 조회
// ─────────────────────────────────────────────
async function getSmaData(ticker) {
  try {
    const rows = await sbFetch(
      `smart_money_daily?ticker=eq.${ticker}&order=trade_date.desc&limit=1&select=trade_date,sma_signal,sma_score,sma_sync,sma_acceleration,foreign_net_value,institution_net_value`
    );
    if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch(e) {
    return null;
  }
}

// ─────────────────────────────────────────────
//  스마트머니 활성화 여부 확인
// ─────────────────────────────────────────────
async function getIsActive(ticker) {
  try {
    const rows = await sbFetch(
      `stock_universe?ticker=eq.${ticker}&select=is_active&limit=1`
    );
    if (!rows || !Array.isArray(rows) || rows.length === 0) return false;
    return !!rows[0].is_active;
  } catch(e) {
    return false;
  }
}

// ─────────────────────────────────────────────
//  주가 탭 프롬프트 생성
// ─────────────────────────────────────────────
function buildStockPrompt({ latest, getKi, snapshotDate }, smaData, ticker, stockName) {
  const base = `[거시 참고 - ${snapshotDate}]
SEFCON: ${getKi('sefcon_score')}/100 (레벨 ${getKi('sefcon_level')} 위기)
코스피: ${getKi('kospi_last')} / 환율: ${getKi('krw_usd')}원
VIX: ${getKi('fred_vix')} / 금리차: ${getKi('fred_t10y2y')}
유동성압력: ${getKi('liquidity_pressure')} / 신용스트레스: ${getKi('credit_stress')}`;

  const smaText = smaData ? `
[스마트머니 수급 - ${ticker}]
시그널: ${smaData.sma_signal} (점수: ${smaData.sma_score})
외인 순매수: ${(smaData.foreign_net_value / 1e8).toFixed(1)}억원
기관 순매수: ${(smaData.institution_net_value / 1e8).toFixed(1)}억원
동기화: ${smaData.sma_sync === 2 ? '쌍끌이 매수 🔥' : smaData.sma_sync === -2 ? '쌍매도 ⚠️' : '혼조'}
가속도: ${smaData.sma_acceleration}` : '';

  const instruction = smaData
    ? `위 데이터를 바탕으로 ${stockName}(${ticker}) 종목을 해석해주세요.
거시 환경은 참고용으로만 활용하고, 핵심은 이 종목의 수급 흐름입니다.
① 수급 시그널이 말하는 것 — 외인/기관 동향과 의미
② 현재 거시 환경과 이 종목의 연관성 (관련 있으면 언급, 없으면 생략)
③ 단기 모멘텀 판단
④ 주의할 리스크 1개
마크다운 기호 절대 사용 금지. 400자 이내.`
    : `위 거시 데이터를 참고해서 ${stockName}(${ticker}) 종목을 해석해주세요.
스마트머니 수급 데이터가 없어 거시 환경 중심으로 분석합니다.
① 현재 거시 환경과 이 종목 섹터의 연관성
② 지금 이 종목에 유리하거나 불리한 거시 조건
③ 주의할 리스크 1개
스마트머니 활성화 시 더 정밀한 수급 분석이 가능합니다.
마크다운 기호 절대 사용 금지. 400자 이내.`;

  return `${base}${smaText}\n\n${instruction}`;
}

// ─────────────────────────────────────────────
//  메인 — 자비스 해석
// ─────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.tabType   - 'sefcon' | 'stock'
 * @param {string} opts.region    - 'KOREA'
 * @param {string} opts.ticker    - 종목코드 (주가 탭)
 * @param {boolean} opts.useCache - 캐시 사용 여부 (기본 true)
 */
export async function jarvisInterpret({
  tabType  = 'sefcon',
  region   = 'KOREA',
  ticker   = null,
  name     = null,
  useCache = true,
} = {}) {

  const today = new Date().toISOString().slice(0, 10);

  // 캐시 키 결정
  const cacheKey = tabType === 'sefcon'
    ? `sefcon_KOREA_${today}`
    : `stock_${ticker}_${today}_${Math.floor(Date.now() / (2 * 60 * 60 * 1000))}`; // 2시간 슬롯

  // 캐시 확인
  if (useCache) {
    const cached = await getCached(cacheKey);
    if (cached) {
      return {
        interpretation:  cached.interpretation,
        similar_periods: [],
        from_cache:      true,
      };
    }
  }

  // SEFCON 탭: 캐시 미스 → GitHub Actions가 아직 안 돌았거나 오류
  if (tabType === 'sefcon') {
    console.warn('[자비스] SEFCON 캐시 없음 — GitHub Actions 확인 필요');
    return {
      interpretation:  '오늘 분석을 준비 중입니다. 잠시 후 다시 시도해주세요.',
      similar_periods: [],
      from_cache:      false,
    };
  }

  // 주가 탭: 최신 SEFCON + 수급 조회 후 Claude API 호출
  if (tabType === 'stock' && ticker) {
    const snapshotData = await getLatestSnapshot(region);
    const isActive     = await getIsActive(ticker);
    const smaData      = isActive ? await getSmaData(ticker) : null;
    const stockName    = name || ticker;
    const prompt       = buildStockPrompt(snapshotData, smaData, ticker, stockName);
    const interpretation = await callClaudeAPI(prompt);

    await saveCache(cacheKey, 'stock', ticker, region, interpretation, 120);

    return {
      interpretation,
      similar_periods: [],
      from_cache:      false,
    };
  }

  return {
    interpretation:  '지원하지 않는 탭입니다.',
    similar_periods: [],
    from_cache:      false,
  };
}
