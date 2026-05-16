/**
 * JarvisComment.jsx v6
 * J.A.R.V.I.S. INSIGHT
 * 두툼한 링 + 발광 코어 아이콘 + 로딩 회전 애니메이션
 * 한 줄 요약 → 클릭 시 전체 펼침
 */

import { useState, useEffect } from 'react';
import { jarvisInterpret } from '../../services/jarvis';

const SPIN_STYLE = `
@keyframes jarvis-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;

function extractSummary(text) {
  if (!text) return '';
  const first = text.split(/[.!?。]\s/)[0];
  return first.length > 80 ? first.slice(0, 80) + '…' : first + '.';
}

const JarvisIcon = ({ dark, spinning = false }) => {
  const ring = dark ? '#00d4ff' : '#0077aa';
  const dot  = dark ? '#ffaa00' : '#cc6600';
  return (
    <>
      {spinning && <style>{SPIN_STYLE}</style>}
      <svg
        width="22" height="22" viewBox="0 0 36 36" fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          flexShrink: 0,
          filter: dark ? 'drop-shadow(0 0 3px #00d4ff88)' : 'none',
          animation: spinning ? 'jarvis-spin 1.5s linear infinite' : 'none',
          transformOrigin: 'center',
        }}
      >
      {/* 외부 링 두툼 */}
      <circle cx="18" cy="18" r="16" stroke={ring} strokeWidth="3" opacity="0.95"/>
      {/* 중간 링 */}
      <circle cx="18" cy="18" r="11.5" stroke={ring} strokeWidth="1" opacity="0.35"/>
      {/* 발광 코어 */}
      {dark && <circle cx="18" cy="18" r="6" fill={ring} opacity="0.12"/>}
      {dark && <circle cx="18" cy="18" r="3.5" fill={ring} opacity="0.3"/>}
      <circle cx="18" cy="18" r="2" fill={ring} opacity={dark ? 0.95 : 0.7}/>
      {/* 오렌지 아크 */}
      <path d="M 4 11 A 16 16 0 0 0 11 32" stroke={dot} strokeWidth="3" fill="none" opacity="0.9"/>
      {/* 오렌지 도트 3개 */}
      <circle cx="11" cy="3" r="2.2" fill={dot} opacity="0.95"/>
      <circle cx="18" cy="2" r="2.2" fill={dot} opacity="0.95"/>
      <circle cx="25" cy="3" r="2.2" fill={dot} opacity="0.95"/>
      {/* 갭 */}
      <line x1="29" y1="8" x2="33" y2="12" stroke={ring} strokeWidth="2.5" opacity="0.65"/>
    </svg>
    </>
  );
  );
};

export default function JarvisComment({ C, tabType, ticker = null, name = null, region = 'KOREA' }) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [expanded, setExpanded]   = useState(false);
  const [triggered, setTriggered] = useState(false);

  const isSefcon = tabType === 'sefcon';
  const isDark   = C.bg === '#040710';
  const labelColor = isDark ? '#00d4ff' : '#0077aa';

  useEffect(() => {
    if (!isSefcon) return;
    setLoading(true);
    setError(null);
    jarvisInterpret({ tabType, region, ticker, name })
      .then(res => { setData(res); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [tabType, region]);

  useEffect(() => {
    if (isSefcon || !triggered || data || loading) return;
    setLoading(true);
    setError(null);
    jarvisInterpret({ tabType, region, ticker, name })
      .then(res => { setData(res); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [triggered]);

  useEffect(() => {
    if (isSefcon) return;
    setData(null);
    setError(null);
    setExpanded(false);
    setTriggered(false);
    setLoading(false);
  }, [ticker]);

  const handleClick = () => {
    if (!isSefcon && !triggered) setTriggered(true);
    setExpanded(v => !v);
  };

  const wrap = {
    margin: '10px 0',
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.card2 || C.card,
  };

  const row = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    cursor: 'pointer',
    userSelect: 'none',
    minHeight: 38,
  };

  const labelStyle = {
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.12em',
    color: labelColor,
    fontFamily: 'monospace',
    flexShrink: 0,
    lineHeight: '22px',
    display: 'inline-block',
    verticalAlign: 'middle',
  };

  const summaryStyle = {
    fontSize: 12,
    color: C.text,
    opacity: 0.8,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: '22px',
    verticalAlign: 'middle',
  };

  const chevronStyle = {
    fontSize: 9,
    color: C.muted,
    opacity: 0.45,
    flexShrink: 0,
    transition: 'transform 0.2s',
    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
    lineHeight: '22px',
  };

  const body = {
    padding: '0 12px 12px',
    borderTop: `1px solid ${C.border}`,
  };

  const textStyle = {
    fontSize: 12,
    lineHeight: 1.75,
    color: C.text,
    whiteSpace: 'pre-wrap',
    wordBreak: 'keep-all',
    paddingTop: 10,
  };

  const foot = {
    marginTop: 8,
    fontSize: 9,
    color: C.muted,
    opacity: 0.3,
    fontFamily: 'monospace',
  };

  const summaryText = data ? extractSummary(data.interpretation) : '';

  const rowContent = () => {
    if (loading) return (
      <>
        <JarvisIcon dark={isDark} spinning={true}/>
        <span style={labelStyle}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, opacity: 0.35 }}>분석 중...</span>
      </>
    );
    if (error) return (
      <>
        <JarvisIcon dark={isDark}/>
        <span style={{ ...labelStyle, color: C.red }}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, color: C.red, opacity: 0.6 }}>연결 오류</span>
      </>
    );
    if (!isSefcon && !triggered) return (
      <>
        <JarvisIcon dark={isDark}/>
        <span style={labelStyle}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, opacity: 0.4 }}>클릭하여 분석 시작</span>
        <span style={chevronStyle}>▼</span>
      </>
    );
    if (!data) return (
      <>
        <JarvisIcon dark={isDark}/>
        <span style={labelStyle}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, opacity: 0.35 }}>준비 중...</span>
      </>
    );
    return (
      <>
        <JarvisIcon dark={isDark}/>
        <span style={labelStyle}>J.A.R.V.I.S. INSIGHT</span>
        <span style={summaryStyle}>{summaryText}</span>
        <span style={chevronStyle}>▼</span>
      </>
    );
  };

  return (
    <div style={wrap}>
      <div style={row} onClick={handleClick}>
        {rowContent()}
      </div>

      {expanded && data && (
        <div style={body}>
          <div style={textStyle}>{data.interpretation}</div>
          <div style={foot}>
            {data.from_cache ? '캐시 · ' : ''}{new Date().toLocaleDateString('ko-KR')} 기준
          </div>
        </div>
      )}

      {expanded && error && (
        <div style={body}>
          <div style={{ ...textStyle, color: C.red, opacity: 0.7 }}>{error}</div>
        </div>
      )}
    </div>
  );
}
