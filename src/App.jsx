import { useMemo } from 'react';
import ThemeToggle from './components/ThemeToggle.jsx';
import SearchBox from './components/SearchBox.jsx';
import StockCard from './components/StockCard.jsx';
import PriceChart from './components/PriceChart.jsx';
import GapCard from './components/GapCard.jsx';
import FinancialChart from './components/FinancialChart.jsx';
import StatusBar from './components/StatusBar.jsx';
import { useTheme } from './hooks/useTheme.js';
import { buildBandLines, calcGap, calcMA, getGapLabel, getGapMessage } from './lib/calc.js';
import { formatCompactEok } from './lib/format.js';
import { useStock } from './hooks/useStock.js';

function buildKpiRows(latestAnnual) {
  if (!latestAnnual) return [];
  return [
    { label: '매출(연간)', value: formatCompactEok(latestAnnual.revenue) },
    { label: '영업이익', value: formatCompactEok(latestAnnual.operatingIncome) },
    { label: '순이익', value: formatCompactEok(latestAnnual.netIncome) },
    { label: 'EPS', value: latestAnnual.eps ? `${latestAnnual.eps.toLocaleString('ko-KR')}원` : '-' },
    { label: 'BPS', value: latestAnnual.bps ? `${latestAnnual.bps.toLocaleString('ko-KR')}원` : '-' },
    { label: 'ROE', value: latestAnnual.roe != null ? `${latestAnnual.roe.toFixed(1)}%` : '-' },
  ];
}

export default function App() {
  const { mode, theme, toggleMode } = useTheme();
  const {
    query,
    setQuery,
    suggestions,
    selectedCorp,
    loading,
    priceData,
    monthlyData,
    annualData,
    latestAnnual,
    companyData,
    status,
    error,
    submitSearch,
    selectSuggestion,
  } = useStock();

  const chartData = useMemo(() => {
    if (!monthlyData.length) return [];
    const withMA = calcMA(monthlyData, 60);
    return buildBandLines(withMA, latestAnnual?.eps || 0, latestAnnual?.bps || 0);
  }, [monthlyData, latestAnnual?.eps, latestAnnual?.bps]);

  const latestRow = chartData.at(-1);
  const currentPrice = priceData?.price || latestRow?.price || 0;
  const changePct = priceData?.changePct ?? 0;
  const gap60 = calcGap(currentPrice, latestRow?.ma60);
  const per = priceData?.per || (latestAnnual?.eps > 0 ? +(currentPrice / latestAnnual.eps).toFixed(1) : null);
  const pbr = priceData?.pbr || (latestAnnual?.bps > 0 ? +(currentPrice / latestAnnual.bps).toFixed(2) : null);
  const targetPrice = latestAnnual?.eps ? Math.round(latestAnnual.eps * 13) : null;
  const upsidePct = targetPrice && currentPrice ? ((targetPrice / currentPrice) - 1) * 100 : null;
  const marketCapWon = companyData?.shares && currentPrice ? companyData.shares * currentPrice : null;

  const stock = {
    name: selectedCorp?.corp_name || companyData?.name || '-',
    ticker: selectedCorp?.stock_code || '-',
    market: selectedCorp?.market || '-',
    currentPrice,
    changePct,
    marketCapWon,
    per,
    pbr,
    targetPrice,
    upsidePct,
  };

  const kpis = useMemo(() => buildKpiRows(latestAnnual), [latestAnnual]);

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '18px 16px 56px' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 18,
            padding: '12px 4px 4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #ffb34d, #ff7f2a)',
                color: '#111',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
                fontSize: 28,
              }}
            >
              S
            </div>
            <div>
              <div style={{ color: theme.goldLight, fontSize: 18, fontWeight: 900, letterSpacing: '0.1em' }}>SEQUOIA QUANTUM</div>
              <div style={{ color: theme.muted, fontSize: 11, letterSpacing: '0.28em', fontWeight: 700 }}>INVESTMENT INTELLIGENCE SYSTEM</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#95a9cc' }} />
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#4bc1ff' }} />
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#2a75ff' }} />
              <span style={{ width: 10, height: 10, borderRadius: 999, background: '#d7a627' }} />
            </div>
            <ThemeToggle mode={mode} onToggle={toggleMode} theme={theme} />
          </div>
        </header>

        <div style={{ display: 'grid', gap: 16 }}>
          <SearchBox
            theme={theme}
            value={query}
            onChange={setQuery}
            onSubmit={submitSearch}
            onSelect={selectSuggestion}
            suggestions={suggestions}
            loading={loading}
          />
          <StockCard theme={theme} stock={stock} company={companyData} loading={loading} />
          <GapCard theme={theme} gap={gap60 ?? 0} label={getGapLabel(gap60 ?? 0)} message={getGapMessage(gap60 ?? 0)} />
          <PriceChart theme={theme} data={chartData} />

          {kpis.length > 0 && (
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {kpis.map((item) => (
                <div key={item.label} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, boxShadow: theme.shadow }}>
                  <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ color: theme.text, fontSize: 18, fontWeight: 900 }}>{item.value}</div>
                </div>
              ))}
            </section>
          )}

          <FinancialChart theme={theme} data={annualData} error={status.dart === 'failed' ? '최근 공시 데이터 확인 불가' : ''} />
          <StatusBar theme={theme} status={status} error={error} source={priceData?.source || ''} />
        </div>
      </div>
    </div>
  );
}
