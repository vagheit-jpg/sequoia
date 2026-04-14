
import { ResponsiveContainer, ComposedChart, AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceDot } from "recharts";
import { SectionTitle, Chip } from "./Common";
import { krw, pct } from "../lib/format";

const SIG = { "강력매수":"#00C878", "매수":"#5BA0FF", "매도":"#FF7830", "강력매도":"#FF3D5A", "초강력매도":"#E8B840" };

function PriceTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tooltip-box">
      <div className="tooltip-title">{label}</div>
      <div>주가 {krw(d.price)}</div>
      <div>60MA {krw(d.ma60)}</div>
      <div>이격도 {pct(d.gap60)}</div>
      {d.signal ? <div>신호 {d.signal}</div> : null}
    </div>
  );
}

export default function PrimaryCharts({ monthly, mode, onMode }) {
  const points = monthly.filter(d => !!d.signal);

  return (
    <div className="panel">
      <SectionTitle right={
        <div className="tabbar">
          <button className={mode==="valuation" ? "active" : ""} onClick={()=>onMode("valuation")}>밸류</button>
          <button className={mode==="eps" ? "active" : ""} onClick={()=>onMode("eps")}>EPS</button>
          <button className={mode==="fcf" ? "active" : ""} onClick={()=>onMode("fcf")}>FCF</button>
          <button className={mode==="momentum" ? "active" : ""} onClick={()=>onMode("momentum")}>모멘텀</button>
        </div>
      }>주가 엔진</SectionTitle>

      <div className="chart-box tall">
        <ResponsiveContainer width="100%" height={420}>
          <ComposedChart data={monthly} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="label" minTickGap={28} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v)=>`${Math.round(v/1000)}k`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v)=>`${Math.round(v/1000)}k`} />
            <Tooltip content={<PriceTip />} />
            <Legend />
            <Area yAxisId="left" type="monotone" dataKey="price" fill="rgba(200,150,42,0.18)" stroke="#C8962A" strokeWidth={2.4} name="주가" />
            <Line yAxisId="left" type="monotone" dataKey="ma60" stroke="#1E72F0" strokeWidth={1.8} dot={false} name="60MA" />
            {mode === "valuation" && <>
              <Line yAxisId="left" type="monotone" dataKey="perMid" stroke="#8855FF" strokeWidth={1.3} dot={false} name="PER Mid" />
              <Line yAxisId="left" type="monotone" dataKey="pbrHi" stroke="#FF7830" strokeWidth={1.1} dot={false} name="PBR High" />
            </>}
            {mode === "eps" && <Line yAxisId="right" type="monotone" dataKey="epsLine" stroke="#00C878" strokeWidth={2} dot={false} name="EPS" />}
            {mode === "fcf" && <Line yAxisId="right" type="monotone" dataKey="fcfLine" stroke="#00CCE8" strokeWidth={2} dot={false} name="FCF/share" />}
            {mode === "momentum" && <>
              <Bar yAxisId="right" dataKey="hist" fill="rgba(255,120,48,0.55)" name="MACD Hist" />
              <Line yAxisId="right" type="monotone" dataKey="macd" stroke="#E040A8" strokeWidth={1.6} dot={false} name="MACD" />
              <Line yAxisId="right" type="monotone" dataKey="macdSignal" stroke="#84CC16" strokeWidth={1.6} dot={false} name="Signal" />
            </>}
            {points.map((p) => (
              <ReferenceDot key={p.label + p.signal} x={p.label} y={p.price} yAxisId="left" r={4.5} fill={SIG[p.signal] || "#fff"} stroke="transparent" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="legend-row">
        <Chip tone="blue">주가</Chip>
        <Chip tone="purple">밸류 밴드</Chip>
        <Chip tone="green">EPS</Chip>
        <Chip tone="cyan">FCF/share</Chip>
        <Chip tone="gold">신호포인트</Chip>
      </div>
    </div>
  );
}
