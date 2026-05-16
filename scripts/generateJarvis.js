/**
 * generateJarvis.js
 * GitHub Actions에서 매일 새벽 실행
 * SEFCON / 시장 탭 자비스 해석을 미리 생성해 jarvis_cache에 저장
 *
 * 실행: node scripts/generateJarvis.js
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;

console.log('SUPABASE_URL:', SUPABASE_URL);
console.log('SUPABASE_SERVICE_KEY 앞 10자:', SUPABASE_SERVICE_KEY?.slice(0, 10));
console.log('ANTHROPIC_API_KEY 앞 10자:', ANTHROPIC_API_KEY?.slice(0, 10));

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
  console.error('❌ 환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY 확인');
  process.exit(1);
}

// ─────────────────────────────────────────────
//  Supabase fetch 헬퍼
// ─────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const fullUrl = `${SUPABASE_URL}/rest/v1/${path}`;
  const { headers: extraHeaders, ...restOpts } = opts;
  const res = await fetch(fullUrl, {
    ...restOpts,
    headers: {
      apikey:         SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─────────────────────────────────────────────
//  Claude API 호출
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
      max_tokens: 1000,
      system:     JARVIS_SYSTEM,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ─────────────────────────────────────────────
//  패턴 매칭 관련 유틸
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
};

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
    let value = kiNum(ki, key);
    if (value === null) {
      const v = parseFloat(row[key]);
      value = isNaN(v) ? null : v;
    }
    return { value, weight };
  });
}

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
  return Math.round((1 - Math.min(dist, 0.8) / 0.8) * 100);
}

function daysBetween(dateA, dateB) {
  return Math.round(Math.abs(new Date(dateB) - new Date(dateA)) / (1000 * 60 * 60 * 24));
}

function computeForwardReturn(rows, targetDate, horizonMonths) {
  const sorted = [...rows].sort((a, b) =>
    (a.snapshot_date || '').localeCompare(b.snapshot_date || '')
  );
  const idx = sorted.findIndex(r => r.snapshot_date === targetDate);
  if (idx < 0) return null;
  let ki = sorted[idx].key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
  const baseKospi = kiNum(ki, 'kospi_last');
  if (!baseKospi || baseKospi === 0) return null;
  const futureIdx = idx + horizonMonths;
  if (futureIdx >= sorted.length) return null;
  let futureKi = sorted[futureIdx].key_indicators || {};
  if (typeof futureKi === 'string') { try { futureKi = JSON.parse(futureKi); } catch(e) { futureKi = {}; } }
  const futureKospi = kiNum(futureKi, 'kospi_last');
  if (!futureKospi || futureKospi === 0) return null;
  return ((futureKospi - baseKospi) / baseKospi) * 100;
}

// ─────────────────────────────────────────────
//  패턴 매칭 실행
// ─────────────────────────────────────────────
async function runMatch(region = 'KOREA') {
  const allRows = await sbFetch(
    `core_intelligence_snapshots?select=*&market=eq.${region}&order=snapshot_date.asc&limit=2000`
  );
  if (!allRows || allRows.length < 10) throw new Error(`데이터 부족: ${region}`);

  const todayRow = [...allRows].sort((a, b) =>
    b.snapshot_date.localeCompare(a.snapshot_date)
  )[0];
  const todayDate = todayRow.snapshot_date;
  const spec = MATCH_SPEC[region] || MATCH_SPEC.KOREA;

  const historyRows = allRows.filter(r => daysBetween(r.snapshot_date, todayDate) > 27);
  const { mins, maxs } = computeNormRanges(allRows, spec);
  const todayVec = extractVec(todayRow, spec);

  const scored = historyRows.map(row => ({
    row,
    dist: weightedEuclidean(todayVec, extractVec(row, spec), mins, maxs),
  }));
  scored.sort((a, b) => a.dist - b.dist);

  const matches = scored.slice(0, 5).map(({ row, dist }) => {
    const rowDate = row.snapshot_date;
    return {
      date:         rowDate,
      similarity:   distToSimilarity(dist),
      sefcon_score: row.sefcon_score,
      sefcon_level: row.sefcon_level,
      fwd_3m:       computeForwardReturn(allRows, rowDate, 3),
      fwd_6m:       computeForwardReturn(allRows, rowDate, 6),
      fwd_12m:      computeForwardReturn(allRows, rowDate, 12),
    };
  });

  const validFwd3m   = matches.filter(m => m.fwd_3m !== null);
  const avgFwd3m     = validFwd3m.length
    ? validFwd3m.reduce((s, m) => s + m.fwd_3m, 0) / validFwd3m.length : null;
  const bullishCount = matches.filter(m => m.fwd_3m > 5).length;
  const bearishCount = matches.filter(m => m.fwd_3m < -5).length;
  const topN         = 5;

  let ki = todayRow.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
  const getKi = (key) => {
    const v = ki[key];
    if (!v) return '—';
    if (typeof v === 'object') return v.value ?? '—';
    return v;
  };

  return {
    todayDate,
    todayScore:  todayRow.sefcon_score,
    todayRegime: todayRow.regime_label || '—',
    matches,
    summary: {
      avgFwd3m:        avgFwd3m !== null ? +avgFwd3m.toFixed(2) : null,
      upProb:          Math.round(bullishCount / topN * 100),
      downProb:        Math.round(bearishCount / topN * 100),
      flatProb:        Math.round((topN - bullishCount - bearishCount) / topN * 100),
      bullishCount,    bearishCount,
      totalHistoryRows: historyRows.length,
    },
    getKi,
  };
}

// ─────────────────────────────────────────────
//  프롬프트 생성
// ─────────────────────────────────────────────
function buildPrompt(tabType, { todayDate, todayScore, todayRegime, matches, summary, getKi }) {
  const similarText = matches.map(m =>
    `- ${m.date}: 유사도 ${m.similarity}%, SEFCON ${m.sefcon_score}, ` +
    `3개월 후 ${m.fwd_3m !== null ? (m.fwd_3m > 0 ? '+' : '') + m.fwd_3m.toFixed(2) + '%' : '데이터없음'}, ` +
    `6개월 후 ${m.fwd_6m !== null ? (m.fwd_6m > 0 ? '+' : '') + m.fwd_6m.toFixed(2) + '%' : '데이터없음'}`
  ).join('\n');

  const base = `
[현재 거시 지표 - ${todayDate}]
SEFCON: ${todayScore} / ${todayRegime}
VIX: ${getKi('fred_vix')} | 장단기금리차: ${getKi('fred_t10y2y')}
유동성압력: ${getKi('liquidity_pressure')} | 신용스트레스: ${getKi('credit_stress')}
KRW/USD: ${getKi('krw_usd')} | 코스피: ${getKi('kospi_last')}
한국금리: ${getKi('kr_rate')}% | DXY: ${getKi('dxy')}
LEI: ${getKi('fred_lei')} | SLOOS: ${getKi('fred_sloos')}

[역사적 유사 국면 TOP5 - 26년치 ${summary.totalHistoryRows}개 중]
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
④ 3개월 시나리오 (낙관/중립/비관 각 1문장)
⑤ 지금 가장 주목할 핵심 변수 1개
전체 600자 이내`;
  }

  if (tabType === 'market') {
    return base + `

[지시사항 - 시장 탭]
① 현재 코스피/코스닥 방향성을 거시 국면과 연결해서 해석 (2문장)
② 역사적으로 비슷한 국면에서 지수가 어떻게 움직였는지 구체적으로
③ 외국인/기관 수급 흐름이 지수에 미치는 영향
④ 3개월 지수 방향 시나리오 (낙관/중립/비관)
⑤ 지금 시장에서 가장 중요한 변수 1개
전체 500자 이내`;
  }

  return base;
}

// ─────────────────────────────────────────────
//  캐시 저장
// ─────────────────────────────────────────────
async function saveCache({ cacheKey, tabType, market, interpretation, similarPeriods }) {
  const expiresAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // 25시간

  await sbFetch('jarvis_cache', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      cache_key:       cacheKey,
      tab_type:        tabType,
      ticker:          null,
      market:          market,
      interpretation:  interpretation,
      similar_periods: similarPeriods,
      expires_at:      expiresAt,
    }),
  });
}

// ─────────────────────────────────────────────
//  메인 실행
// ─────────────────────────────────────────────
async function main() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log(`\n🤖 자비스 생성 시작 — ${today}\n`);

  const tabs = ['sefcon', 'market'];

  for (const tabType of tabs) {
    const cacheKey = `${tabType}_KOREA_${today}`;
    console.log(`▶ ${tabType} 처리 중...`);

    try {
      const matchData = await runMatch('KOREA');
      const prompt    = buildPrompt(tabType, matchData);
      const interpretation = await callClaude(prompt);

      await saveCache({
        cacheKey,
        tabType,
        market:        'KOREA',
        interpretation,
        similarPeriods: matchData.matches,
      });

      console.log(`✅ ${tabType} 완료 — 캐시 키: ${cacheKey}`);
    } catch (err) {
      console.error(`❌ ${tabType} 실패:`, err.message);
      process.exit(1);
    }
  }

  console.log('\n🎉 자비스 생성 완료\n');
}

main();
