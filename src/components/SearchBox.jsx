export default function SearchBox({ theme, value, onChange, suggestions }) {
  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${theme.surface2}, ${theme.surface})`,
        border: `1px solid ${theme.border}`,
        borderRadius: 18,
        padding: 16,
        boxShadow: theme.shadow,
      }}
    >
      <div style={{ color: theme.muted, fontSize: 12, marginBottom: 8, letterSpacing: '0.04em' }}>
        SEARCH
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="종목명 또는 종목코드 입력"
        style={{
          width: '100%',
          background: theme.bg,
          color: theme.text,
          border: `1px solid ${theme.border}`,
          outline: 'none',
          borderRadius: 14,
          padding: '14px 16px',
          fontSize: 15,
        }}
      />
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {suggestions.map((item) => (
          <div
            key={item.stockCode}
            style={{
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              borderRadius: 12,
              padding: '10px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>{item.name}</div>
              <div style={{ color: theme.muted, fontSize: 12 }}>{item.stockCode}</div>
            </div>
            <div style={{ color: theme.blueLight, fontWeight: 700, fontSize: 12 }}>{item.market}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
