
import { calcDCF, calcGapToFair } from "../lib/calc";
import { formatKRW, formatMarketCap, formatPercent } from "../lib/format";
export default function DCFPanel({ currentPrice, shares, ttmFcf, growthRate, discountRate, terminalGrowth, onGrowthRate, onDiscountRate, onTerminalGrowth }) {
  const dcf = calcDCF(ttmFcf, shares, growthRate, discountRate, terminalGrowth);
  const fairGap = calcGapToFair(currentPrice, dcf?.fairPrice);
  return (
    <div className="panel">
      <div className="panel-title">DCF fair value</div>
      <div className="dcf-grid">
        <div className="kpi"><div className="kpi-label">적정 시가총액</div><div className="kpi-value">{formatMarketCap(dcf?.fairMarketCap)}</div></div>
        <div className="kpi"><div className="kpi-label">적정 주가</div><div className="kpi-value">{formatKRW(dcf?.fairPrice)}</div></div>
        <div className="kpi"><div className="kpi-label">현재가 괴리율</div><div className="kpi-value">{formatPercent(fairGap)}</div></div>
      </div>
      <div className="dcf-grid" style={{marginTop:12}}>
        <div className="kpi"><div className="range-row"><div className="kpi-label">성장률 g</div><input type="range" min="0" max="20" step="0.5" value={growthRate} onChange={(e)=>onGrowthRate(Number(e.target.value))} /><div className="range-meta"><span>0%</span><strong>{growthRate}%</strong><span>20%</span></div></div></div>
        <div className="kpi"><div className="range-row"><div className="kpi-label">할인율 r</div><input type="range" min="5" max="18" step="0.5" value={discountRate} onChange={(e)=>onDiscountRate(Number(e.target.value))} /><div className="range-meta"><span>5%</span><strong>{discountRate}%</strong><span>18%</span></div></div></div>
        <div className="kpi"><div className="range-row"><div className="kpi-label">영구성장률 tg</div><input type="range" min="0" max="5" step="0.25" value={terminalGrowth} onChange={(e)=>onTerminalGrowth(Number(e.target.value))} /><div className="range-meta"><span>0%</span><strong>{terminalGrowth}%</strong><span>5%</span></div></div></div>
      </div>
      <div className="note">FCF 기반 단순화 DCF입니다. 뷰어 단계에서는 시나리오 판단용으로 쓰고, 추출기 단계에서 업종별 할인율과 성장 가정을 더 정교화하면 됩니다.</div>
    </div>
  );
}
