
import { krw, pct, cap, num } from "../lib/format";
import { SectionTitle, Chip } from "./Common";

export default function HeroOverview({ data, fairGap, gap60, judgement }) {
  const marketCap = Number(data.price.currentPrice) * Number(data.shares);
  const chClass = data.price.change > 0 ? "up" : data.price.change < 0 ? "down" : "";

  return (
    <div className="panel hero">
      <SectionTitle right={<Chip tone="gold">{judgement}</Chip>}>핵심 개요</SectionTitle>
      <div className="hero-top">
        <div>
          <div className="hero-name">{data.corp_name}</div>
          <div className="hero-meta">{data.stock_code} · {data.market} · corp_code {data.corp_code}</div>
        </div>
        <div className="hero-price">
          <div className="hero-price-value">{krw(data.price.currentPrice)}</div>
          <div className={`hero-price-change ${chClass}`}>{krw(data.price.change)} / {pct(data.price.changePct)}</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><span>시가총액</span><strong>{cap(marketCap)}</strong></div>
        <div className="kpi"><span>TTM PER</span><strong>{num(data.ttm.per)}</strong></div>
        <div className="kpi"><span>TTM PBR</span><strong>{num(data.ttm.pbr)}</strong></div>
        <div className="kpi"><span>TTM EPS</span><strong>{krw(data.ttm.eps)}</strong></div>
        <div className="kpi"><span>TTM FCF</span><strong>{cap(data.ttm.fcf)}</strong></div>
        <div className="kpi"><span>60월선 이격도</span><strong>{pct(gap60)}</strong></div>
        <div className="kpi"><span>DCF 괴리율</span><strong>{pct(fairGap)}</strong></div>
        <div className="kpi"><span>FCF/share</span><strong>{krw(data.ttm.fcf_per_share)}</strong></div>
      </div>
    </div>
  );
}
