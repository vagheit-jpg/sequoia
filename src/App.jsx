import { useMemo, useState } from 'react';
import ThemeToggle from './components/ThemeToggle.jsx';
import SearchBox from './components/SearchBox.jsx';
import StockCard from './components/StockCard.jsx';
import PriceChart from './components/PriceChart.jsx';
import GapCard from './components/GapCard.jsx';
import FinancialChart from './components/FinancialChart.jsx';
import StatusBar from './components/StatusBar.jsx';
import { useTheme } from './hooks/useTheme.js';
import { buildBandLines, calcGap, calcMA, getGapLabel } from './lib/calc.js';

const demoSuggestions = [
  { name: '엠아이텍', stockCode: '179290', market: 'KOSDAQ' },
  { name: '삼성전자', stockCode: '005930', market: 'KOSPI' },
  { name: 'NAVER', stockCode: '035420', market: 'KOSPI' },
];

const demoMonthly = [
  ['2021.01', 4000], ['2021.04', 4800], ['2021.07', 5600], ['2021.10', 5450],
  ['2022.01', 6000], ['2022.04', 7500], ['2022.07', 9200], ['2022.10', 8300],
  ['2023.01', 10000], ['2023.04', 14000], ['2023.07', 11000], ['2023.10', 9200],
  ['2024.01', 8500], ['2024.04', 9000], ['2024.07', 8500], ['2024.10', 7900],
  ['2025.01', 8000], ['2025.04', 8100], ['2025.07', 7600], ['2025.10', 6900],
  ['2026.01', 6800], ['2026.02', 6900], ['2026.03', 7050],
];

const expandedMonthly = Array.from({ length: 60 }, (_, i) => {
  const year = 2021 + Math.floor(i / 12);
  const month = (i % 12) + 1;
  const base = 4300 + Math.round(Math.sin(i / 4) * 500) + i * 55;
  const cycle = i > 24 ? (i < 36 ? 2800 : i < 48 ? 1300 : 400) : 0;
  const price = Math.max(3300, base + cycle - (i > 30 ? (i - 30) * 95 : 0));
  return { label: `${year}.${String(month).padStart(2, '0')}`, price };
});

const demoAnnual = [
  { year: 2020, revenue: 363, operatingIncome: 70, netIncome: 55 },
  { year: 2021, revenue: 503, operatingIncome: 132, netIncome: 120 },
  { year: 2022, revenue: 606, operatingIncome: 204, netIncome: 191 },
  { year: 2023, revenue: 464, operatingIncome: 141, netIncome: 130 },
  { year: 2024, revenue: 538, operatingIncome: 176, netIncome: 183 },
  { year: 2025, revenue: 672, operatingIncome: 207, netIncome: 204 },
];

export default function App() {
  const { mode, theme, toggleMode } = useTheme();
  const [searchTerm, setSearchTerm] = useState('엠아이텍');

  const latestEPS = 629;
  const latestBPS = 3850;

  const chartData = useMemo(() => {
    const withMA = calcMA(expandedMonthly, 60);
    return buildBandLines(withMA, latestEPS, latestBPS);
  }, []);

  const latestRow = chartData.at(-1);
  const gap60 = calcGap(latestRow?.price, latestRow?.ma60);

  const stock = {
    name: '엠아이텍',
    ticker: '179290',
    market: 'KOSDAQ',
    currentPrice: latestRow?.price ?? 7050,
    changePct: 1.82,
    marketCapEok: 2282,
    per: 11.2,
    pbr: 1.83,
    gap60: gap60 ?? -8.4,
  };

  const status = {
    price: 'mock',
    yahoo: 'mock',
    dart: 'mock',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.bg,
        color: theme.text,
      }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 16px 56px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{ color: theme.goldLight, fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', marginBottom: 8 }}>
              SEQUOIA LITE
            </div>
            <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.1 }}>장기 매수·매도 타이밍 분석기</div>
            <div style={{ color: theme.muted, marginTop: 8, fontSize: 14 }}>
              Claude 스타일의 그래프 감성과 Sequoia의 핵심 판단축만 남긴 Lite 1차 시공본
            </div>
          </div>
          <ThemeToggle mode={mode} onToggle={toggleMode} theme={theme} />
        </header>

        <div style={{ display: 'grid', gap: 16 }}>
          <SearchBox theme={theme} value={searchTerm} onChange={setSearchTerm} suggestions={demoSuggestions} />
          <StockCard theme={theme} stock={stock} />
          <PriceChart theme={theme} data={chartData} />
          <GapCard theme={theme} gap={gap60 ?? -8.4} label={getGapLabel(gap60 ?? -8.4)} />
          <FinancialChart theme={theme} data={demoAnnual} />
          <StatusBar theme={theme} status={status} />
        </div>
      </div>
    </div>
  );
}
