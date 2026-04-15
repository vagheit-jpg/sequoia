import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatPrice } from '../lib/format.js';

function CustomTooltip({ active, payload, label, theme }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: '10px 12px',
        boxShadow: theme.shadow,
      }}
    >
      <div style={{ color: theme.muted, fontSize: 12, marginBottom: 6 }}>{label}</div>
      {payload.map((item) => (
        <div key={item.dataKey} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: item.color }}>{item.name}</span>
          <strong style={{ color: theme.text }}>{formatPrice(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function PriceChart({ theme, data }) {
  return (
    <section
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 18,
        padding: 16,
        boxShadow: theme.shadow,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ color: theme.muted, fontSize: 12, marginBottom: 4 }}>PRICE MAP</div>
          <div style={{ color: theme.text, fontSize: 20, fontWeight: 900 }}>월봉 · 60MA · PER/PBR 밴드</div>
        </div>
        <div style={{ color: theme.muted, fontSize: 12, alignSelf: 'center' }}>기존 차트 감성을 유지한 Lite 메인 차트</div>
      </div>

      <div style={{ width: '100%', height: 'min(52vw, 420px)', minHeight: 290 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 10, left: -16, bottom: 8 }}>
            <CartesianGrid stroke={theme.grid} strokeDasharray="2 4" />
            <XAxis dataKey="label" tick={{ fill: theme.muted, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={22} />
            <YAxis tick={{ fill: theme.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={72} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <Tooltip content={<CustomTooltip theme={theme} />} />
            <ReferenceLine y={0} stroke={theme.grid} />
            <Line type="monotone" dataKey="price" name="종가" stroke={theme.goldLight} strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="ma60" name="60MA" stroke={theme.blueLight} strokeWidth={2.2} dot={false} />
            <Line type="monotone" dataKey="perLow" name="PER Low" stroke={theme.green} strokeWidth={1.4} strokeDasharray="5 4" dot={false} />
            <Line type="monotone" dataKey="perMid" name="PER Mid" stroke={theme.green} strokeWidth={1.2} strokeDasharray="2 4" dot={false} />
            <Line type="monotone" dataKey="perHigh" name="PER High" stroke={theme.green} strokeWidth={1.4} strokeDasharray="5 4" dot={false} />
            <Line type="monotone" dataKey="pbrLow" name="PBR Low" stroke={theme.orange} strokeWidth={1.3} strokeDasharray="5 4" dot={false} />
            <Line type="monotone" dataKey="pbrMid" name="PBR Mid" stroke={theme.orange} strokeWidth={1.1} strokeDasharray="2 4" dot={false} />
            <Line type="monotone" dataKey="pbrHigh" name="PBR High" stroke={theme.orange} strokeWidth={1.3} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
