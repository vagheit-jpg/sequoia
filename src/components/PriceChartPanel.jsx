
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import { formatKRW, formatPercent } from "../lib/format";
const signalColor = { "강력매수":"#2563eb", "매수":"#16a34a", "매도":"#f97316", "강력매도":"#dc2626", "초강력매도":"#111827" };
function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div style={{background:"rgba(10,15,25,.92)",color:"#fff",border:"1px solid rgba(255,255,255,.12)",borderRadius:14,padding:12,minWidth:200}}>
      <div style={{fontWeight:800,marginBottom:6}}>{label}</div>
      <div>주가: {formatKRW(row.price)}</div>
      <div>60MA: {formatKRW(row.ma60)}</div>
      <div>이격도: {formatPercent(row.gap)}</div>
      {row.signal ? <div>신호: {row.signal}</div> : null}
      {row.epsLine != null ? <div>EPS: {formatKRW(row.epsLine)}</div> : null}
      {row.fcfLine != null ? <div>FCF/share: {formatKRW(row.fcfLine)}</div> : null}
    </div>
  );
}
export default function PriceChartPanel({ data, mode, onModeChange }) {
  const signalPoints = data.filter((d)=>!!d.signal);
  return (
    <div className="panel">
      <div className="panel-title">Price overlays</div>
      <div className="subtabs">
        <button className={`tab-btn ${mode === "valuation" ? "active" : ""}`} onClick={()=>onModeChange("valuation")}>주가 + 밴드</button>
        <button className={`tab-btn ${mode === "eps" ? "active" : ""}`} onClick={()=>onModeChange("eps")}>주가 + EPS</button>
        <button className={`tab-btn ${mode === "fcf" ? "active" : ""}`} onClick={()=>onModeChange("fcf")}>주가 + FCF/share</button>
      </div>
      <div style={{width:"100%",height:430}}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top:12,right:18,left:-10,bottom:0 }}>
            <CartesianGrid stroke="rgba(148,163,184,.15)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{fontSize:11}} minTickGap={28} />
            <YAxis yAxisId="left" tick={{fontSize:11}} tickFormatter={(v)=>`${Math.round(v/1000)}k`} />
            <YAxis yAxisId="right" orientation="right" tick={{fontSize:11}} tickFormatter={(v)=>`${Math.round(v/1000)}k`} />
            <Tooltip content={<PriceTooltip />} />
            <Line yAxisId="left" type="monotone" dataKey="price" stroke="#d4af37" strokeWidth={2.2} dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="ma60" stroke="#4da3ff" strokeWidth={1.8} dot={false} />
            {mode === "valuation" && <>
              <Line yAxisId="left" type="monotone" dataKey="perLow" stroke="#2e8b57" strokeWidth={1.1} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="perMid" stroke="#1d4ed8" strokeWidth={1.1} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="perHigh" stroke="#9333ea" strokeWidth={1.1} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="pbrLow" stroke="#0f766e" strokeWidth={1.1} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="pbrMid" stroke="#ea580c" strokeWidth={1.1} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="pbrHigh" stroke="#ef4444" strokeWidth={1.1} dot={false} />
            </>}
            {mode === "eps" && <Line yAxisId="right" type="monotone" dataKey="epsLine" stroke="#22c55e" strokeWidth={2} dot={false} />}
            {mode === "fcf" && <Line yAxisId="right" type="monotone" dataKey="fcfLine" stroke="#f97316" strokeWidth={2} dot={false} />}
            {signalPoints.map((pt) => <ReferenceDot key={`${pt.label}-${pt.signal}`} x={pt.label} y={pt.price} yAxisId="left" r={5} fill={signalColor[pt.signal] || "#fff"} stroke="transparent" />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <div><span className="legend-dot" style={{background:"#d4af37"}}></span>주가</div>
        <div><span className="legend-dot" style={{background:"#4da3ff"}}></span>60MA</div>
        {mode === "valuation" ? <><div><span className="legend-dot" style={{background:"#1d4ed8"}}></span>PER 밴드</div><div><span className="legend-dot" style={{background:"#ea580c"}}></span>PBR 밴드</div></> : null}
        {mode === "eps" ? <div><span className="legend-dot" style={{background:"#22c55e"}}></span>EPS</div> : null}
        {mode === "fcf" ? <div><span className="legend-dot" style={{background:"#f97316"}}></span>FCF/share</div> : null}
      </div>
    </div>
  );
}
