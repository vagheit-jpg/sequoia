
import { SectionTitle, Chip } from "./Common";
import { cap, krw, pct, num } from "../lib/format";

export default function ValuationAndBusiness({ dcf, fairGap, data, fscore }) {
  return (
    <div className="grid-2">
      <div className="panel">
        <SectionTitle right={<Chip tone="orange">DCF</Chip>}>적정가치</SectionTitle>
        <div className="kpi-grid two">
          <div className="kpi"><span>적정 시총</span><strong>{cap(dcf?.fairMarketCap)}</strong></div>
          <div className="kpi"><span>적정 주가</span><strong>{krw(dcf?.fairPrice)}</strong></div>
          <div className="kpi"><span>현재가 괴리율</span><strong>{pct(fairGap)}</strong></div>
          <div className="kpi"><span>TTM FCF</span><strong>{cap(data.ttm.fcf)}</strong></div>
        </div>

        <SectionTitle right={<Chip tone="green">9점 만점</Chip>}>F-Score</SectionTitle>
        <div className="fscore-head"><strong>{fscore.total} / 9</strong><span>{fscore.total >= 7 ? "우수" : fscore.total >= 5 ? "보통" : "주의"}</span></div>
        <div className="check-grid">
          {fscore.items.map(item => (
            <div className={`check-item ${item.ok ? "on" : ""}`} key={item.name}>
              <span>{item.ok ? "●" : "○"}</span><div>{item.name}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <SectionTitle right={<Chip tone="blue">사업 개요</Chip>}>사업 설명</SectionTitle>
        <div className="business-copy">{data.business?.overview}</div>
        <div className="business-list">
          {data.business?.products?.map(p => (
            <div className="mini-card" key={p.name}>
              <div className="mini-card-title">{p.name}</div>
              <div className="mini-card-sub">{p.desc}</div>
              <div className="mini-card-pct">{num(p.pct, 0)}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
