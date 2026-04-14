
export default function Header({ theme, onToggleTheme }) {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-logo">S</div>
        <div>
          <div className="brand-title">SEQUOIA QUANTUM</div>
          <div className="brand-sub">Static Intelligence Viewer</div>
        </div>
      </div>
      <div className="action-row">
        <button className="pill-btn" onClick={onToggleTheme}>
          {theme === "dark" ? "라이트" : "다크"} 모드
        </button>
      </div>
    </div>
  );
}
