
import { formatKRW, formatMarketCap, formatNumber, formatPercent } from "../lib/format";
export default function OverviewCard({ data, lastPoint }) {
  const current = data?.price?.currentPrice;
  const change = data?.price?.change;
  const changePct = data?.price?.changePct;
  const marketCap = Number.isFinite(current) && Number.isFinite(data?.shares) ? current * data.shares : null;
  const gap = lastPoint?.gap ?? null;
  const deltaClass = change > 0 ? "up" : change < 0 ? "down" : "";
  return (
    <div className="panel">
      <div className="panel-title">Overview</div>
      <div className="stock-head">
        <div>
          <div className="stock-name">{data?.corp_name || "-"}</div>
          <div className="stock-meta">{data?.stock_code} · {data?.market} · corp_code {data?.corp_code}</div>
        </div>
        <div className="stock-price">
          <div className="stock-price-value">{formatKRW(current)}</div>
          <div className={`stock-change ${deltaClass}`}>{formatKRW(change)} / {formatPercent(changePct)}</div>
        </div>
      </div>
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">시가총액</div><div className="kpi-value">{formatMarketCap(marketCap)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM PER</div><div className="kpi-value">{formatNumber(data?.ttm?.per)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM PBR</div><div className="kpi-value">{formatNumber(data?.ttm?.pbr)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM EPS</div><div className="kpi-value">{formatKRW(data?.ttm?.eps)}</div></div>
        <div className="kpi"><div className="kpi-label">TTM FCF</div><div className="kpi-value">{formatMarketCap(data?.ttm?.fcf)}</div><div className="kpi-sub">FCF/share {formatKRW(data?.ttm?.fcf_per_share)}</div></div>
        <div className="kpi"><div className="kpi-label">60개월선 이격도</div><div className="kpi-value">{formatPercent(gap)}</div></div>
      </div>
    </div>
  );
}
