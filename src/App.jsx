
import { useEffect, useMemo, useState } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import HeroOverview from "./components/HeroOverview";
import SignalPanel from "./components/SignalPanel";
import PrimaryCharts from "./components/PrimaryCharts";
import FinancialMatrix from "./components/FinancialMatrix";
import ValuationAndBusiness from "./components/ValuationAndBusiness";
import { enrichMonthly, dcf, gapToFair, fScore, judgement } from "./lib/calc";

export default function App() {
  const [theme, setTheme] = useState("dark");
  const [corps, setCorps] = useState([]);
  const [selectedCode, setSelectedCode] = useState("005930");
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("valuation");
  const [financialMode, setFinancialMode] = useState("annual");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    fetch("/corps.json").then(r => r.json()).then(setCorps);
  }, []);

  useEffect(() => {
    if (!selectedCode) return;
    fetch(`/data/${selectedCode}.json`).then(r => r.json()).then(setData);
  }, [selectedCode]);

  const monthly = useMemo(() => data ? enrichMonthly(data.monthly || [], data.ttm || {}, data.annual || []) : [], [data]);
  const last = monthly.at(-1) || {};
  const dcfVal = useMemo(() => data ? dcf(data.ttm?.fcf, data.shares, data.dcfInput?.gr ?? 8, data.dcfInput?.dr ?? 10, data.dcfInput?.tg ?? 2) : null, [data]);
  const fairGap = useMemo(() => data ? gapToFair(data.price?.currentPrice, dcfVal?.fairPrice) : null, [data, dcfVal]);
  const fs = useMemo(() => fScore(data?.fScoreInput || {}), [data]);

  const radarData = useMemo(() => {
    if (!data) return [];
    return [
      { label: "수익성", value: Math.min(100, (data.annual.at(-1)?.roe || 0) * 4) },
      { label: "재무안정", value: Math.max(0, 100 - (data.annual.at(-1)?.debt || 0) * 4) },
      { label: "유동성", value: Math.min(100, (data.annual.at(-1)?.curr || 0) / 15) },
      { label: "현금창출", value: Math.min(100, (data.ttm?.fcf || 0) / 3) },
      { label: "EPS", value: Math.min(100, (data.ttm?.eps || 0) / 8) },
      { label: "밸류", value: Math.max(0, 100 - (data.ttm?.per || 0) * 4) },
    ];
  }, [data]);

  if (!data) return <div className="app">로딩 중...</div>;

  return (
    <div className="app">
      <Header theme={theme} onToggle={() => setTheme(t => t === "dark" ? "light" : "dark")} />
      <div className="layout">
        <Sidebar corps={corps} selectedCode={selectedCode} onSelect={setSelectedCode} data={data} />

        <main className="content">
          <div className="row row-2">
            <HeroOverview data={data} fairGap={fairGap} gap60={last.gap60} judgement={judgement(last.gap60, fairGap)} />
            <SignalPanel gap60={last.gap60} />
          </div>

          <div className="row">
            <PrimaryCharts monthly={monthly} mode={mode} onMode={setMode} />
          </div>

          <div className="row">
            <FinancialMatrix annual={data.annual || []} quarterMode={financialMode} onQuarterMode={setFinancialMode} radarData={radarData} />
          </div>

          <div className="row">
            <ValuationAndBusiness dcf={dcfVal} fairGap={fairGap} data={data} fscore={fs} />
          </div>
        </main>
      </div>
    </div>
  );
}
