export default function SearchBox({
  theme,
  value,
  onChange,
  onSubmit,
  onSelect,
  suggestions,
  loading,
}) {
  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${theme.surface2}, ${theme.surface})`,
        border: `1px solid ${theme.border}`,
        borderRadius: 20,
        padding: 16,
        boxShadow: theme.shadow,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmit();
            }}
            placeholder="종목명 또는 종목코드 입력"
            style={{
              width: '100%',
              background: theme.bg,
              color: theme.text,
              border: `1px solid ${theme.border}`,
              outline: 'none',
              borderRadius: 16,
              padding: '15px 16px 15px 52px',
              fontSize: 18,
              fontWeight: 700,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ position: 'absolute', left: 18, top: 13, fontSize: 24 }}>🔎</div>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          style={{
            minWidth: 88,
            border: 'none',
            borderRadius: 16,
            background: `linear-gradient(135deg, ${theme.blueLight}, ${theme.blue})`,
            color: '#fff',
            fontWeight: 900,
            fontSize: 17,
            cursor: 'pointer',
            padding: '0 18px',
          }}
        >
          {loading ? '로딩' : '조회'}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {suggestions.map((item) => (
            <button
              key={`${item.stock_code}-${item.corp_code}`}
              type="button"
              onClick={() => onSelect(item)}
              style={{
                width: '100%',
                textAlign: 'left',
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                borderRadius: 14,
                padding: '12px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ color: theme.text, fontWeight: 800, fontSize: 15 }}>{item.corp_name}</div>
                <div style={{ color: theme.muted, fontSize: 12 }}>{item.stock_code} · {item.corp_code}</div>
              </div>
              <div style={{ color: theme.blueLight, fontWeight: 800, fontSize: 12 }}>{item.market || 'KOREA'}</div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
