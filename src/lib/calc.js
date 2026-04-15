export function calcMA(monthly, period = 60) {
  return monthly.map((row, index) => {
    const key = `ma${period}`;
    if (index < period - 1) return { ...row, [key]: null };
    const slice = monthly.slice(index - period + 1, index + 1);
    const avg = slice.reduce((sum, item) => sum + Number(item.price || 0), 0) / period;
    return { ...row, [key]: Math.round(avg) };
  });
}

export function calcGap(price, movingAverage) {
  if (!price || !movingAverage) return null;
  return ((price / movingAverage) - 1) * 100;
}

export function getGapLabel(gap) {
  if (gap == null) return '계산 대기';
  if (gap <= -20) return '매수권';
  if (gap >= 100) return '과열';
  return '중립';
}

export function getGapMessage(gap) {
  if (gap == null) return '60개월선 계산 전입니다.';
  if (gap <= -20) return '장기 평균 대비 충분히 눌린 구간입니다. 분할매수 검토 구간으로 볼 수 있습니다.';
  if (gap >= 100) return '장기 평균에서 크게 이격된 상태입니다. 과열 또는 차익실현 구간으로 해석합니다.';
  return '장기 평균선 부근의 중립 구간입니다. 추세와 재무를 함께 봐야 합니다.';
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

export function enrichAnnualData(annualData, shares) {
  return annualData.map((row) => {
    const eps = shares > 0 && row.netIncome > 0 ? Math.round((row.netIncome * 1e8) / shares) : 0;
    const bps = shares > 0 && row.equity > 0 ? Math.round((row.equity * 1e8) / shares) : 0;
    const roe = row.netIncome && row.equity ? +((row.netIncome / row.equity) * 100).toFixed(1) : null;
    return { ...row, eps, bps, roe };
  });
}
