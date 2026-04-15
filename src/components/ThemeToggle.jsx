export default function ThemeToggle({ mode, onToggle, theme }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        border: `1px solid ${theme.gold}88`,
        background: `${theme.surface}dd`,
        color: theme.goldLight,
        padding: '11px 16px',
        borderRadius: 999,
        cursor: 'pointer',
        fontWeight: 900,
        fontSize: 14,
        boxShadow: theme.shadow,
        minWidth: 110,
      }}
    >
      {mode === 'dark' ? '☀ 라이트' : '☾ 다크'}
    </button>
  );
}
