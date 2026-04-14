
import { useMemo, useState } from "react";
import { SectionTitle, Chip } from "./Common";

export default function Sidebar({ corps, selectedCode, onSelect, data }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return corps;
    return corps.filter(c =>
      (c.corp_name || "").toLowerCase().includes(s) ||
      (c.stock_code || "").toLowerCase().includes(s)
    );
  }, [q, corps]);

  return (
    <aside className="sidebar">
      <div className="panel">
        <SectionTitle>종목 검색</SectionTitle>
        <input className="search-input" placeholder="회사명 또는 종목코드" value={q} onChange={(e)=>setQ(e.target.value)} />
        <div className="search-list">
          {filtered.map(c => (
            <button key={c.stock_code} className={`search-item ${selectedCode === c.stock_code ? "active" : ""}`} onClick={() => onSelect(c.stock_code)}>
              <div className="search-name">{c.corp_name}</div>
              <div className="search-meta">{c.stock_code} · {c.market}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <SectionTitle>기본 정보</SectionTitle>
        {data && (
          <div className="info-stack">
            <div className="mini-row"><span>시장</span><strong>{data.market}</strong></div>
            <div className="mini-row"><span>업종</span><strong>{data.sector}</strong></div>
            <div className="mini-row"><span>대표</span><strong>{data.ceo}</strong></div>
            <div className="mini-row"><span>주식수</span><strong>{Number(data.shares).toLocaleString("ko-KR")}</strong></div>
            <div className="chip-row">
              <Chip tone="gold">정적 JSON</Chip>
              <Chip tone="green">API 없음</Chip>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <SectionTitle>워크플로</SectionTitle>
        <div className="workflow">
          <div className="wf-step"><span>1</span><div>추출기에서 JSON 생성</div></div>
          <div className="wf-step"><span>2</span><div>public/data에 업로드</div></div>
          <div className="wf-step"><span>3</span><div>뷰어에서 즉시 반영</div></div>
        </div>
      </div>
    </aside>
  );
}
