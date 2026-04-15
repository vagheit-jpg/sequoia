import { formatPercent } from '../lib/format.js';

export default function GapCard({ theme, gap, label }) {
  const accent = gap <= -20 ? theme.green : gap >= 100 ? theme.red : theme.orange;

  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${theme.surface2}, ${theme.surface})`,
        border: `1px solid ${theme.border}`,
        borderRadius: 18,
        padding: 16,
        boxShadow: theme.shadow,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 14,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <div>
        <div style={{ color: theme.muted, fontSize: 12, marginBottom: 6 }}>GAP60 SIGNAL</div>
        <div style={{ color: accent, fontSize: 30, fontWeight: 900 }}>{formatPercent(gap, 1)}</div>
      </div>
      <div style={{ maxWidth: 360 }}>
        <div style={{ color: theme.text, fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{label}</div>
        <div style={{ color: theme.muted, fontSize: 13, lineHeight: 1.5 }}>
          60개월선 기준 장기 위치를 보여주는 핵심 신호입니다. Lite에서는 차트와 바로 연결되는 해석 카드로 유지합니다.
        </div>
      </div>
    </section>
  );
}
