
export function ema(arr, n) {
  const k = 2 / (n + 1);
  let e = arr[0] ?? 0;
  return arr.map((v, i) => {
    if (i === 0) return e;
    e = v * k + e * (1 - k);
    return +e.toFixed(2);
  });
}

export function enrichMonthly(monthly, ttm, annual) {
  const prices = monthly.map(d => Number(d.price || 0));
  const ma60s = monthly.map((_, i) => {
    if (i < 59) return null;
    const slice = monthly.slice(i - 59, i + 1);
    return +(slice.reduce((s, x) => s + Number(x.price || 0), 0) / 60).toFixed(2);
  });
  const e12 = ema(prices, 12);
  const e26 = ema(prices, 26);
  const macd = prices.map((_, i) => +(e12[i] - e26[i]).toFixed(2));
  const signalLine = ema(macd, 9);
  const hist = macd.map((m, i) => +(m - signalLine[i]).toFixed(2));

  let obv = 0;
  let prevSignal = null;

  const eps = Number(ttm?.eps ?? annual?.at(-1)?.eps ?? null);
  const bps = Number(ttm?.bps ?? annual?.at(-1)?.bps ?? null);
  const fcfps = Number(ttm?.fcf_per_share ?? null);

  return monthly.map((d, i) => {
    const prev = monthly[i - 1];
    if (i > 0) {
      obv += d.price > prev.price ? (d.volume || 0) : d.price < prev.price ? -(d.volume || 0) : 0;
    }
    const gap60 = ma60s[i] ? +(((Number(d.price) / ma60s[i]) - 1) * 100).toFixed(2) : null;
    let rawSignal = null;
    if (gap60 !== null) {
      if (gap60 <= -20) rawSignal = "강력매수";
      else if (gap60 <= 0) rawSignal = "매수";
      else if (gap60 >= 300) rawSignal = "초강력매도";
      else if (gap60 >= 200) rawSignal = "강력매도";
      else if (gap60 >= 100) rawSignal = "매도";
    }
    const pointSignal = rawSignal && rawSignal !== prevSignal ? rawSignal : null;
    prevSignal = rawSignal || prevSignal;

    return {
      ...d,
      ma60: ma60s[i],
      gap60,
      signal: pointSignal,
      macd: macd[i],
      macdSignal: signalLine[i],
      hist: hist[i],
      obv,
      perLo: Number.isFinite(eps) ? Math.round(eps * 7) : null,
      perMid: Number.isFinite(eps) ? Math.round(eps * 13) : null,
      perHi: Number.isFinite(eps) ? Math.round(eps * 20) : null,
      pbrLo: Number.isFinite(bps) ? Math.round(bps * 1.0) : null,
      pbrHi: Number.isFinite(bps) ? Math.round(bps * 3.5) : null,
      epsLine: Number.isFinite(eps) ? eps : null,
      fcfLine: Number.isFinite(fcfps) ? fcfps : null,
    };
  });
}

export function dcf(ttmFcf, shares, growth, discount, terminal) {
  if (!Number.isFinite(ttmFcf) || !Number.isFinite(shares) || shares <= 0) return null;
  const g = growth / 100, r = discount / 100, t = terminal / 100;
  if (r <= t) return null;
  let cf = Number(ttmFcf), pv = 0;
  for (let year = 1; year <= 10; year++) {
    cf *= (1 + g);
    pv += cf / Math.pow(1 + r, year);
  }
  const tv = (cf * (1 + t)) / (r - t);
  const fairMarketCap = pv + tv / Math.pow(1 + r, 10);
  return { fairMarketCap, fairPrice: fairMarketCap / shares };
}

export function gapToFair(current, fairPrice) {
  if (!Number.isFinite(current) || !Number.isFinite(fairPrice) || fairPrice === 0) return null;
  return +(((current / fairPrice) - 1) * 100).toFixed(2);
}

export function fScore(input) {
  const items = [
    ["ROA > 0", input?.roa > 0],
    ["ΔROA > 0", input?.droa > 0],
    ["CFO > 0", input?.cfo > 0],
    ["발생액 < 0", input?.accrual < 0],
    ["레버리지 감소", input?.lever < 0],
    ["유동성 개선", input?.liquid > 0],
    ["주식 미발행", input?.dilution <= 0],
    ["총이익률 개선", input?.gross > 0],
    ["자산회전율 개선", input?.ato > 0],
  ].map(([name, ok]) => ({ name, ok: !!ok }));
  return { items, total: items.filter(x => x.ok).length };
}

export function judgement(gap60, fairGapPct) {
  if (gap60 !== null && gap60 <= -20 && fairGapPct !== null && fairGapPct <= -20) return "강력 매수 후보";
  if (gap60 !== null && gap60 <= 0 && fairGapPct !== null && fairGapPct <= 10) return "매수 접근 가능";
  if (gap60 !== null && gap60 >= 300) return "초강력 매도 경계";
  if (gap60 !== null && gap60 >= 200) return "강력 매도 경계";
  if (gap60 !== null && gap60 >= 100) return "차익 실현 구간";
  return "중립 관찰 구간";
}
