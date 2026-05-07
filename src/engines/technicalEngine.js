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
