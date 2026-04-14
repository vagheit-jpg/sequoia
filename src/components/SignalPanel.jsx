
import { pct } from "../lib/format";
import { SectionTitle } from "./Common";

export default function SignalPanel({ gap60 }) {
  const rows = [
    { label: "-20% 강력매수", on: gap60 !== null && gap60 <= -20, icon: "▲" },
    { label: "0% 매수", on: gap60 !== null && gap60 <= 0, icon: "▲" },
    { label: "+100% 매도", on: gap60 !== null && gap60 >= 100, icon: "▼" },
    { label: "+200% 강력매도", on: gap60 !== null && gap60 >= 200, icon: "▼" },
    { label: "+300% 초강력매도", on: gap60 !== null && gap60 >= 300, icon: "▼" },
  ];
  return (
    <div className="panel">
      <SectionTitle>60월선 이격도 신호</SectionTitle>
      <div className="signal-grid">
        {rows.map((r) => (
          <div key={r.label} className="signal-card">
            <div className={`signal-icon ${r.on ? "on" : ""}`}>{r.on ? r.icon : "·"}</div>
            <div className="signal-label">{r.label}</div>
          </div>
        ))}
      </div>
      <div className="panel-note">현재 이격도: <strong>{pct(gap60)}</strong></div>
    </div>
  );
}
