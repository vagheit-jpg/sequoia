export default function ThemeToggle({ mode, onToggle, theme }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        border: `1px solid ${theme.border}`,
        background: theme.surface,
        color: theme.text,
        padding: '9px 12px',
        borderRadius: 12,
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: 13,
        boxShadow: theme.shadow,
      }}
    >
      {mode === 'dark' ? '라이트 모드' : '다크 모드'}
    </button>
  );
}
