const sqClamp = (v, min, max) => Math.min(max, Math.max(min, v));

const sqNum = (v, d = 2) =>
  Number.isFinite(Number(v)) ? +Number(v).toFixed(d) : null;
