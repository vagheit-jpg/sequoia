
import { useMemo, useState } from "react";
export default function SearchSidebar({ corps, selectedCode, onSelect }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return corps;
    return corps.filter((corp) =>
      (corp.corp_name || "").toLowerCase().includes(q) ||
      (corp.stock_code || "").toLowerCase().includes(q) ||
      (corp.market || "").toLowerCase().includes(q)
    );
  }, [corps, query]);
  return (
    <>
      <div className="panel">
        <div className="panel-title">Search</div>
        <input className="search-input" placeholder="회사명 또는 종목코드" value={query} onChange={(e)=>setQuery(e.target.value)} />
        <div className="search-list">
          {filtered.map((corp) => {
            const active = corp.stock_code === selectedCode;
            return (
              <button key={corp.stock_code} className={`search-item ${active ? "active" : ""}`} onClick={() => onSelect(corp.stock_code)}>
                <div className="search-name">{corp.corp_name}</div>
                <div className="search-meta">{corp.stock_code} · {corp.market}</div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">Data workflow</div>
        <div className="mini-list">
          <div className="mini-row"><span>1. 추출기</span><strong>JSON 생성</strong></div>
          <div className="mini-row"><span>2. public/data</span><strong>업로드</strong></div>
          <div className="mini-row"><span>3. Viewer</span><strong>시각화</strong></div>
        </div>
        <div className="note">이번 버전은 외부 API 없이 정적 JSON만 읽습니다. JSON 포맷만 맞으면 종목 수를 쉽게 늘릴 수 있습니다.</div>
      </div>
    </>
  );
}
