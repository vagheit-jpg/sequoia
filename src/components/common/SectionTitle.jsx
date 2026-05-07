import colorRef from "./colorRef";

export default function ST({ children, accent, right }) {
  const C = colorRef.current;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 4 }}>
      <div style={{ color: accent, fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>{children}</div>
      {right && <div style={{ color: C.muted, fontSize: 10 }}>{right}</div>}
    </div>
  );
}
