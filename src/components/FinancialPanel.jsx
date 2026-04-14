
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { formatKRW, formatMarketCap, formatNumber } from "../lib/format";
function FinancialTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div style={{background:"rgba(10,15,25,.92)",color:"#fff",border:"1px solid rgba(255,255,255,.12)",borderRadius:14,padding:12}}>
      <div style={{fontWeight:800,marginBottom:6}}>{label}</div>
      <div>매출: {formatMarketCap(row.revenue)}</div>
      <div>영업이익: {formatMarketCap(row.op)}</div>
      <div>순이익: {formatMarketCap(row.net)}</div>
      {row.eps != null ? <div>EPS: {formatKRW(row.eps)}</div> : null}
      {row.fcf != null ? <div>FCF: {formatMarketCap(row.fcf)}</div> : null}
    </div>
  );
}
export default function FinancialPanel({ tab, onTabChange, annual, quarterly, ttm }) {
  const rows = tab === "annual" ? annual : quarterly;
  const xKey = tab === "annual" ? "year" : "label";
  return (
    <div className="panel">
      <div className="panel-title">Financial flow</div>
      <div className="tabs">
        <button className={`tab-btn ${tab === "annual" ? "active" : ""}`} onClick={()=>onTabChange("annual")}>연간</button>
        <button className={`tab-btn ${tab === "quarterly" ? "active" : ""}`} onClick={()=>onTabChange("quarterly")}>분기</button>
      </div>
      <div style={{width:"100%",height:320}}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top:8,right:12,left:-10,bottom:0 }}>
            <CartesianGrid stroke="rgba(148,163,184,.15)" strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tick={{fontSize:11}} />
            <YAxis tick={{fontSize:11}} tickFormatter={(v)=>`${Math.round(v/1000)}k`} />
            <Tooltip content={<FinancialTooltip />} />
            <Bar dataKey="revenue" fill="#4da3ff" radius={[6,6,0,0]} />
            <Bar dataKey="op" fill="#d4af37" radius={[6,6,0,0]} />
            <Bar dataKey="net" fill="#28c76f" radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="kpi-grid" style={{marginTop:12}}>
        <div className="kpi"><div className="kpi-label">TTM EPS</div><div className="kpi-value">{formatKRW(ttm?.eps)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM BPS</div><div className="kpi-value">{formatKRW(ttm?.bps)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM FCF</div><div className="kpi-value">{formatMarketCap(ttm?.fcf)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM PER</div><div className="kpi-value">{formatNumber(ttm?.per)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM PBR</div><div className="kpi-value">{formatNumber(ttm?.pbr)}</div></div>
      </div>
    </div>
  );
}
