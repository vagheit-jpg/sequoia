/**
 * generateJarvis.js v2
 * GitHub Actions에서 매일 새벽 실행
 * 1. SEFCON 탭 자비스 생성 (웹서치 포함)
 * 2. 스마트머니 활성화 종목 자비스 생성 (수급 + DART + 웹서치)
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;
const DART_API_KEY         = process.env.DART_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
  console.error('❌ 환경변수 누락');
  process.exit(1);
}

// ─────────────────────────────────────────────
//  Supabase fetch
// ─────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const { headers: extraHeaders, ...restOpts } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...restOpts,
    headers: {
      apikey:         SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  return JSON.parse(text);
}

// ─────────────────────────────────────────────
//  DART 공시 조회
// ─────────────────────────────────────────────
async function getDartDisclosures(ticker) {
  if (!DART_API_KEY) return '';
  try {
    const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${DART_API_KEY}&stock_code=${ticker}&page_count=5`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const data = await res.json();
    if (data.status !== '000' || !data.list) return '';
    const items = data.list.slice(0, 5).map(d => `- ${d.rcept_dt} ${d.report_nm}`).join('\n');
    return items ? `[최근 공시]\n${items}` : '';
  } catch(e) {
    return '';
  }
}

// ─────────────────────────────────────────────
//  Claude API (웹서치 포함)
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
- 전체 500자 이내, 반드시 완성된 문장으로 마무리

원칙:
- 특정 종목 매수/매도 추천 절대 금지
- 근거없는 확신 금지
- 어려운 금융 용어 남발 금지
- 항상 리스크도 함께 언급`;

async function callClaude(prompt, useWebSearch = false) {
  const body = {
    model:      'claude-sonnet-4-6',
    max_tokens: 800,
    system:     JARVIS_SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  };
  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ─────────────────────────────────────────────
//  캐시 저장
// ─────────────────────────────────────────────
async function saveCache({ cacheKey, tabType, ticker, market, interpretation }) {
  const expiresAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // 25시간
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
}

// ─────────────────────────────────────────────
//  SEFCON 스냅샷 조회
// ─────────────────────────────────────────────
async function getLatestSnapshot() {
  const rows = await sbFetch(
    `core_intelligence_snapshots?select=snapshot_date,sefcon_score,sefcon_level,key_indicators&market=eq.KOREA&key_indicators=not.is.null&order=snapshot_date.desc&limit=1`
  );
  if (!rows || !Array.isArray(rows) || rows.length === 0) throw new Error('스냅샷 없음');
  const row = rows[0];
  let ki = row.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
  const getKi = (key) => {
    const v = ki[key];
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return v.value ?? null;
    return v;
  };
  return { row, getKi, snapshotDate: row.snapshot_date };
}

// ─────────────────────────────────────────────
//  SEFCON 프롬프트
// ─────────────────────────────────────────────
function buildSefconPrompt({ row, getKi, snapshotDate }) {
  return `아래는 오늘(${snapshotDate}) 기준 세콰이어 SEFCON 데이터입니다.

[SEFCON 종합]
점수: ${getKi('sefcon_score') ?? row.sefcon_score}/100 / 레벨: ${getKi('sefcon_level') ?? row.sefcon_level}단계 위기
⚠️ SEFCON 해석 주의: 점수가 낮을수록 위기(0=최고위기), 높을수록 안전(100=완전안정). 현재 점수는 위험 구간입니다.

[카테고리별 위험도]
신용위험: ${getKi('cat_credit') ?? '—'} / 시장공포: ${getKi('cat_fear') ?? '—'} / 실물경기: ${getKi('cat_real') ?? '—'} / 유동성: ${getKi('cat_liquidity') ?? '—'} / 물가: ${getKi('cat_inflation') ?? '—'}

[주요 지표]
코스피: ${getKi('kospi_last') ?? '—'} (역사적 고점 수준) / 코스닥: ${getKi('kosdaq_last') ?? '—'}
환율: ${getKi('krw_usd') ?? '—'}원 / 금리차(10Y-2Y): ${getKi('fred_t10y2y') ?? '—'}
VIX: ${getKi('fred_vix') ?? '—'} / DXY: ${getKi('dxy') ?? '—'} / 한국금리: ${getKi('kr_rate') ?? '—'}%
유동성압력: ${getKi('liquidity_pressure') ?? '—'} / 신용스트레스: ${getKi('credit_stress') ?? '—'} / SLOOS: ${getKi('fred_sloos') ?? '—'}
외국인 순매수: ${getKi('foreign_net') ?? '—'}

웹서치로 최신 연준(Fed) 동향, 한국은행 동향, 한국 증시 수급 관련 최신 뉴스를 검색하세요.
Korea Herald, Korea Times, Bloomberg, Reuters 등 영문 소스 우선 활용.

위 데이터와 최신 뉴스를 종합해서 해석해주세요:
① 지금 거시 국면 — SEFCON 수치들이 말하는 것 (2-3문장)
② 카테고리 간 관계 — 가장 주목할 조합과 의미
③ 최신 연준/한은 동향이 현재 지표에 미치는 영향
④ 지금 가장 중요한 변수 1개와 이유
⑤ 3개월 시나리오 — 낙관/중립/비관 각 1문장
마크다운 기호 절대 사용 금지. 600자 이내, 완성된 문장으로 마무리.`;
}

// ─────────────────────────────────────────────
//  종목 자비스 프롬프트
// ─────────────────────────────────────────────
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
동기화: ${smaData.sma_sync === 2 ? '쌍끌이 매수' : smaData.sma_sync === -2 ? '쌍매도' : '혼조'}
가속도: ${smaData.sma_acceleration}` : '';

  const dartSection = dartText ? `\n${dartText}` : '';

  return `${base}${smaText}${dartSection}

웹서치로 ${stockName} 최신 뉴스와 주요 이슈를 검색한 후 아래 분석에 반영해주세요.

위 데이터를 바탕으로 ${stockName}(${ticker}) 종목을 해석해주세요.
① 수급 시그널이 말하는 것 — 외인/기관 동향과 의미
② 최신 뉴스/공시에서 주목할 내용
③ 현재 거시 환경과 이 종목의 연관성
④ 주의할 리스크 1개
마크다운 기호 절대 사용 금지. 500자 이내, 완성된 문장으로 마무리.`;
}

// ─────────────────────────────────────────────
//  메인
// ─────────────────────────────────────────────
async function main() {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`\n🤖 J.A.R.V.I.S. INSIGHT 생성 시작 — ${today}\n`);

  // 1. SEFCON 탭
  console.log('▶ SEFCON 처리 중...');
  try {
    const snapshotData   = await getLatestSnapshot();
    const prompt         = buildSefconPrompt(snapshotData);
    const interpretation = await callClaude(prompt, true);
    await saveCache({ cacheKey: `sefcon_KOREA_${today}`, tabType: 'sefcon', ticker: null, market: 'KOREA', interpretation });
    console.log('✅ SEFCON 완료');
    // 다음 요청 전 대기
    await new Promise(r => setTimeout(r, 30000));
  } catch (err) {
    console.error('❌ SEFCON 실패:', err.message);
  }

  // 2. 활성화 종목 자비스
  let activeStocks = [];
  try {
    const rows = await sbFetch('stock_universe?is_active=eq.true&select=ticker,name');
    activeStocks = rows || [];
    console.log(`\n▶ 활성화 종목 ${activeStocks.length}개 처리 중...`);
  } catch(e) {
    console.error('❌ 활성화 종목 조회 실패:', e.message);
  }

  for (const stock of activeStocks) {
    const { ticker, name } = stock;
    const cacheKey = `stock_${ticker}_${today}`;
    console.log(`  → ${name}(${ticker})`);
    try {
      const snapshotData = await getLatestSnapshot();

      // 수급 조회
      const smaRows = await sbFetch(
        `smart_money_daily?ticker=eq.${ticker}&order=trade_date.desc&limit=1&select=sma_signal,sma_score,sma_sync,sma_acceleration,foreign_net_value,institution_net_value`
      );
      const smaData = (smaRows && smaRows[0]) || null;

      // DART 공시
      const dartText = await getDartDisclosures(ticker);

      const prompt         = buildStockPrompt(snapshotData, smaData, ticker, name, dartText);
      const interpretation = await callClaude(prompt, true);

      await saveCache({ cacheKey, tabType: 'stock', ticker, market: 'KOREA', interpretation });
      console.log(`    ✅ 완료`);
    } catch(err) {
      console.error(`    ❌ 실패: ${err.message}`);
    }

    // API 과부하 방지 (rate limit 방지용 30초 대기)
    await new Promise(r => setTimeout(r, 30000));
  }

  // 만료 캐시 삭제
  try {
    await sbFetch(`jarvis_cache?expires_at=lt.${new Date().toISOString()}`, {
      method: 'DELETE',
    });
    console.log('🗑 만료 캐시 삭제 완료');
  } catch(e) {
    console.warn('만료 캐시 삭제 실패:', e.message);
  }

  console.log('\n🎉 J.A.R.V.I.S. INSIGHT 생성 완료\n');
}

main();
