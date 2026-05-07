import colorRef from "./colorRef";

export default function ViewToggle({ view, setView }) {
  const C = colorRef.current;
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
      {["연간", "분기"].map(v => (
        <button key={v} onClick={() => setView(v)}
          style={{
            background: view === v ? `${C.blue}22` : "transparent",
            color: view === v ? C.blue : C.muted,
            border: `1px solid ${view === v ? C.blue : C.border}`,
            borderRadius: 6, padding: "4px 14px", fontSize: 11, cursor: "pointer",
            fontWeight: view === v ? 700 : 400,
          }}>
          {v}
        </button>
      ))}
    </div>
  );
}
