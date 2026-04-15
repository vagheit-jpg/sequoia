function Pill({ label, value, ok, theme }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: `1px solid ${theme.border}`,
        background: theme.surface,
        borderRadius: 999,
        padding: '8px 12px',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: ok ? theme.green : theme.red,
          display: 'inline-block',
        }}
      />
      <span style={{ color: theme.muted, fontSize: 12 }}>{label}</span>
      <strong style={{ color: theme.text, fontSize: 12 }}>{value}</strong>
    </div>
  );
}

export default function StatusBar({ theme, status }) {
  return (
    <section style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <Pill label="Price" value={status.price} ok={status.price === 'ready'} theme={theme} />
      <Pill label="Yahoo" value={status.yahoo} ok={status.yahoo === 'ready'} theme={theme} />
      <Pill label="DART" value={status.dart} ok={status.dart === 'ready'} theme={theme} />
    </section>
  );
}
