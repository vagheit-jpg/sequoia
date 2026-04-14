
export function SectionTitle({ children, right }) {
  return (
    <div className="section-title-row">
      <div className="section-title">{children}</div>
      {right ? <div className="section-right">{right}</div> : null}
    </div>
  );
}
export function Chip({ children, tone="blue" }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}
