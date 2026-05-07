import { ema } from "./mathEngine";

export const calcMACD = (monthly) => {
  const cl = monthly.map(d => d.price);

  const e12 = ema(cl, 12);
  const e26 = ema(cl, 26);

  const macd = cl.map((_, i) => +(e12[i] - e26[i]));

  const sig = ema(macd, 9);

  return monthly.map((d, i) => ({
    ...d,
    macd: macd[i],
    signal: sig[i],
    hist: +(macd[i] - sig[i]),
  }));
};

export const calcRSI = (monthly, n = 14) => monthly.map((d, i) => {
  if (i < n) return { ...d, rsi: null };

  const sl = monthly.slice(i - n + 1, i + 1);
  let g = 0;
  let l = 0;

  for (let j = 1; j < sl.length; j++) {
    const df = sl[j].price - sl[j - 1].price;
    if (df > 0) g += df;
    else l -= df;
  }

  return {
    ...d,
    rsi: +(l === 0 ? 100 : 100 - (100 / (1 + g / l / n * n))).toFixed(1),
  };
};

export const calcOBV = (monthly) => {
  let obv = 0;

  return monthly.map((d, i) => {
    if (i === 0) return { ...d, obv: 0 };

    obv += d.price > monthly[i - 1].price
      ? d.volume
      : d.price < monthly[i - 1].price
        ? -d.volume
        : 0;

    return { ...d, obv };
  });
};

export const calcMFI = (monthly, n = 14) => monthly.map((d, i) => {
  if (i < n) return { ...d, mfi: null };

  const sl = monthly.slice(i - n + 1, i + 1);
  let pos = 0;
  let neg = 0;

  sl.forEach((s, j) => {
    if (j === 0) return;

    const mfr = s.price * s.volume;
    if (s.price > sl[j - 1].price) pos += mfr;
    else neg += mfr;
  });

  return {
    ...d,
    mfi: +(neg === 0 ? 100 : 100 - (100 / (1 + pos / neg))).toFixed(1),
  };
});
