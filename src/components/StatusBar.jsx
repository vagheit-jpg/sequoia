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

export default function StatusBar({ theme, status, error, source }) {
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Pill label="Price" value={status.price} ok={status.price === 'ready' || status.price === 'fallback'} theme={theme} />
        <Pill label="Yahoo" value={status.yahoo} ok={status.yahoo === 'ready'} theme={theme} />
        <Pill label="DART" value={status.dart} ok={status.dart === 'ready'} theme={theme} />
      </div>
      {(error || source) && (
        <div style={{ color: theme.muted, fontSize: 12 }}>
          {error ? error : ''}{error && source ? ' · ' : ''}{source ? `현재가 소스: ${source}` : ''}
        </div>
      )}
    </section>
  );
}
