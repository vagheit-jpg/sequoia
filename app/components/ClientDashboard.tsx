'use client';

import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  ComposedChart,
} from 'recharts';
import { FinancialPayload, MonthlyBar, QuoteData } from '@/lib/types';
import { formatEok, formatEps, formatNumber, formatPercent, formatWon, getGapSignal } from '@/lib/utils';

type Props = {
  initialSymbol: string;
  quote: QuoteData;
  monthlyBars: MonthlyBar[];
  financials: FinancialPayload;
  dcf: Array<{ name: string; intrinsicValue: number; perShareValue: number }>;
};

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  );
}

function KVCard({ title, rows }: { title: string; rows: Array<{ k: string; v: string }> }) {
  return (
    <div className="panel card">
      <h3 className="section-title">{title}</h3>
      <div className="kv">
        {rows.map((row) => (
          <div className="kv-row" key={row.k}>
            <div className="kv-key">{row.k}</div>
            <div className="kv-value">{row.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinancialTable({ title, rows }: { title: string; rows: FinancialPayload['annual'] }) {
  return (
    <div className="panel card table-card">
      <h3 className="section-title">{title}</h3>
      <div className="table-wrap">
        <table className="table compact-table">
          <thead>
            <tr>
              <th>기간</th>
              <th>매출</th>
              <th>영업이익</th>
              <th>순이익</th>
              <th>EPS</th>
              <th>FCF</th>
              <th>ROE</th>
              <th>부채비율</th>
              <th>유동비율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period}>
                <td>{row.period}</td>
                <td>{formatEok(row.revenue)}</td>
                <td>{formatEok(row.operatingProfit)}</td>
                <td>{formatEok(row.netIncome)}</td>
                <td>{formatEps(row.eps)}</td>
                <td>{formatEok(row.fcf)}</td>
                <td>{formatPercent(row.roe)}</td>
                <td>{formatPercent(row.debtRatio)}</td>
                <td>{formatPercent(row.currentRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ClientDashboard({ initialSymbol, quote, monthlyBars, financials, dcf }: Props) {
  const [symbol, setSymbol] = useState(initialSymbol.replace(/\.(KS|KQ)$/i, ''));

  const latestGap = monthlyBars[monthlyBars.length - 1]?.gap60 ?? null;
  const signal = getGapSignal(latestGap);

  const priceEpsData = useMemo(() => {
    return financials.annual
      .filter((row) => row.eps !== null)
      .map((row, idx) => ({
        period: row.period,
        eps: row.eps,
        priceProxy: monthlyBars[Math.max(0, monthlyBars.length - financials.annual.length + idx)]?.close ?? null,
      }));
  }, [financials, monthlyBars]);

  const priceFcfData = useMemo(() => {
    return financials.annual
      .filter((row) => row.fcf !== null)
      .map((row, idx) => ({
        period: row.period,
        fcf: row.fcf,
        priceProxy: monthlyBars[Math.max(0, monthlyBars.length - financials.annual.length + idx)]?.close ?? null,
      }));
  }, [financials, monthlyBars]);

  const latestAnnual = financials.annual[financials.annual.length - 1];

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1 className="title">Sequoia MVP</h1>
          <div className="subtitle">실시간 주가 · 월봉 60월선 · FnGuide 재무 · DCF</div>
          <div className="badges">
            <div className="badge">시세 {quote.source}</div>
            <div className="badge">차트 Yahoo</div>
            <div className="badge">재무 FnGuide 캐시</div>
          </div>
        </div>
        <form className="toolbar" action="/">
          <input name="symbol" className="input" placeholder="005930" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          <button className="button" type="submit">종목 불러오기</button>
        </form>
      </div>

      <div className="panel hero">
        <div className="hero-grid">
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="metric-label">종목</div>
                <div className="metric-value">{financials.companyName} <span style={{ fontSize: 18, color: '#83b4ff' }}>({initialSymbol})</span></div>
                <div className="metric-sub">업데이트 {new Date(quote.asOf).toLocaleString('ko-KR')}</div>
              </div>
              <div className={`badge signal-${signal.tone}`}>{signal.label}</div>
            </div>
            <div className="metrics">
              <MetricCard label="현재가" value={formatWon(quote.price)} sub={`${formatWon(quote.change)} · ${formatPercent(quote.changePercent, 2)}`} />
              <MetricCard label="최근 연간 매출" value={formatEok(latestAnnual?.revenue)} sub={`영업이익 ${formatEok(latestAnnual?.operatingProfit)}`} />
              <MetricCard label="최근 연간 EPS" value={formatEps(latestAnnual?.eps)} sub={`FCF ${formatEok(latestAnnual?.fcf)}`} />
              <MetricCard label="최근 연간 ROE" value={formatPercent(latestAnnual?.roe)} sub={`부채비율 ${formatPercent(latestAnnual?.debtRatio)}`} />
            </div>
          </div>
          <KVCard
            title="핵심 체크"
            rows={[
              { k: '60월선 이격도', v: `${formatPercent(latestGap, 2)} / ${signal.label}` },
              { k: '최근 ROE', v: formatPercent(latestAnnual?.roe) },
              { k: '최근 부채비율', v: formatPercent(latestAnnual?.debtRatio) },
              { k: '최근 유동비율', v: formatPercent(latestAnnual?.currentRatio) },
              { k: 'DCF 기준 FCF', v: formatEok(latestAnnual?.fcf) },
              { k: '현재 시세 소스', v: quote.source.toUpperCase() },
            ]}
          />
        </div>
      </div>

      <div className="grid one" style={{ marginBottom: 16 }}>
        <div className="panel chart-panel chart-panel-wide">
          <h3 className="section-title">월봉 · 60월선 · 이격도 신호</h3>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={monthlyBars.slice(-120)} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="date" minTickGap={24} tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis yAxisId="left" width={64} tick={{ fill: '#b6c2d3', fontSize: 12 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <YAxis hide yAxisId="right" orientation="right" domain={['auto', 'auto']} />
              <Tooltip formatter={(value: number, name: string) => [name === '이격도%' ? formatPercent(value, 2) : formatNumber(value, 2), name]} />
              <Legend wrapperStyle={{ color: '#d8e1ee', fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="close" stroke="#83b4ff" dot={false} strokeWidth={2.2} name="주가" />
              <Line yAxisId="left" type="monotone" dataKey="ma60" stroke="#17c964" dot={false} strokeWidth={2.2} name="60월선" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="note">현재 신호: <strong>{signal.label}</strong> · 이격도 {formatPercent(latestGap, 2)} · 규칙: -20% 강력매수 / 0% 매수 / +100% 매도 / +200% 강력매도 / +300% 초강력매도</div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="panel chart-panel">
          <h3 className="section-title">주요 지표 5개년</h3>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={financials.annual}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <Tooltip formatter={(value: number) => formatNumber(value)} />
              <Legend wrapperStyle={{ color: '#d8e1ee', fontSize: 12 }} />
              <Bar dataKey="revenue" fill="#83b4ff" name="매출" />
              <Bar dataKey="operatingProfit" fill="#17c964" name="영업이익" />
              <Bar dataKey="netIncome" fill="#f59e0b" name="순이익" />
              <Bar dataKey="eps" fill="#ef4444" name="EPS" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel chart-panel">
          <h3 className="section-title">ROE 추이</h3>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={financials.annual}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis tick={{ fill: '#b6c2d3', fontSize: 12 }} tickFormatter={(v) => `${Math.round(v)}%`} />
              <Tooltip formatter={(value: number) => formatPercent(value, 1)} />
              <Legend wrapperStyle={{ color: '#d8e1ee', fontSize: 12 }} />
              <Line type="monotone" dataKey="roe" stroke="#8b5cf6" strokeWidth={2.4} dot={{ r: 3 }} name="ROE" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="panel chart-panel">
          <h3 className="section-title">주가 · EPS 동행 그래프</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={priceEpsData}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <Tooltip formatter={(value: number) => formatNumber(value)} />
              <Legend wrapperStyle={{ color: '#d8e1ee', fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="priceProxy" stroke="#83b4ff" strokeWidth={2} dot={false} name="주가(연말 근사)" />
              <Line yAxisId="right" type="monotone" dataKey="eps" stroke="#17c964" strokeWidth={2} dot={false} name="EPS" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel chart-panel">
          <h3 className="section-title">주가 · FCF 동행 그래프</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={priceFcfData}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <Tooltip formatter={(value: number) => formatNumber(value)} />
              <Legend wrapperStyle={{ color: '#d8e1ee', fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="priceProxy" stroke="#83b4ff" strokeWidth={2} dot={false} name="주가(연말 근사)" />
              <Line yAxisId="right" type="monotone" dataKey="fcf" stroke="#f59e0b" strokeWidth={2} dot={false} name="FCF" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="panel chart-panel">
          <h3 className="section-title">부채비율 · 유동비율</h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={financials.annual}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <YAxis tick={{ fill: '#b6c2d3', fontSize: 12 }} />
              <Tooltip formatter={(value: number) => formatPercent(value)} />
              <Legend wrapperStyle={{ color: '#d8e1ee', fontSize: 12 }} />
              <Bar dataKey="currentRatio" fill="#17c964" name="유동비율" barSize={28} radius={[8, 8, 0, 0]} />
              <Line type="monotone" dataKey="debtRatio" stroke="#ef4444" strokeWidth={2.4} dot={{ r: 3 }} name="부채비율" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="panel chart-panel">
          <h3 className="section-title">DCF 적정가치</h3>
          <div className="grid three">
            {dcf.map((item) => (
              <MetricCard
                key={item.name}
                label={item.name}
                value={formatWon(Math.round(item.perShareValue))}
                sub={`기업가치 ${formatEok(Math.round(item.intrinsicValue))}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid two">
        <FinancialTable title="연간 재무" rows={financials.annual} />
        <FinancialTable title="분기 재무" rows={financials.quarterly} />
      </div>

      <div className="footer">재무 원천: FnGuide 캐시 또는 서버 스크래핑 · 시세: 키움 우선, 실패 시 Yahoo 폴백</div>
    </div>
  );
}
