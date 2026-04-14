
import { useEffect, useMemo, useState } from "react";
import Header from "./components/Header";
import SearchSidebar from "./components/SearchSidebar";
import OverviewCard from "./components/OverviewCard";
import SignalsPanel from "./components/SignalsPanel";
import PriceChartPanel from "./components/PriceChartPanel";
import FinancialPanel from "./components/FinancialPanel";
import DCFPanel from "./components/DCFPanel";
import DataGuidePanel from "./components/DataGuidePanel";
import { addIndicators, applyValuationBands } from "./lib/calc";

export default function App() {
  const [theme, setTheme] = useState("dark");
  const [corps, setCorps] = useState([]);
  const [selectedCode, setSelectedCode] = useState("005930");
  const [data, setData] = useState(null);
  const [priceMode, setPriceMode] = useState("valuation");
  const [financialTab, setFinancialTab] = useState("annual");
  const [growthRate, setGrowthRate] = useState(8);
  const [discountRate, setDiscountRate] = useState(10);
  const [terminalGrowth, setTerminalGrowth] = useState(2);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    fetch("/corps.json").then((res) => res.json()).then((json) => {
      setCorps(json);
      if (!selectedCode && json[0]?.stock_code) setSelectedCode(json[0].stock_code);
    });
  }, []);

  useEffect(() => {
    if (!selectedCode) return;
    fetch(`/data/${selectedCode}.json`).then((res) => res.json()).then(setData);
  }, [selectedCode]);

  const chartData = useMemo(() => {
    if (!data?.monthly) return [];
    const base = addIndicators(data.monthly);
    return applyValuationBands(base, data.annual || [], data.ttm || {});
  }, [data]);

  const lastPoint = chartData.at(-1) || {};

  return (
    <div className="app-shell">
      <Header theme={theme} onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))} />

      <div className="layout">
        <div className="sidebar">
          <SearchSidebar corps={corps} selectedCode={selectedCode} onSelect={setSelectedCode} />
          {data ? <DataGuidePanel data={data} /> : null}
        </div>

        <div className="overview-grid">
          <div className="col-7">{data ? <OverviewCard data={data} lastPoint={lastPoint} /> : null}</div>
          <div className="col-5"><SignalsPanel gap={lastPoint?.gap ?? null} /></div>
          <div className="col-8"><PriceChartPanel data={chartData} mode={priceMode} onModeChange={setPriceMode} /></div>
          <div className="col-4">{data ? <DCFPanel currentPrice={data?.price?.currentPrice} shares={data?.shares} ttmFcf={data?.ttm?.fcf} growthRate={growthRate} discountRate={discountRate} terminalGrowth={terminalGrowth} onGrowthRate={setGrowthRate} onDiscountRate={setDiscountRate} onTerminalGrowth={setTerminalGrowth} /> : null}</div>
          <div className="col-12">{data ? <FinancialPanel tab={financialTab} onTabChange={setFinancialTab} annual={data.annual || []} quarterly={data.quarterly || []} ttm={data.ttm || {}} /> : null}</div>
        </div>
      </div>
    </div>
  );
}
