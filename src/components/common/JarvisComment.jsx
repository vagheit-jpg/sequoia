/**
 * JarvisComment.jsx
 * 각 탭 하단에 삽입되는 J.A.R.V.I.S. 해석 박스
 * 심플 텍스트 스타일 — 아이콘 없음
 */

import { useState, useEffect } from 'react';
import { jarvisInterpret } from '../services/jarvis';

export default function JarvisComment({ C, tabType, ticker = null, region = 'KOREA' }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    jarvisInterpret({ tabType, region, ticker })
      .then(res => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(e  => { if (!cancelled) { setError(e.message); setLoading(false); } });

    return () => { cancelled = true; };
  }, [tabType, ticker, region]);

  const box = {
    marginTop: 32,
    borderTop: `1px solid ${C.border}`,
    paddingTop: 20,
  };

  const header = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  };

  const title = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: C.muted,
    fontFamily: 'monospace',
  };

  const dateLabel = {
    fontSize: 10,
    color: C.muted,
    opacity: 0.6,
    fontFamily: 'monospace',
    marginLeft: 10,
  };

  const toggleBtn = {
    background: 'none',
    border: 'none',
    color: C.muted,
    cursor: 'pointer',
    fontSize: 11,
    padding: '2px 6px',
    opacity: 0.6,
  };

  const interpretText = {
    fontSize: 13,
    lineHeight: 1.85,
    color: C.text,
    whiteSpace: 'pre-wrap',
    wordBreak: 'keep-all',
  };

  const scenarioBar = {
    display: 'flex',
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    gap: 2,
    marginTop: 16,
    marginBottom: 6,
  };

  const probLabel = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    color: C.muted,
    marginBottom: 10,
  };

  const similarRow = {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 12,
  };

  const chip = (ret) => ({
    padding: '2px 8px',
    borderRadius: 10,
    background: C.card2 || C.card,
    border: `1px solid ${C.border}`,
    fontSize: 10,
    color: ret > 0 ? C.green : ret < 0 ? C.red : C.muted,
    fontFamily: 'monospace',
  });

  const footer = {
    marginTop: 14,
    fontSize: 10,
    color: C.muted,
    opacity: 0.4,
    fontFamily: 'monospace',
  };

  // 로딩
  if (loading) return (
    <div style={box}>
      <div style={header}>
        <div>
          <span style={title}>J.A.R.V.I.S.</span>
        </div>
      </div>
      <div style={{ color: C.muted, fontSize: 12, opacity: 0.6 }}>
        26년치 데이터 분석 중...
      </div>
    </div>
  );

  // 에러
  if (error) return (
    <div style={box}>
      <div style={{ ...title, color: C.red }}>J.A.R.V.I.S. — 연결 오류</div>
      <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>{error}</div>
    </div>
  );

  if (!data) return null;

  const { interpretation, similar_periods, summary, todayDate, from_cache } = data;

  return (
    <div style={box}>
      {/* 헤더 */}
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={title}>J.A.R.V.I.S.</span>
          <span style={dateLabel}>
            {todayDate?.slice(0, 7)} 기준{from_cache ? ' · 캐시' : ''}
          </span>
        </div>
        <button style={toggleBtn} onClick={() => setExpanded(v => !v)}>
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <>
          {/* 시나리오 확률 바 */}
          {summary && (
            <>
              <div style={scenarioBar}>
                <div style={{
                  width: `${summary.upProb}%`,
                  background: C.green,
                  borderRadius: '3px 0 0 3px',
                  transition: 'width 0.6s ease',
                }} />
                <div style={{
                  width: `${summary.flatProb}%`,
                  background: C.muted,
                  opacity: 0.4,
                }} />
                <div style={{
                  width: `${summary.downProb}%`,
                  background: C.red,
                  borderRadius: '0 3px 3px 0',
                  transition: 'width 0.6s ease',
                }} />
              </div>
              <div style={probLabel}>
                <span style={{ color: C.green }}>↑ {summary.upProb}%</span>
                <span>
                  유사 국면 평균 3개월{' '}
                  <span style={{ color: summary.avgFwd3m > 0 ? C.green : C.red, fontFamily: 'monospace' }}>
                    {summary.avgFwd3m > 0 ? '+' : ''}{summary.avgFwd3m}%
                  </span>
                </span>
                <span style={{ color: C.red }}>↓ {summary.downProb}%</span>
              </div>
            </>
          )}

          {/* 자비스 해석 텍스트 */}
          <div style={interpretText}>{interpretation}</div>

          {/* 유사 국면 칩 */}
          {similar_periods && similar_periods.length > 0 && (
            <div style={similarRow}>
              {similar_periods.slice(0, 4).map((p, i) => (
                <div key={i} style={chip(p.fwd_3m)}>
                  {p.date?.slice(0, 7)}
                  {p.fwd_3m !== null && (
                    <span> {p.fwd_3m > 0 ? '+' : ''}{p.fwd_3m}%</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 푸터 */}
          <div style={footer}>
            26년 · {summary?.totalHistoryRows || 316}개 국면 분석
          </div>
        </>
      )}
    </div>
  );
}
