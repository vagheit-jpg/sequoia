export const calcDCF_rate = ({ fcf, gr, dr, shares }) => {
  if (!fcf || !shares || shares <= 0) return 0;
  let pv = 0, cf = fcf;
  for (let y = 1; y <= 10; y++) {
    cf *= (1 + gr);
    pv += cf / Math.pow(1 + dr, y);
  }
  const tv = (cf * (1 + 0.03) / (dr - 0.03)) / Math.pow(1 + dr, 10);
  return Math.round((pv + tv) / shares);
};

export const calcDCF_graham = ({ eps, gr, bondYield }) => {
  if (!eps || bondYield <= 0) return 0;
  return Math.round(eps * (8.5 + 2 * gr * 100) * (4.4 / bondYield));
};

export const calcDCF_roe = ({ roe, eps }) => {
  if (!roe || !eps || roe <= 0) return 0;
  return Math.round(roe * eps);
};

export const calcOwnerEarnings = ({ net, cfo, cfi, capex, capexRatio = 50 }) => {
  if (!net || !cfo) return null;
  const depEst = cfo - net;
  const totalCapex = capex ? Math.abs(capex) : cfi < 0 ? Math.abs(cfi) * 0.7 : 0;
  const maintCapex = totalCapex * (capexRatio / 100);
  return net + depEst - maintCapex;
};

export const calcDCF_owner = ({ net, cfo, cfi, capex, capexRatio, gr, dr, shares }) => {
  const oe = calcOwnerEarnings({ net, cfo, cfi, capex, capexRatio });
  if (!oe || oe <= 0 || !shares || shares <= 0) return 0;
  let pv = 0, cf = oe;
  for (let y = 1; y <= 10; y++) {
    cf *= (1 + gr);
    pv += cf / Math.pow(1 + dr, y);
  }
  const tv = (cf * (1 + 0.03) / (dr - 0.03)) / Math.pow(1 + dr, 10);
  return Math.round((pv + tv) / shares);
};

export const buildDCFHistory = (annData, gr, dr, bondYield, capexRatio) => {
  if (!annData?.length) return [];

  return annData.filter(r => r.shares && r.year).map(r => {
    const sh = r.shares / 1e8;
    const owner = calcDCF_owner({ net: r.net, cfo: r.cfo, cfi: r.cfi, capex: r.capex, capexRatio, gr, dr, shares: sh });
    const rate = r.fcf ? calcDCF_rate({ fcf: r.fcf, gr, dr, shares: sh }) : 0;
    const graham = calcDCF_graham({ eps: r.eps, gr, bondYield });
    const roe = calcDCF_roe({ roe: r.roe, eps: r.eps });

    return {
      year: r.year,
      fcf: r.fcf || null,
      owner: owner > 0 ? owner : null,
      rate: rate > 0 ? rate : null,
      graham: graham > 0 ? graham : null,
      roe: roe > 0 ? roe : null,
    };
  });
};

export const calcReverseDCF = ({ price, eps, dr }) => {
  if (!price || !eps || eps <= 0 || dr <= 0) return null;

  let lo = -0.5, hi = 1.0;
  for (let i = 0; i < 60; i++) {
    const g = (lo + hi) / 2;
    if (dr - g <= 0.001) {
      hi = g;
      continue;
    }

    let pv = 0, cf = eps;
    for (let y = 1; y <= 10; y++) {
      cf *= (1 + g);
      pv += cf / Math.pow(1 + dr, y);
    }

    const tv = (cf * (1 + 0.02) / (dr - 0.02)) / Math.pow(1 + dr, 10);
    if (pv + tv > price) hi = g;
    else lo = g;
  }

  return +((lo + hi) / 2 * 100).toFixed(1);
};
