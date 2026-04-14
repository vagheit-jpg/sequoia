
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";
import { SectionTitle, Chip } from "./Common";
import { cap, krw } from "../lib/format";

function FTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tooltip-box">
      <div className="tooltip-title">{label}</div>
      <div>매출 {cap(d.rev || d.revenue)}</div>
      <div>영업이익 {cap(d.op)}</div>
      <div>순이익 {cap(d.net)}</div>
      {d.eps != null ? <div>EPS {krw(d.eps)}</div> : null}
    </div>
  );
}

export default function FinancialMatrix({ annual, quarterMode, onQuarterMode, radarData }) {
  const bars = quarterMode === "annual"
    ? annual.map(x => ({ ...x, revenue: x.rev ?? x.revenue }))
    : annual.slice(-5).map(x => ({ label: `${x.year}`, revenue: x.rev ?? x.revenue, op: x.op, net: x.net, eps: x.eps }));

  return (
    <div className="grid-2">
      <div className="panel">
        <SectionTitle right={
          <div className="tabbar">
            <button className={quarterMode==="annual" ? "active" : ""} onClick={()=>onQuarterMode("annual")}>연간</button>
            <button className={quarterMode==="compact" ? "active" : ""} onClick={()=>onQuarterMode("compact")}>요약</button>
          </div>
        }>재무 흐름</SectionTitle>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={310}>
            <BarChart data={bars} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
              <XAxis dataKey={quarterMode === "annual" ? "year" : "label"} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v)=>`${Math.round(v/1000)}k`} />
              <Tooltip content={<FTip />} />
              <Bar dataKey="revenue" fill="#1E72F0" radius={[6,6,0,0]} />
              <Bar dataKey="op" fill="#C8962A" radius={[6,6,0,0]} />
              <Bar dataKey="net" fill="#00C878" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <SectionTitle right={<Chip tone="gold">F-Score 감성</Chip>}>퀄리티 레이더</SectionTitle>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={310}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.10)" />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 11 }} />
              <Radar dataKey="value" stroke="#C8962A" fill="rgba(200,150,42,0.35)" fillOpacity={0.65} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
