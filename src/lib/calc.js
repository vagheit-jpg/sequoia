
export function calcMA(values, period = 60) {
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    const sum = slice.reduce((acc, item) => acc + Number(item.price || 0), 0);
    return Number((sum / period).toFixed(2));
  });
}
export function calcGap(price, ma60) {
  if (!Number.isFinite(price) || !Number.isFinite(ma60) || ma60 === 0) return null;
  return ((price / ma60 - 1) * 100);
}
export function signalFromGap(gap) {
  if (gap === null) return null;
  if (gap <= -20) return "강력매수";
  if (gap <= 0) return "매수";
  if (gap >= 300) return "초강력매도";
  if (gap >= 200) return "강력매도";
  if (gap >= 100) return "매도";
  return null;
}
export function addIndicators(monthly) {
  const ma = calcMA(monthly, 60);
  let prevSignal = null;
  return monthly.map((item, idx) => {
    const ma60 = ma[idx];
    const gap = calcGap(Number(item.price), ma60);
    const rawSignal = signalFromGap(gap);
    const signal = rawSignal && rawSignal !== prevSignal ? rawSignal : null;
    prevSignal = rawSignal || prevSignal;
    return { ...item, ma60, gap, signal };
  });
}
export function applyValuationBands(monthly, annual, ttm) {
  const eps = Number(ttm?.eps ?? annual?.at(-1)?.eps ?? null);
  const bps = Number(ttm?.bps ?? annual?.at(-1)?.bps ?? null);
  const fcfPerShare = Number(ttm?.fcf_per_share ?? null);
  return monthly.map((item) => ({
    ...item,
    perLow: Number.isFinite(eps) ? eps * 7 : null,
    perMid: Number.isFinite(eps) ? eps * 13 : null,
    perHigh: Number.isFinite(eps) ? eps * 20 : null,
    pbrLow: Number.isFinite(bps) ? bps * 1.0 : null,
    pbrMid: Number.isFinite(bps) ? bps * 2.0 : null,
    pbrHigh: Number.isFinite(bps) ? bps * 3.5 : null,
    epsLine: Number.isFinite(eps) ? eps : null,
    fcfLine: Number.isFinite(fcfPerShare) ? fcfPerShare : null,
  }));
}
export function calcDCF(ttmFcf, shares, growthRate, discountRate, terminalGrowth) {
  if (!Number.isFinite(ttmFcf) || !Number.isFinite(shares) || shares <= 0) return null;
  if (discountRate <= terminalGrowth) return null;
  const fcf = Number(ttmFcf), g = growthRate / 100, r = discountRate / 100, tg = terminalGrowth / 100;
  let pv = 0, current = fcf;
  for (let year = 1; year <= 5; year += 1) { current = current * (1 + g); pv += current / Math.pow(1 + r, year); }
  const terminal = (current * (1 + tg)) / (r - tg);
  const terminalPv = terminal / Math.pow(1 + r, 5);
  const fairMarketCap = pv + terminalPv;
  const fairPrice = fairMarketCap / shares;
  return { fairMarketCap, fairPrice };
}
export function calcGapToFair(currentPrice, fairPrice) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(fairPrice) || fairPrice === 0) return null;
  return ((currentPrice / fairPrice - 1) * 100);
}
