/**
 * JarvisTab.jsx — 자비스 AI 탭 UI
 * Props:
 *   C             (object) - 세콰이어 컬러 테마 (App.jsx의 C)
 *   todaySnapshot (object) - 오늘 core-snapshot 값 (선택; 없으면 DB 최신 사용)
 */

import { useState, useEffect, useCallback } from 'react';
import { SB_URL, SB_KEY } from '../constants/supabase';

// ─────────────────────────────────────────────
//  Supabase REST 직접 호출
// ─────────────────────────────────────────────
async function sbFetch(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`SB ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
//  패턴 매칭 로직 (jarvis.js 인라인)
// ─────────────────────────────────────────────
// top-level 컬럼 (sefcon_score만 직접, 나머지는 key_indicators 안에 있음)
const TOP_FIELDS = [
  { key: 'sefcon_score', weight: 3.0 },
];
// key_indicators JSON 안의 필드
const KI_FIELDS = [
  { key: 'liquidity_pressure', weight: 1.5 },
  { key: 'credit_stress',      weight: 1.5 },
  { key: 'valuation_gravity',  weight: 1.0 },
  { key: 'volatility_energy',  weight: 1.0 },
  { key: 'crisis_proximity',   weight: 1.2 },
  { key: 't10y2y',             weight: 1.2 },
  { key: 'baml',               weight: 1.0 },
  { key: 'vix',                weight: 0.8 },
  { key: 'dxy',                weight: 0.6 },
];

function extractVec(row) {
  // key_indicators는 객체 또는 JSON 문자열일 수 있음
  let ki = row.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
  // key_indicators 안의 값은 { value, ... } 객체이거나 숫자일 수 있음
  const kiVal = (k) => {
    const v = ki[k];
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return parseFloat(v.value ?? v.val ?? null);
    return parseFloat(v);
  };
  return [
    ...TOP_FIELDS.map(({ key, weight }) => ({
      value: parseFloat(row[key]) || null,
      weight,
    })),
    ...KI_FIELDS.map(({ key, weight }) => ({
      value: kiVal(key),
      weight,
    })),
  ];
}

function computeRanges(rows) {
  const dims = MATCH_FIELDS.length + KI_FIELDS.length;
  const mins = new Array(dims).fill(Infinity);
  const maxs = new Array(dims).fill(-Infinity);
  for (const row of rows) {
    extractVec(row).forEach(({ value }, i) => {
      if (value !== null) {
        if (value < mins[i]) mins[i] = value;
        if (value > maxs[i]) maxs[i] = value;
      }
    });
  }
  return { mins, maxs };
}

function wEuclidean(vecA, vecB, mins, maxs) {
  let sumSq = 0, totalW = 0, dims = 0;
  for (let i = 0; i < vecA.length; i++) {
    if (vecA[i].value === null || vecB[i].value === null) continue;
    const range = maxs[i] - mins[i];
    if (range === 0) continue;
    const na = (vecA[i].value - mins[i]) / range;
    const nb = (vecB[i].value - mins[i]) / range;
    sumSq += vecA[i].weight * (na - nb) ** 2;
    totalW += vecA[i].weight;
    dims++;
  }
  return dims === 0 ? 1 : Math.sqrt(sumSq / totalW);
}

function distToSim(d) {
  return Math.round((1 - Math.min(d, 0.8) / 0.8) * 100);
}

function getKospi(row) {
  // kospi_last는 key_indicators 안에 있음 ({ value: ... } 형태)
  let ki = row.key_indicators || {};
  if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
  const v = ki['kospi_last'];
  if (v === null || v === undefined) return null;
  const n = typeof v === 'object' ? parseFloat(v.value ?? v.val) : parseFloat(v);
  return isNaN(n) ? null : n;
}

function fwdReturn(sorted, date, n) {
  const idx = sorted.findIndex(r => r.snapshot_date === date);
  if (idx < 0 || idx + n >= sorted.length) return null;
  const base = getKospi(sorted[idx]);
  const fut  = getKospi(sorted[idx + n]);
  if (!base || !fut) return null;
  return +((fut - base) / base * 100).toFixed(2);
}

function runMatch(allRows, region, topN, fwdDays, overrideToday) {
  const sorted = [...allRows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const todayRow = overrideToday || sorted[sorted.length - 1];
  const todayDate = todayRow.snapshot_date;

  const history = sorted.filter(r => {
    const ms = Math.abs(new Date(r.snapshot_date) - new Date(todayDate));
    return ms / 86400000 > fwdDays + 5;
  });

  const { mins, maxs } = computeRanges(sorted);
  const todayVec = extractVec(todayRow);

  const scored = history.map(row => ({
    row,
    dist: wEuclidean(todayVec, extractVec(row), mins, maxs),
  })).sort((a, b) => a.dist - b.dist).slice(0, topN);

  const matches = scored.map(({ row, dist }) => {
    let ki = row.key_indicators || {};
    if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } }
    const kiStr = (k) => { const v = ki[k]; if (!v) return ''; return typeof v === 'object' ? (v.value ?? '') : String(v); };
    return {
      date:       row.snapshot_date,
      similarity: distToSim(dist),
      score:      row.sefcon_score,
      regime:     kiStr('regime_label') || row.regime_label || '',
      fwd5:       fwdReturn(sorted, row.snapshot_date, 5),
      fwd22:      fwdReturn(sorted, row.snapshot_date, fwdDays),
      fwd60:      fwdReturn(sorted, row.snapshot_date, fwdDays * 3),
    };
  });

  const valid = matches.filter(m => m.fwd22 !== null);
  const avg22 = valid.length ? valid.reduce((s, m) => s + m.fwd22, 0) / valid.length : null;
  const bulls = matches.filter(m => m.fwd22 > 2).length;
  const bears = matches.filter(m => m.fwd22 < -2).length;

  let signal = '🟡 혼조', sigColor = '#eab308';
  if (bulls >= Math.ceil(topN * 0.6)) { signal = '🟢 상승 우위'; sigColor = '#22c55e'; }
  if (bears >= Math.ceil(topN * 0.6)) { signal = '🔴 하락 우위'; sigColor = '#ef4444'; }

  return {
    todayDate, todayScore: todayRow.sefcon_score,
    todayRegime: (() => { let ki = todayRow.key_indicators || {}; if (typeof ki === 'string') { try { ki = JSON.parse(ki); } catch(e) { ki = {}; } } const v = ki['regime_label']; return (typeof v === 'object' ? v.value : v) || todayRow.regime_label || ''; })(),
    matches, avg22: avg22 !== null ? +avg22.toFixed(2) : null,
    signal, sigColor, bulls, bears, histCount: history.length,
  };
}

// ─────────────────────────────────────────────
//  색상 헬퍼
// ─────────────────────────────────────────────
const retColor = (v) => {
  if (v === null) return '#888';
  if (v > 5)  return '#22c55e';
  if (v > 2)  return '#86efac';
  if (v > 0)  return '#a3e635';
  if (v > -2) return '#fde68a';
  if (v > -5) return '#f97316';
  return '#ef4444';
};

const simColor = (s) => {
  if (s >= 85) return '#22c55e';
  if (s >= 70) return '#a3e635';
  if (s >= 55) return '#eab308';
  return '#888';
};

const scoreColor = (s) => {
  if (s >= 70) return '#ef4444';
  if (s >= 50) return '#f97316';
  if (s >= 30) return '#eab308';
  return '#22c55e';
};

// ─────────────────────────────────────────────
//  수익률 셀
// ─────────────────────────────────────────────
function RetCell({ v }) {
  const c = retColor(v);
  const arrow = v === null ? '—' : v > 0 ? `▲ +${v}%` : `▼ ${v}%`;
  return (
    <span style={{ color: c, fontWeight: 600, fontSize: 13 }}>{arrow}</span>
  );
}

// ─────────────────────────────────────────────
//  유사도 바
// ─────────────────────────────────────────────
function SimBar({ value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 80, height: 8, background: border, borderRadius: 4, overflow: 'hidden'
      }}>
        <div style={{
          width: `${value}%`, height: '100%',
          background: simColor(value),
          borderRadius: 4,
          transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{ color: simColor(value), fontWeight: 700, fontSize: 13 }}>{value}%</span>
    </div>
  );
}

// ─────────────────────────────────────────────
//  메인 컴포넌트
// ─────────────────────────────────────────────
export default function JarvisTab({
  C = null,
  todaySnapshot = null,
}) {
  const [region,   setRegion]   = useState('KOREA');
  const [topN,     setTopN]     = useState(5);
  const [fwdDays,  setFwdDays]  = useState(22);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [result,   setResult]   = useState(null);
  const [dbCount,  setDbCount]  = useState(null);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const rows = await sbFetch(
        `core_intelligence_snapshots?select=*&market=eq.${region}&order=snapshot_date.asc&limit=2000`
      );

      if (!rows || rows.length < 10) throw new Error(`데이터 부족: ${rows?.length || 0}건`);

      setDbCount(rows.length);
      const res = runMatch(rows, region, topN, fwdDays, todaySnapshot);
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [region, topN, fwdDays, todaySnapshot]);

  // 마운트 시 자동 실행
  useEffect(() => { runAnalysis(); }, []);

  // C 테마 fallback (세콰이어 DARK 기준)
  const bg      = C?.bg      || '#0d0d0d';
  const card    = C?.card    || '#1a1a2e';
  const border  = C?.border  || '#1e293b';
  const muted   = C?.muted   || '#64748b';
  const blue    = C?.blue    || '#7dd3fc';
  const text    = C?.text    || '#e2e8f0';

  // ── 렌더 ──
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      background: bg,
      color: text,
      minHeight: '100vh',
      padding: 24,
    }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 28 }}>🤖</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2, color: blue }}>
              J.A.R.V.I.S.
            </div>
            <div style={{ fontSize: 11, color: muted, letterSpacing: 1 }}>
              SEFCON PATTERN MATCHING ENGINE v1.0
            </div>
          </div>
          {dbCount && (
            <div style={{
              marginLeft: 'auto', fontSize: 11, color: muted,
              background: card, padding: '4px 10px', borderRadius: 6,
            }}>
              DB {dbCount.toLocaleString()}건 분석 중
            </div>
          )}
        </div>
      </div>

      {/* 컨트롤 패널 */}
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24,
        background: card, border: `1px solid ${border}`,
        borderRadius: 12, padding: '16px 20px', alignItems: 'center',
      }}>
        {/* 지역 선택 */}
        <div>
          <div style={{ fontSize: 10, color: muted, marginBottom: 6 }}>지역</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['KOREA', 'US', 'GLOBAL'].map(r => (
              <button key={r} onClick={() => setRegion(r)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                  background: region === r ? blue : border,
                  color:      region === r ? bg : muted,
                  transition: 'all 0.2s',
                }}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Top N */}
        <div>
          <div style={{ fontSize: 10, color: muted, marginBottom: 6 }}>유사 케이스</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[3, 5, 10].map(n => (
              <button key={n} onClick={() => setTopN(n)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                  background: topN === n ? '#a78bfa' : border,
                  color:      topN === n ? bg : muted,
                }}>
                Top {n}
              </button>
            ))}
          </div>
        </div>

        {/* Horizon */}
        <div>
          <div style={{ fontSize: 10, color: muted, marginBottom: 6 }}>미래 기준</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ label:'1개월', v:22 }, { label:'2개월', v:44 }, { label:'3개월', v:66 }].map(({ label, v }) => (
              <button key={v} onClick={() => setFwdDays(v)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                  background: fwdDays === v ? '#34d399' : border,
                  color:      fwdDays === v ? bg : muted,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 실행 */}
        <button onClick={runAnalysis} disabled={loading}
          style={{
            marginLeft: 'auto', padding: '8px 20px',
            background: loading ? '#1e293b' : '#7dd3fc',
            color: loading ? '#475569' : '#0d0d0d',
            border: 'none', borderRadius: 8, fontWeight: 800,
            fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', letterSpacing: 1,
          }}>
          {loading ? '⏳ 분석중...' : '▶ 분석 실행'}
        </button>
      </div>

      {/* 에러 */}
      {error && (
        <div style={{
          background: '#450a0a', border: '1px solid #7f1d1d',
          borderRadius: 8, padding: '12px 16px', color: '#fca5a5',
          fontSize: 13, marginBottom: 20,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: muted }}>
          <div style={{ fontSize: 36, marginBottom: 12, animation: 'spin 1s linear infinite' }}>⚙</div>
          <div style={{ fontSize: 14 }}>과거 {region} 패턴 분석 중...</div>
          <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* 결과 */}
      {result && !loading && (
        <>
          {/* 오늘 상태 카드 */}
          <div style={{
            background: card, border: `1px solid ${border}`,
            borderRadius: 12, padding: '20px 24px', marginBottom: 20,
            display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 10, color: muted, marginBottom: 4 }}>기준일</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: blue }}>
                {result.todayDate}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: muted, marginBottom: 4 }}>SEFCON 점수</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: scoreColor(result.todayScore) }}>
                {result.todayScore}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: muted, marginBottom: 4 }}>국면</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: text }}>
                {result.todayRegime || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: muted, marginBottom: 4 }}>비교 히스토리</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: muted }}>
                {result.histCount}건
              </div>
            </div>
          </div>

          {/* 합성 신호 */}
          <div style={{
            background: bg,
            border: `2px solid ${result.sigColor}40`,
            borderLeft: `4px solid ${result.sigColor}`,
            borderRadius: 12, padding: '18px 24px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 10, color: muted, marginBottom: 4 }}>합성 신호</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: result.sigColor }}>
                {result.signal}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: muted, marginBottom: 4 }}>
                과거 유사 국면 후 {fwdDays}일 평균 KOSPI
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: retColor(result.avg22) }}>
                {result.avg22 !== null
                  ? (result.avg22 > 0 ? `▲ +${result.avg22}%` : `▼ ${result.avg22}%`)
                  : '데이터 부족'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, marginLeft: 'auto' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: muted, marginBottom: 2 }}>상승</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>
                  {result.bulls}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: muted, marginBottom: 2 }}>하락</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>
                  {result.bears}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: muted, marginBottom: 2 }}>혼조</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#eab308' }}>
                  {topN - result.bulls - result.bears}
                </div>
              </div>
            </div>
          </div>

          {/* 매칭 케이스 테이블 */}
          <div style={{
            background: card, border: `1px solid ${border}`,
            borderRadius: 12, overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 20px',
              borderBottom: `1px solid ${border}`,
              fontSize: 12, fontWeight: 700, color: muted,
              letterSpacing: 1,
            }}>
              유사 패턴 Top {topN} — 과거 동일 국면 이후 KOSPI 결과
            </div>

            {/* 테이블 헤더 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr 80px 70px 80px 90px 90px 90px',
              padding: '10px 20px',
              fontSize: 10, color: muted,
              borderBottom: `1px solid ${border}`,
              letterSpacing: 0.5,
            }}>
              <div>#</div>
              <div>날짜</div>
              <div>유사도</div>
              <div>점수</div>
              <div>국면</div>
              <div style={{ textAlign: 'right' }}>5일 후</div>
              <div style={{ textAlign: 'right' }}>{fwdDays}일 후</div>
              <div style={{ textAlign: 'right' }}>{fwdDays * 3}일 후</div>
            </div>

            {/* 매칭 행 */}
            {result.matches.map((m, i) => (
              <div key={m.date} style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 80px 70px 80px 90px 90px 90px',
                padding: '14px 20px',
                borderBottom: `1px solid ${border}`,
                alignItems: 'center',
                background: i % 2 === 0 ? 'transparent' : `${bg}33`,
                transition: 'background 0.2s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = `${card}66`}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${bg}33`}
              >
                <div style={{ fontSize: 12, color: muted }}>{i + 1}</div>

                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: text }}>
                    {m.date}
                  </div>
                </div>

                <div><SimBar value={m.similarity} /></div>

                <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor(m.score) }}>
                  {m.score}
                </div>

                <div style={{ fontSize: 11, color: muted }}>
                  {m.regime?.replace(/[🔴🟠🟡🟢🔵⚡🌱🚀]/g, '').trim() || '—'}
                </div>

                <div style={{ textAlign: 'right' }}>
                  <RetCell v={m.fwd5} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <RetCell v={m.fwd22} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <RetCell v={m.fwd60} />
                </div>
              </div>
            ))}
          </div>

          {/* 하단 노트 */}
          <div style={{
            marginTop: 16, padding: '12px 16px',
            background: bg, borderRadius: 8,
            fontSize: 11, color: muted, lineHeight: 1.8,
          }}>
            ⚠️ 자비스는 과거 패턴 기반 참고 도구입니다. 투자 결정의 근거로 단독 사용하지 마십시오.
            <br />
            📐 유사도: 가중 유클리드 거리 (SEFCON·유동성압력·신용응력·밸류에이션중력·변동성에너지·위기근접도 + T10Y2Y·BAML·VIX·DXY)
          </div>
        </>
      )}
    </div>
  );
}
