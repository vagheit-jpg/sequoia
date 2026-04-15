import { formatPercent } from '../lib/format.js';

export default function GapCard({ theme, gap, label, message }) {
  const accent = gap <= -20 ? theme.green : gap >= 100 ? theme.red : theme.orange;
  const icon = gap <= -20 ? '🟢' : gap >= 100 ? '🔴' : '🟠';

  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${theme.surface2}, ${theme.surface})`,
        border: `1px solid ${accent}aa`,
        borderRadius: 20,
        padding: 18,
        boxShadow: theme.shadow,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 34 }}>{icon}</div>
        <div>
          <div style={{ color: accent, fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
            {label} 신호 — 60MA 이격도 {gap >= 100 ? '+100% 초과' : gap <= -20 ? '-20% 이하' : '중립 구간'}
          </div>
          <div style={{ color: theme.muted, fontSize: 13, lineHeight: 1.5 }}>{message}</div>
        </div>
      </div>
      <div
        style={{
          color: accent,
          fontSize: 22,
          fontWeight: 900,
          padding: '10px 14px',
          borderRadius: 14,
          background: `${accent}18`,
        }}
      >
        {formatPercent(gap, 2, true)}
      </div>
    </section>
  );
}
