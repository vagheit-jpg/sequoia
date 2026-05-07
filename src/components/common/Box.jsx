import colorRef from "./colorRef";

export default function Box({ children, p = "12px 14px", mb = 12, style = {} }) {
  const C = colorRef.current;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: p, marginBottom: mb, ...style }}>
      {children}
    </div>
  );
}
