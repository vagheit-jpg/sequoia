import { ema } from "./mathEngine";

export const calcMACD = (monthly) => {
  const cl = monthly.map((d) => d.price);
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

export const calcRSI = (monthly, n = 14) =>
  monthly.map((d, i) => {
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
      rsi: +(l === 0 ? 100 : 100 - 100 / (1 + g / l)).toFixed(1),
    };
  });

export const calcOBV = (monthly) => {
  let obv = 0;

  return monthly.map((d, i) => {
    if (i === 0) return { ...d, obv: 0 };

    obv +=
      d.price > monthly[i - 1].price
        ? d.volume
        : d.price < monthly[i - 1].price
          ? -d.volume
          : 0;

    return { ...d, obv };
  });
};

export const calcMFI = (monthly, n = 14) =>
  monthly.map((d, i) => {
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
      mfi: +(neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)).toFixed(1),
    };
  });

export const calcMA60 = (monthly) => {
  const len = monthly.length;
  const N = len >= 60 ? 60 : len >= 15 ? 15 : len >= 3 ? len : 0;

  if (N === 0) {
    return monthly.map((d) => ({ ...d, ma60: null, gap60: null }));
  }

  return monthly.map((d, i) => {
    if (i < N - 1) return { ...d, ma60: null, gap60: null };

    const avg = monthly
      .slice(i - N + 1, i + 1)
      .reduce((s, x) => s + x.price, 0) / N;

    return {
      ...d,
      ma60: +avg.toFixed(0),
      gap60: +((d.price / avg - 1) * 100).toFixed(2),
    };
  });
};

export const calcMAN = (monthly, N) => {
  if (!monthly || monthly.length < N) return null;

  const slice = monthly.slice(-N);
  return Math.round(slice.reduce((s, x) => s + x.price, 0) / N);
};

export const calcSignalPoints = (data) => {
  const pts = [];

  data.forEach((d, i) => {
    if (d.gap60 === null || d.ma60 === null) return;

    const prev = i > 0 ? data[i - 1] : null;
    if (!prev || prev.gap60 === null) return;

    if (prev.gap60 > -20 && d.gap60 <= -20) {
      pts.push({ label: d.label, price: d.price, type: "적극매수", color: "#00C878", arrow: "▲", pos: "bottom" });
    } else if (prev.gap60 > 0 && d.gap60 <= 0) {
      pts.push({ label: d.label, price: d.price, type: "매수", color: "#10A898", arrow: "▲", pos: "bottom" });
    } else if (prev.gap60 < 100 && d.gap60 >= 100) {
      pts.push({ label: d.label, price: d.price, type: "매도", color: "#FF7830", arrow: "▼", pos: "top" });
    } else if (prev.gap60 < 200 && d.gap60 >= 200) {
      pts.push({ label: d.label, price: d.price, type: "적극매도", color: "#FF3D5A", arrow: "▼", pos: "top" });
    } else if (prev.gap60 < 300 && d.gap60 >= 300) {
      pts.push({ label: d.label, price: d.price, type: "극단매도", color: "#8855FF", arrow: "▼", pos: "top" });
    }
  });

  return pts;
};

export const calcPositionBands = (monthly) => {
  if (!monthly || monthly.length === 0) return [];

  return monthly.map((d, i) => {
    const currentWindowSize = Math.min(i + 1, 60);

    if (currentWindowSize < 3) {
      return {
        ...d,
        bFloor: null,
        bKnee: null,
        bBase: null,
        bShoulder: null,
        bTop: null,
        bPeak: null,
      };
    }

    const window = monthly.slice(
      i - currentWindowSize + 1,
      i + 1
    );

    const sum = window.reduce(
      (s, x) => s + (x.price || 0),
      0
    );

    const ma = sum / window.length;

    return {
      ...d,
      bFloor: Math.round(ma * 0.6),
      bKnee: Math.round(ma * 0.8),
      bBase: Math.round(ma * 1.0),
      bShoulder: Math.round(ma * 1.5),
      bTop: Math.round(ma * 2.0),
      bPeak: Math.round(ma * 2.5),
    };
  });
};
