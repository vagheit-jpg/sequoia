
export default function Header({ theme, onToggle }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-logo">SQ</div>
        <div>
          <div className="brand-title">SEQUOIA QUANTUM</div>
          <div className="brand-sub">Deep-value dashboard • static edition</div>
        </div>
      </div>
      <button className="mode-btn" onClick={onToggle}>
        {theme === "dark" ? "라이트" : "다크"} 모드
      </button>
    </header>
  );
}
