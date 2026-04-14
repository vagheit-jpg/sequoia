
import { formatPercent } from "../lib/format";
export default function SignalsPanel({ gap }) {
  const flags = {
    buy: gap !== null && gap <= 0,
    strongBuy: gap !== null && gap <= -20,
    sell: gap !== null && gap >= 100,
    strongSell: gap !== null && gap >= 200,
    extremeSell: gap !== null && gap >= 300,
  };
  return (
    <div className="panel">
      <div className="panel-title">Signal engine</div>
      <div className="signal-grid">
        <div className="signal-card"><div className="signal-icon">{flags.buy ? "▲" : "·"}</div><span className="signal-label">0% 이하 매수</span></div>
        <div className="signal-card"><div className="signal-icon">{flags.strongBuy ? "▲" : "·"}</div><span className="signal-label">-20% 이하 강력매수</span></div>
        <div className="signal-card"><div className="signal-icon">{flags.sell ? "▼" : "·"}</div><span className="signal-label">+100% 이상 매도</span></div>
        <div className="signal-card"><div className="signal-icon">{flags.strongSell ? "▼" : "·"}</div><span className="signal-label">+200% 이상 강력매도</span></div>
        <div className="signal-card"><div className="signal-icon">{flags.extremeSell ? "▼" : "·"}</div><span className="signal-label">+300% 이상 초강력매도</span></div>
      </div>
      <div className="note">현재 기준 이격도는 <strong>{formatPercent(gap)}</strong> 입니다.</div>
    </div>
  );
}
