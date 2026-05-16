/**
 * JarvisComment.jsx v4
 * J.A.R.V.I.S. INSIGHT
 * 한 줄 요약 → 클릭 시 전체 펼침
 * 소형 SVG 아이콘 인라인 포함
 */

import { useState, useEffect } from 'react';
import { jarvisInterpret } from '../../services/jarvis';

function extractSummary(text) {
  if (!text) return '';
  const first = text.split(/[.!?。]\s/)[0];
  return first.length > 80 ? first.slice(0, 80) + '…' : first + '.';
}

const JarvisIcon = ({ color }) => (
  <svg width="20" height="20" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
    <circle cx="18" cy="18" r="16" stroke={color} strokeWidth="1.5" opacity="0.9"/>
    <circle cx="18" cy="18" r="12" stroke={color} strokeWidth="0.6" opacity="0.3"/>
    <path d="M 4 11 A 16 16 0 0 0 11 32" stroke="#ffaa00" strokeWidth="1.5" fill="none" opacity="0.85"/>
    <circle cx="10" cy="3.5" r="1.6" fill="#ffaa00" opacity="0.9"/>
    <circle cx="15" cy="2.3" r="1.6" fill="#ffaa00" opacity="0.9"/>
    <circle cx="20" cy="2" r="1.6" fill="#ffaa00" opacity="0.9"/>
    <circle cx="25" cy="2.3" r="1.6" fill="#ffaa00" opacity="0.9"/>
    <line x1="28" y1="7" x2="31" y2="10" stroke={color} strokeWidth="1.2" opacity="0.6"/>
    <line x1="32" y1="15" x2="35" y2="17" stroke={color} strokeWidth="1.2" opacity="0.6"/>
    <text x="18" y="20" textAnchor="middle" fontFamily="monospace" fontWeight="900" fontSize="5" fill={color} letterSpacing="0.3">J.A.R.V.I.S.</text>
    <text x="18" y="26" textAnchor="middle" fontFamily="monospace" fontSize="3" fill={color} letterSpacing="1.5" opacity="0.7">INSIGHT</text>
  </svg>
);

export default function JarvisComment({ C, tabType, ticker = null, region = 'KOREA' }) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [expanded, setExpanded]   = useState(false);
  const [triggered, setTriggered] = useState(false);

  // SEFCON 탭: 마운트 즉시 로드 (캐시에서 즉시 반환)
  // 주가 탭: 패널 클릭 시 로드
  const isSefcon = tabType === 'sefcon';

  useEffect(() => {
    if (!isSefcon) return;
    setLoading(true);
    setError(null);
    jarvisInterpret({ tabType, region, ticker })
      .then(res => { setData(res); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [tabType, region]);

  // 주가 탭: 패널 클릭 시 최초 1회 로드
  useEffect(() => {
    if (isSefcon || !triggered || data || loading) return;
    setLoading(true);
    setError(null);
    jarvisInterpret({ tabType, region, ticker })
      .then(res => { setData(res); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [triggered]);

  // ticker 변경 시 초기화
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

  const iconColor = C.gold || '#ffaa00';
  const labelColor = C.gold || '#ffaa00';

  const wrap = {
    margin: '10px 0',
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.card2 || C.card,
    overflow: 'hidden',
  };

  const row = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    cursor: 'pointer',
    userSelect: 'none',
  };

  const labelStyle = {
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.12em',
    color: labelColor,
    fontFamily: 'monospace',
    flexShrink: 0,
  };

  const summaryStyle = {
    fontSize: 12,
    color: C.text,
    opacity: 0.8,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const chevronStyle = {
    fontSize: 9,
    color: C.muted,
    opacity: 0.45,
    flexShrink: 0,
    transition: 'transform 0.2s',
    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
  };

  const body = {
    padding: '0 12px 11px',
    borderTop: `1px solid ${C.border}`,
  };

  const textStyle = {
    fontSize: 12,
    lineHeight: 1.72,
    color: C.text,
    whiteSpace: 'pre-wrap',
    wordBreak: 'keep-all',
    paddingTop: 9,
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
        <JarvisIcon color={iconColor} />
        <span style={labelStyle}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, opacity: 0.35 }}>분석 중...</span>
      </>
    );
    if (error) return (
      <>
        <JarvisIcon color={C.red} />
        <span style={{ ...labelStyle, color: C.red }}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, color: C.red, opacity: 0.6 }}>연결 오류</span>
      </>
    );
    if (!isSefcon && !triggered) return (
      <>
        <JarvisIcon color={iconColor} />
        <span style={labelStyle}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, opacity: 0.4 }}>클릭하여 분석 시작</span>
        <span style={chevronStyle}>▼</span>
      </>
    );
    if (!data) return (
      <>
        <JarvisIcon color={iconColor} />
        <span style={labelStyle}>J.A.R.V.I.S. INSIGHT</span>
        <span style={{ ...summaryStyle, opacity: 0.35 }}>준비 중...</span>
      </>
    );
    return (
      <>
        <JarvisIcon color={iconColor} />
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
