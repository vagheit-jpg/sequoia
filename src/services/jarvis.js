/**
 * 자비스 (J.A.R.V.I.S.) INSIGHT — 세콰이어 AI 해석 엔진 v5
 *
 * v5 변경사항:
 * - TTL 24시간으로 통일
 * - 비활성화 종목: 웹서치 + DART 공시 포함
 * - 활성화 종목: GitHub Actions 미리 생성 캐시 즉시 반환
 * - SEFCON 탭: GitHub Actions 미리 생성 캐시 즉시 반환
 */

import { SB_URL, SB_KEY } from '../constants/supabase';

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

async function saveCache(cacheKey, tabType, ticker, market, interpretation) {
  try {
    // 24시간 TTL
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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
- 전체 500자 이내, 반드시 완성된 문장으로 마무리

원칙:
- 특정 종목 매수/매도 추천 절대 금지
- 근거없는 확신 금지
- 어려운 금융 용어 남발 금지
- 항상 리스크도 함께 언급`;

async function callClaudeAPI(userPrompt, useWebSearch = false) {
  const res = await fetch('/api/jarvis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: JARVIS_SYSTEM, prompt: userPrompt, useWebSearch }),
  });
  if (!res.ok) throw new Error(`자비스 API 오류: ${res.status}`);
  const data = await res.json();
  return data.interpretation;
}

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

function buildStockPrompt({ getKi, snapshotDate }, smaData, ticker, stockName, dartText = '') {
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

  const dartSection = dartText ? `\n${dartText}` : '';

  const webSearchInstruction = !smaData
    ? `웹서치로 ${stockName} 최신 뉴스와 주요 이슈를 검색한 후 아래 분석에 반영해주세요.` : '';

  const instruction = smaData
    ? `위 데이터를 바탕으로 ${stockName}(${ticker}) 종목을 해석해주세요.
거시 환경은 참고용, 핵심은 수급 흐름입니다.
① 수급 시그널이 말하는 것 — 외인/기관 동향과 의미
② 현재 거시 환경과 이 종목의 연관성 (관련 있으면 언급)
③ 최근 공시/뉴스가 있다면 주가에 미치는 영향
④ 주의할 리스크 1개
마크다운 기호 절대 사용 금지. 500자 이내, 완성된 문장으로 마무리.`
    : `${webSearchInstruction}
위 거시 데이터와 최신 뉴스/공시를 종합해서 ${stockName}(${ticker}) 종목을 해석해주세요.
① 현재 거시 환경과 이 종목 섹터의 연관성
② 최신 뉴스/공시에서 주목할 내용
③ 지금 이 종목에 유리하거나 불리한 조건
④ 주의할 리스크 1개
마크다운 기호 절대 사용 금지. 500자 이내, 완성된 문장으로 마무리.`;

  return `${base}${smaText}${dartSection}\n\n${instruction}`;
}

export async function jarvisInterpret({
  tabType  = 'sefcon',
  region   = 'KOREA',
  ticker   = null,
  name     = null,
  useCache = true,
} = {}) {

  const today    = new Date().toISOString().slice(0, 10);
  const cacheKey = tabType === 'sefcon'
    ? `sefcon_KOREA_${today}`
    : `stock_${ticker}_${today}`;  // 24시간 슬롯 (날짜 기준)

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

  if (tabType === 'sefcon') {
    console.warn('[자비스] SEFCON 캐시 없음 — GitHub Actions 확인 필요');
    return {
      interpretation:  '오늘 분석을 준비 중입니다. 잠시 후 다시 시도해주세요.',
      similar_periods: [],
      from_cache:      false,
    };
  }

  if (tabType === 'stock' && ticker) {
    const snapshotData = await getLatestSnapshot(region);
    const isActive     = await getIsActive(ticker);
    const smaData      = isActive ? await getSmaData(ticker) : null;
    const stockName    = name || ticker;

    // 비활성화 종목: 웹서치 포함 (활성화 종목은 GitHub Actions에서 미리 생성)
    const useWebSearch = !isActive;
    const prompt       = buildStockPrompt(snapshotData, smaData, ticker, stockName);
    const interpretation = await callClaudeAPI(prompt, useWebSearch);

    await saveCache(cacheKey, 'stock', ticker, region, interpretation);

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
