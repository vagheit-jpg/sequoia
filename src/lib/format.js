
export const num = (v, d=2) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return Number(v).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
};
export const krw = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return Number(v).toLocaleString("ko-KR");
};
export const pct = (v, d=2) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return `${Number(v).toFixed(d)}%`;
};
export const cap = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  const n = Number(v), a = Math.abs(n);
  if (a >= 1_0000_0000_0000) return `${(n / 1_0000_0000_0000).toFixed(2)}조`;
  if (a >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(0)}억`;
  return n.toLocaleString("ko-KR");
};
