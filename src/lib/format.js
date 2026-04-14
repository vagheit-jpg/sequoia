
export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function formatKRW(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("ko-KR");
}
export function formatMarketCap(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const n = Number(value), abs = Math.abs(n);
  if (abs >= 1_0000_0000_0000) return `${(n / 1_0000_0000_0000).toFixed(2)}조`;
  if (abs >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(0)}억`;
  return n.toLocaleString("ko-KR");
}
export function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(digits)}%`;
}
