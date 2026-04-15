import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
      <div style={{ color: theme.muted, fontSize: 12, marginBottom: 6 }}>{label}년</div>
      {payload.map((item) => (
        <div key={item.dataKey} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: item.color }}>{item.name}</span>
          <strong style={{ color: theme.text }}>{Number(item.value).toLocaleString('ko-KR')}억</strong>
        </div>
      ))}
    </div>
  );
}

export default function FinancialChart({ theme, data }) {
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
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: theme.muted, fontSize: 12, marginBottom: 4 }}>DART ANNUAL</div>
        <div style={{ color: theme.text, fontSize: 20, fontWeight: 900 }}>연간 재무 흐름</div>
      </div>
      <div style={{ width: '100%', height: 'min(46vw, 360px)', minHeight: 280 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 10, left: -16, bottom: 8 }}>
            <CartesianGrid stroke={theme.grid} strokeDasharray="2 4" />
            <XAxis dataKey="year" tick={{ fill: theme.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: theme.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
            <Tooltip content={<CustomTooltip theme={theme} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="revenue" name="매출" fill={theme.blueLight} radius={[6, 6, 0, 0]} />
            <Bar dataKey="operatingIncome" name="영업이익" fill={theme.goldLight} radius={[6, 6, 0, 0]} />
            <Bar dataKey="netIncome" name="순이익" fill={theme.green} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
