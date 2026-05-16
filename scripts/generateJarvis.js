/**
 * generateJarvis.js
 * GitHub Actions에서 매일 새벽 실행
 * SEFCON 수치 + 웹서치 기반 자비스 해석 생성 → jarvis_cache 저장
 *
 * 실행: node scripts/generateJarvis.js
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
  console.error('❌ 환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY 확인');
  process.exit(1);
}

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

async function getLatestSnapshot() {
  const rows = await sbFetch(
    `core_intelligence_snapshots?select=snapshot_date,sefcon_score,sefcon_level,key_indicators&market=eq.KOREA&key_indicators=not.is.null&order=snapshot_date.desc&limit=1`
  );
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    throw new Error('유효한 SEFCON 스냅샷 없음');
  }
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
- 전체 600자 이내, 반드시 완성된 문장으로 마무리

원칙:
- 특정 종목 매수/매도 추천 절대 금지
- 근거없는 확신 금지
- 어려운 금융 용어 남발 금지
- 항상 리스크도 함께 언급`;

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1500,
      system:     JARVIS_SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return text;
}

function buildPrompt({ row, getKi, snapshotDate }) {
  const sefcon    = getKi('sefcon_score') ?? row.sefcon_score ?? '—';
  const level     = getKi('sefcon_level') ?? row.sefcon_level ?? '—';
  const vix       = getKi('fred_vix') ?? '—';
  const t10y2y    = getKi('fred_t10y2y') ?? '—';
  const krwusd    = getKi('krw_usd') ?? '—';
  const kospi     = getKi('kospi_last') ?? '—';
  const kosdaq    = getKi('kosdaq_last') ?? '—';
  const krRate    = getKi('kr_rate') ?? '—';
  const dxy       = getKi('dxy') ?? '—';
  const liq       = getKi('liquidity_pressure') ?? '—';
  const credit    = getKi('credit_stress') ?? '—';
  const sloos     = getKi('fred_sloos') ?? '—';
  const catFear   = getKi('cat_fear') ?? '—';
  const catCredit = getKi('cat_credit') ?? '—';
  const catReal   = getKi('cat_real') ?? '—';
  const catLiq    = getKi('cat_liquidity') ?? '—';
  const catInfl   = getKi('cat_inflation') ?? '—';
  const foreignNet= getKi('foreign_net') ?? '—';

  return `아래는 오늘(${snapshotDate}) 기준 세콰이어 SEFCON 데이터입니다.

[SEFCON 종합]
점수: ${sefcon}/100 / 레벨: ${level}단계 위기
(100에 가까울수록 안정, 0에 가까울수록 위기)

[카테고리별 위험도] (높을수록 위험)
신용위험: ${catCredit} / 시장공포: ${catFear} / 실물경기: ${catReal} / 유동성: ${catLiq} / 물가: ${catInfl}

[주요 지표]
코스피: ${kospi} (역사적 고점 수준) / 코스닥: ${kosdaq}
환율: ${krwusd}원 / 금리차(10Y-2Y): ${t10y2y}
VIX: ${vix} / DXY: ${dxy} / 한국금리: ${krRate}%
유동성압력: ${liq} / 신용스트레스: ${credit} / SLOOS: ${sloos}
외국인 순매수: ${foreignNet}

웹서치를 통해 최신 연준(Fed) 동향, 한국은행 동향, 한국 증시 수급 관련 최신 뉴스를 검색하세요.
검색 시 Korea Herald, Korea Times, Bloomberg, Reuters 등 영문 소스를 우선 활용하세요.

위 SEFCON 데이터와 최신 뉴스를 종합해서 다음을 해석해주세요:
① 지금 거시 국면 — SEFCON 수치들이 말하는 것 (2-3문장)
② 카테고리 간 관계 — 가장 주목할 조합과 그 의미
③ 최신 연준/한은 동향이 현재 지표에 미치는 영향
④ 지금 가장 중요한 변수 1개와 그 이유
⑤ 3개월 시나리오 — 낙관/중립/비관 각 1문장

마크다운 기호 절대 사용 금지. 600자 이내로 자연스럽게 작성하고 반드시 완성된 문장으로 마무리하세요.`;
}

async function saveCache({ cacheKey, interpretation }) {
  const expiresAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  await sbFetch('jarvis_cache?on_conflict=cache_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      cache_key:       cacheKey,
      tab_type:        'sefcon',
      ticker:          null,
      market:          'KOREA',
      interpretation:  interpretation,
      similar_periods: [],
      expires_at:      expiresAt,
    }),
  });
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n🤖 J.A.R.V.I.S. INSIGHT 생성 시작 — ${today}\n`);

  let snapshotData;
  try {
    snapshotData = await getLatestSnapshot();
    console.log(`✅ 스냅샷 로드 완료 — ${snapshotData.snapshotDate}`);
  } catch (err) {
    console.error('❌ 스냅샷 로드 실패:', err.message);
    process.exit(1);
  }

  const cacheKey = `sefcon_KOREA_${today}`;
  console.log(`▶ 자비스 해석 생성 중... (웹서치 포함)`);

  try {
    const prompt         = buildPrompt(snapshotData);
    const interpretation = await callClaude(prompt);
    await saveCache({ cacheKey, interpretation });
    console.log(`✅ 완료 — 캐시 키: ${cacheKey}`);
    console.log(`\n🎉 J.A.R.V.I.S. INSIGHT 생성 완료\n`);
  } catch (err) {
    console.error('❌ 생성 실패:', err.message);
    process.exit(1);
  }
}

main();
