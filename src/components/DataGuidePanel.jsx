
export default function DataGuidePanel({ data }) {
  return (
    <div className="panel">
      <div className="panel-title">Data format</div>
      <div className="mini-list">
        <div className="mini-row"><span>JSON 위치</span><strong>/public/data/{data?.stock_code}.json</strong></div>
        <div className="mini-row"><span>연간</span><strong>최근 5년</strong></div>
        <div className="mini-row"><span>분기</span><strong>최근 12개</strong></div>
        <div className="mini-row"><span>핵심</span><strong>EPS · FCF · DCF</strong></div>
      </div>
      <div className="debug-box">{`필수 키:
corp_name
stock_code
corp_code
shares
price
annual[]
quarterly[]
ttm
monthly[]
meta`}</div>
    </div>
  );
}
