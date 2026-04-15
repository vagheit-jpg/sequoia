export function calcMA(monthly, period = 60) {
  return monthly.map((row, index) => {
    if (index < period - 1) return { ...row, ma60: null };
    const slice = monthly.slice(index - period + 1, index + 1);
    const avg = slice.reduce((sum, item) => sum + item.price, 0) / period;
    return { ...row, ma60: Math.round(avg) };
  });
}

export function calcGap(price, ma) {
  if (!price || !ma) return null;
  return ((price / ma) - 1) * 100;
}

export function getGapLabel(gap) {
  if (gap == null) return '계산 대기';
  if (gap <= -20) return '매수권';
  if (gap >= 100) return '과열';
  return '중립';
}

export function buildBandLines(monthly, eps, bps) {
  const perLow = eps ? Math.round(eps * 7) : null;
  const perMid = eps ? Math.round(eps * 13) : null;
  const perHigh = eps ? Math.round(eps * 20) : null;
  const pbrLow = bps ? Math.round(bps * 1.0) : null;
  const pbrMid = bps ? Math.round(bps * 2.0) : null;
  const pbrHigh = bps ? Math.round(bps * 3.5) : null;

  return monthly.map((row) => ({
    ...row,
    perLow,
    perMid,
    perHigh,
    pbrLow,
    pbrMid,
    pbrHigh,
  }));
}
