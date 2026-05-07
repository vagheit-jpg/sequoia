export const ema = (arr, n) => {
  const k = 2 / (n + 1);
  let e = arr[0];

  return arr.map((v, i) => {
    if (i === 0) return e;

    e = v * k + e * (1 - k);

    return +e.toFixed(2);
  });
};
