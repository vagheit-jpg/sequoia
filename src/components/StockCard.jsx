import { formatMarketCapFromWon, formatMultiple, formatPercent, formatPrice } from '../lib/format.js';

function Stat({ label, value, theme, accent }) {
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        padding: 14,
        minWidth: 110,
        flex: 1,
      }}
    >
      <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ color: accent || theme.text, fontSize: 17, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

export default function StockCard({ theme, stock, company, loading }) {
  const isUp = (stock.changePct ?? 0) >= 0;

  return (
    <section
      style={{
        background: `linear-gradient(135deg, ${theme.surface2}, ${theme.surface})`,
        border: `1px solid ${theme.border}`,
        borderRadius: 20,
        padding: 20,
        boxShadow: theme.shadow,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: theme.muted, fontSize: 14, marginBottom: 8 }}>
            {stock.market || '-'} · {stock.ticker || '-'} · CEO {company?.ceo || '-'}
          </div>
          <div style={{ color: theme.text, fontSize: 38, fontWeight: 900, marginBottom: 8 }}>{stock.name || '종목 선택'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ color: theme.green, fontSize: 34, fontWeight: 900 }}>{formatPrice(stock.currentPrice)}</div>
            <div
              style={{
                color: isUp ? theme.green : theme.red,
                fontSize: 16,
                fontWeight: 900,
                borderRadius: 12,
                padding: '8px 12px',
                background: isUp ? `${theme.green}22` : `${theme.red}22`,
              }}
            >
              {formatPercent(stock.changePct ?? 0, 2, true)}
            </div>
          </div>
        </div>
        <div style={{ color: theme.muted, fontSize: 12, alignSelf: 'center' }}>{loading ? '데이터 갱신 중...' : 'LIVE LITE'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 18 }}>
        <Stat label="PER" value={formatMultiple(stock.per)} theme={theme} accent={theme.goldLight} />
        <Stat label="PBR" value={formatMultiple(stock.pbr, 2)} theme={theme} accent={theme.goldLight} />
        <Stat label="목표가" value={formatPrice(stock.targetPrice)} theme={theme} accent={theme.blueLight} />
        <Stat label="상승여력" value={formatPercent(stock.upsidePct, 0, true)} theme={theme} accent={theme.green} />
        <Stat label="시가총액" value={formatMarketCapFromWon(stock.marketCapWon)} theme={theme} accent={theme.blueLight} />
      </div>
    </section>
  );
}
