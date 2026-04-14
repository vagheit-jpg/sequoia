"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DcfScenario, FinancialPayload, FinancialRow, MonthlyBar, QuoteData, SearchItem } from '@/lib/types';
import { alignMonthlyClose, formatAmountKrw100M, formatEps, formatNumber, formatPercent, formatWon, getGapSignal } from '@/lib/utils';
import { runDcf } from '@/lib/dcf';

type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string;
};

const DEFAULT_STOCK: SearchItem = {
  name: '삼성전자',
  stockCode: '005930',
  corpCode: '00126380',
  modifyDate: '',
};

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const saved = (localStorage.getItem('sequoia-theme') as 'dark' | 'light' | null) || 'dark';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('sequoia-theme', next);
    document.documentElement.dataset.theme = next;
  };
  return { theme, toggle };
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel card metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  );
}

function DataBadge({ financials }: { financials: FinancialPayload | null }) {
  if (!financials) return null;
  const first = financials.quarterly[financials.quarterly.length - 1] || financials.annual[financials.annual.length - 1];
  return (
    <div className="badge-row">
      <span className="badge">재무 OpenDART</span>
      <span className="badge">기준 {first?.reportName || '-'}</span>
      <span className="badge">접수번호 {first?.rceptNo || '-'}</span>
      <span className="badge">기준재무 {first?.fsDiv || '-'}</span>
      <span className="badge">상태 {first?.status || '-'}</span>
    </div>
  );
}

function FinancialTable({ title, rows }: { title: string; rows: FinancialRow[] }) {
  return (
    <div className="panel table-card">
      <div className="table-head">
        <h3 className="section-title">{title}</h3>
        <span className="table-unit">금액 단위: 억원 / 1조 이상 조원 병기 · EPS: 원</span>
      </div>
      <div className="table-wrap">
        <table className="table compact-table refined-table">
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
              <th>기준</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.period}-${row.reportCode}`}>
                <td>{row.period}</td>
                <td>{formatAmountKrw100M(row.revenue)}</td>
                <td>{formatAmountKrw100M(row.operatingProfit)}</td>
                <td>{formatAmountKrw100M(row.netIncome)}</td>
                <td>{formatEps(row.eps)}</td>
                <td>{formatAmountKrw100M(row.fcf)}</td>
                <td>{formatPercent(row.roe)}</td>
                <td>{formatPercent(row.debtRatio)}</td>
                <td>{formatPercent(row.currentRatio)}</td>
                <td>{row.fsDiv || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return <div className="empty-state">{title}</div>;
}

export default function ClientDashboard({ initialSymbol }: { initialSymbol: string }) {
  const { theme, toggle } = useTheme();
  const [selected, setSelected] = useState<SearchItem>({ ...DEFAULT_STOCK, stockCode: initialSymbol || DEFAULT_STOCK.stockCode });
  const [query, setQuery] = useState(DEFAULT_STOCK.name);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [metricMode, setMetricMode] = useState<'annual' | 'quarterly'>('annual');
  const boxRef = useRef<HTMLDivElement | null>(null);

  const [quote, setQuote] = useState<Resource<QuoteData>>({ data: null, loading: true, error: '' });
  const [bars, setBars] = useState<Resource<MonthlyBar[]>>({ data: null, loading: true, error: '' });
  const [financials, setFinancials] = useState<Resource<FinancialPayload>>({ data: null, loading: true, error: '' });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    const raw = initialSymbol;
    if (!/^\d{6}$/.test(raw) || raw === '005930') return;
    setQuery(raw);
    fetch(`/api/search?q=${raw}`)
      .then((res) => res.json())
      .then((json) => {
        const first = (json.items || [])[0];
        if (first) {
          setSelected(first);
          setQuery(first.name);
        }
      })
      .catch(() => undefined);
  }, [initialSymbol]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setSearchItems([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '검색 실패');
        setSearchItems(json.items || []);
        setSearchOpen(true);
      } catch (error: any) {
        setSearchError(error.message || '검색 실패');
        setSearchItems([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!selected.stockCode) return;
    const params = new URLSearchParams(window.location.search);
    params.set('symbol', selected.stockCode);
    window.history.replaceState(null, '', `?${params.toString()}`);

    setQuote({ data: null, loading: true, error: '' });
    fetch(`/api/quote?symbol=${selected.stockCode}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '시세 조회 실패');
        setQuote({ data: json, loading: false, error: '' });
      })
      .catch((error: any) => setQuote({ data: null, loading: false, error: error.message || '시세 조회 실패' }));

    setBars({ data: null, loading: true, error: '' });
    fetch(`/api/chart?symbol=${selected.stockCode}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '차트 조회 실패');
        setBars({ data: json.rows || [], loading: false, error: '' });
      })
      .catch((error: any) => setBars({ data: null, loading: false, error: error.message || '차트 조회 실패' }));

    setFinancials({ data: null, loading: true, error: '' });
    fetch(`/api/financials?stockCode=${selected.stockCode}&corpCode=${selected.corpCode}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '재무 조회 실패');
        setFinancials({ data: json, loading: false, error: '' });
      })
      .catch((error: any) => setFinancials({ data: null, loading: false, error: error.message || '재무 조회 실패' }));
  }, [selected]);

  const monthlyBars = bars.data || [];
  const latestGap = monthlyBars[monthlyBars.length - 1]?.gap60 ?? null;
  const gapSignal = getGapSignal(latestGap);
  const financial = financials.data;

  const metricsRows = metricMode === 'annual' ? (financial?.annual || []) : (financial?.quarterly || []);
  const latestAnnual = financial?.annual[financial.annual.length - 1];
  const latestQuarter = financial?.quarterly[financial.quarterly.length - 1];

  const priceEpsData = useMemo(() => (financial?.quarterly || []).map((row) => ({
    period: row.period,
    eps: row.eps,
    price: alignMonthlyClose(monthlyBars, row.period),
  })).filter((row) => row.eps !== null || row.price !== null), [financial, monthlyBars]);

  const priceFcfData = useMemo(() => (financial?.quarterly || []).map((row) => ({
    period: row.period,
    fcf: row.fcf,
    price: alignMonthlyClose(monthlyBars, row.period),
  })).filter((row) => row.fcf !== null || row.price !== null), [financial, monthlyBars]);

  const debtCurrentData = useMemo(() => (financial?.quarterly || []).map((row) => ({
    period: row.period,
    debtRatio: row.debtRatio,
    currentRatio: row.currentRatio,
  })), [financial]);

  const roeQuarterData = useMemo(() => financial?.quarterly || [], [financial]);
  const dcf = useMemo<DcfScenario[]>(() => runDcf(financial || null, {
    discountRate: Number(process.env.NEXT_PUBLIC_DCF_DISCOUNT_RATE || 10),
    terminalGrowthRate: Number(process.env.NEXT_PUBLIC_DCF_TERMINAL_GROWTH || 2),
    fcfGrowth5y: Number(process.env.NEXT_PUBLIC_DCF_FCF_GROWTH || 5),
    sharesOutstanding: Number(process.env.NEXT_PUBLIC_SHARES_OUTSTANDING || 0),
    netCashEok: Number(process.env.NEXT_PUBLIC_NET_CASH_EOK || 0),
  }), [financial]);

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1 className="title">sequoia quantum system</h1>
          <div className="subtitle">실시간 시세 · OpenDART 재무 · 60월선 이격도</div>
          <div className="badge-row top-badges">
            <span className="badge">시세 {quote.data?.source || '-'}</span>
            <span className="badge">차트 Yahoo 월봉</span>
            <span className="badge">테마 {theme}</span>
          </div>
        </div>
        <div className="toolbar toolbar-right">
          <div className="search-box" ref={boxRef}>
            <input
              className="input search-input"
              placeholder="종목명 또는 종목코드 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
            />
            {searchOpen && (
              <div className="search-dropdown panel">
                {searchLoading ? <div className="search-state">검색 중...</div> : null}
                {!searchLoading && searchError ? <div className="search-state error-text">{searchError}</div> : null}
                {!searchLoading && !searchError && searchItems.length === 0 ? <div className="search-state">검색 결과 없음</div> : null}
                {!searchLoading && !searchError && searchItems.map((item) => (
                  <button
                    key={`${item.stockCode}-${item.corpCode}`}
                    type="button"
                    className="search-item"
                    onClick={() => {
                      setSelected(item);
                      setQuery(item.name);
                      setSearchOpen(false);
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="search-meta">{item.stockCode}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="ghost-button" type="button" onClick={toggle}>{theme === 'dark' ? '라이트 모드' : '다크 모드'}</button>
        </div>
      </div>

      <div className="panel hero">
        <div className="hero-grid">
          <div>
            <div className="hero-head">
              <div>
                <div className="metric-label">종목</div>
                <div className="metric-value big">{selected.name} <span className="accent">({selected.stockCode})</span></div>
                <div className="metric-sub">시세 업데이트 {quote.data ? new Date(quote.data.asOf).toLocaleString('ko-KR') : '-'}</div>
              </div>
              <div className={`signal-badge tone-${gapSignal.tone}`}>{gapSignal.label}</div>
            </div>
            <div className="metrics">
              <MetricCard label="현재가" value={quote.data ? formatWon(quote.data.price) : '-'} sub={quote.data ? `${formatWon(quote.data.change)} · ${formatPercent(quote.data.changePercent, 2)}` : undefined} />
              <MetricCard label="최근 분기 매출" value={formatAmountKrw100M(latestQuarter?.revenue)} sub={`영업이익 ${formatAmountKrw100M(latestQuarter?.operatingProfit)}`} />
              <MetricCard label="최근 분기 EPS" value={formatEps(latestQuarter?.eps)} sub={`FCF ${formatAmountKrw100M(latestQuarter?.fcf)}`} />
              <MetricCard label="최근 분기 ROE" value={formatPercent(latestQuarter?.roe)} sub={`부채비율 ${formatPercent(latestQuarter?.debtRatio)}`} />
            </div>
          </div>
          <div className="panel inner-panel card">
            <h3 className="section-title">핵심 체크</h3>
            <div className="kv">
              <div className="kv-row"><span className="kv-key">60월선 이격도</span><span className="kv-value">{formatPercent(latestGap, 2)} / {gapSignal.label}</span></div>
              <div className="kv-row"><span className="kv-key">최근 분기 ROE</span><span className="kv-value">{formatPercent(latestQuarter?.roe)}</span></div>
              <div className="kv-row"><span className="kv-key">최근 분기 유동비율</span><span className="kv-value">{formatPercent(latestQuarter?.currentRatio)}</span></div>
              <div className="kv-row"><span className="kv-key">DCF 기준 FCF</span><span className="kv-value">{formatAmountKrw100M(latestAnnual?.fcf)}</span></div>
              <div className="kv-row"><span className="kv-key">재무 조회 시각</span><span className="kv-value">{financial?.meta?.fetchedAt ? new Date(financial.meta.fetchedAt).toLocaleString('ko-KR') : '-'}</span></div>
            </div>
          </div>
        </div>
        <DataBadge financials={financial} />
      </div>

      {quote.error || bars.error || financials.error ? <div className="panel error-panel">{quote.error || bars.error || financials.error}</div> : null}

      <div className="grid one">
        <div className="panel chart-panel chart-panel-wide">
          <div className="chart-head">
            <h3 className="section-title">월봉 · 60월선 · 이격도 신호</h3>
            <div className={`inline-signal tone-${gapSignal.tone}`}>현재 신호 {gapSignal.label} · {formatPercent(latestGap, 2)}</div>
          </div>
          {bars.loading ? <EmptyState title="차트 로딩 중..." /> : (
            <ResponsiveContainer width="100%" height={440}>
              <ComposedChart data={monthlyBars.slice(-144)} margin={{ left: 8, right: 12, top: 10, bottom: 10 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" minTickGap={18} tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <YAxis yAxisId="left" width={76} tick={{ fill: 'var(--axis-text)', fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(value: number, name: string) => [name === '이격도' ? formatPercent(value, 2) : formatNumber(value, 2), name]} contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--line)', color: 'var(--text)' }} />
                <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 12 }} />
                <ReferenceLine yAxisId="left" y={monthlyBars[monthlyBars.length - 1]?.ma60 || undefined} stroke="var(--green)" strokeDasharray="3 3" ifOverflow="extendDomain" />
                <Line yAxisId="left" type="monotone" dataKey="close" stroke="var(--blue)" dot={false} strokeWidth={2.2} name="주가" />
                <Line yAxisId="left" type="monotone" dataKey="ma60" stroke="var(--green)" dot={false} strokeWidth={2.2} name="60월선" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <div className="note">이격도 막대 그래프는 제거했고, 신호만 상단에 명확하게 표시합니다.</div>
        </div>
      </div>

      <div className="grid two">
        <div className="panel chart-panel">
          <div className="chart-head">
            <h3 className="section-title">주요 지표</h3>
            <div className="segmented">
              <button type="button" className={metricMode === 'annual' ? 'seg active' : 'seg'} onClick={() => setMetricMode('annual')}>연간</button>
              <button type="button" className={metricMode === 'quarterly' ? 'seg active' : 'seg'} onClick={() => setMetricMode('quarterly')}>분기</button>
            </div>
          </div>
          {financials.loading ? <EmptyState title="재무 로딩 중..." /> : (
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={metricsRows}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <Tooltip formatter={(value: number) => formatNumber(value)} contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--line)', color: 'var(--text)' }} />
                <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 12 }} />
                <Bar dataKey="revenue" fill="var(--blue)" name="매출" />
                <Bar dataKey="operatingProfit" fill="var(--green)" name="영업이익" />
                <Bar dataKey="netIncome" fill="var(--amber)" name="순이익" />
                <Bar dataKey="roe" fill="var(--purple)" name="ROE" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel chart-panel">
          <h3 className="section-title">분기 ROE 추이</h3>
          {financials.loading ? <EmptyState title="재무 로딩 중..." /> : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={roeQuarterData}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--axis-text)', fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v)}%`} />
                <Tooltip formatter={(value: number) => formatPercent(value, 1)} contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--line)', color: 'var(--text)' }} />
                <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 12 }} />
                <Line type="monotone" dataKey="roe" stroke="var(--purple)" strokeWidth={2.4} dot={{ r: 2 }} name="ROE" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid two">
        <div className="panel chart-panel">
          <h3 className="section-title">주가 · EPS 동행 그래프 (분기)</h3>
          {financials.loading ? <EmptyState title="재무 로딩 중..." /> : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={priceEpsData}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v)}원`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(value: number, name: string) => [name === 'EPS' ? formatEps(value) : formatWon(value), name]} contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--line)', color: 'var(--text)' }} />
                <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 12 }} />
                <Line yAxisId="right" type="monotone" dataKey="price" stroke="var(--blue)" strokeWidth={2.4} dot={{ r: 2 }} name="주가" />
                <Line yAxisId="left" type="monotone" dataKey="eps" stroke="var(--amber)" strokeWidth={2.4} dot={{ r: 2 }} name="EPS" />
              </LineChart>
            </ResponsiveContainer>
          )}
          <div className="note">주가는 각 분기 말월(3·6·9·12월) 보정 종가로 재매핑합니다.</div>
        </div>

        <div className="panel chart-panel">
          <h3 className="section-title">주가 · FCF 동행 그래프 (분기)</h3>
          {financials.loading ? <EmptyState title="재무 로딩 중..." /> : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={priceFcfData}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(value: number, name: string) => [name === 'FCF' ? formatAmountKrw100M(value) : formatWon(value), name]} contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--line)', color: 'var(--text)' }} />
                <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 12 }} />
                <Line yAxisId="right" type="monotone" dataKey="price" stroke="var(--blue)" strokeWidth={2.4} dot={{ r: 2 }} name="주가" />
                <Line yAxisId="left" type="monotone" dataKey="fcf" stroke="var(--green)" strokeWidth={2.4} dot={{ r: 2 }} name="FCF" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid two">
        <div className="panel chart-panel">
          <h3 className="section-title">부채비율 · 유동비율 (분기)</h3>
          {financials.loading ? <EmptyState title="재무 로딩 중..." /> : (
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={debtCurrentData}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v)}%`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--axis-text)', fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v)}%`} />
                <Tooltip formatter={(value: number) => formatPercent(value, 1)} contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--line)', color: 'var(--text)' }} />
                <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 12 }} />
                <Bar yAxisId="right" dataKey="currentRatio" fill="var(--blue)" name="유동비율" />
                <Line yAxisId="left" type="monotone" dataKey="debtRatio" stroke="var(--red)" strokeWidth={2.4} dot={{ r: 2 }} name="부채비율" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel chart-panel">
          <h3 className="section-title">DCF 적정가치</h3>
          {dcf.length === 0 ? <EmptyState title="연간 FCF가 있어야 DCF 계산이 가능합니다." /> : (
            <div className="dcf-list">
              {dcf.map((row: DcfScenario) => (
                <div key={row.name} className="panel inner-panel dcf-item">
                  <div className="metric-label">{row.name}</div>
                  <div className="metric-value">{formatWon(row.perShareValue)}</div>
                  <div className="metric-sub">총 적정가치 {formatAmountKrw100M(row.intrinsicValue)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid two">
        <FinancialTable title="연간 재무" rows={financial?.annual || []} />
        <FinancialTable title="분기 재무" rows={financial?.quarterly || []} />
      </div>
    </div>
  );
}
