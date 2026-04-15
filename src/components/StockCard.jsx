import { formatEok, formatPercent, formatPrice } from '../lib/format.js';

function Stat({ label, value, theme, accent }) {
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: 14,
        minWidth: 110,
        flex: 1,
      }}
    >
      <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ color: accent || theme.text, fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export default function StockCard({ theme, stock }) {
  const isUp = stock.changePct >= 0;

  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${theme.surface2}, ${theme.surface})`,
        border: `1px solid ${theme.border}`,
        borderRadius: 18,
        padding: 18,
        boxShadow: theme.shadow,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme.muted, fontSize: 12, marginBottom: 6 }}>{stock.market} · {stock.ticker}</div>
          <div style={{ color: theme.text, fontSize: 28, fontWeight: 900, marginBottom: 8 }}>{stock.name}</div>
          <div style={{ display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ color: theme.text, fontSize: 34, fontWeight: 900 }}>{formatPrice(stock.currentPrice)}</div>
            <div style={{ color: isUp ? theme.green : theme.red, fontSize: 15, fontWeight: 800 }}>
              {isUp ? '+' : ''}{formatPercent(stock.changePct, 2)}
            </div>
          </div>
        </div>
        <div
          style={{
            alignSelf: 'flex-start',
            color: theme.goldLight,
            fontSize: 12,
            fontWeight: 800,
            background: `${theme.gold}22`,
            borderRadius: 999,
            padding: '6px 10px',
          }}
        >
          Lite v1
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 18 }}>
        <Stat label="시가총액" value={formatEok(stock.marketCapEok)} theme={theme} accent={theme.blueLight} />
        <Stat label="PER" value={`${stock.per}배`} theme={theme} accent={theme.goldLight} />
        <Stat label="PBR" value={`${stock.pbr}배`} theme={theme} accent={theme.goldLight} />
        <Stat label="60M 이격도" value={`${stock.gap60.toFixed(1)}%`} theme={theme} accent={stock.gap60 <= -20 ? theme.green : stock.gap60 >= 100 ? theme.red : theme.orange} />
      </div>
    </section>
  );
}
