import { FinancialPayload } from './types';

export type DcfInputs = {
  discountRate: number;
  terminalGrowthRate: number;
  fcfGrowth5y: number;
  sharesOutstanding: number;
  netCashEok?: number;
};

export function runDcf(financials: FinancialPayload | null, inputs: DcfInputs) {
  const annual = financials?.annual ?? [];
  const latest = annual[annual.length - 1];
  const baseFcf = latest?.fcf ?? 0;
  if (!baseFcf || !inputs.sharesOutstanding) return [];

  const templates = [
    { name: '보수적', growthAdj: -2, discountAdj: 1 },
    { name: '기본', growthAdj: 0, discountAdj: 0 },
    { name: '낙관적', growthAdj: 2, discountAdj: -1 },
  ];

  return templates.map((tpl) => {
    const growth = (inputs.fcfGrowth5y + tpl.growthAdj) / 100;
    const discount = (inputs.discountRate + tpl.discountAdj) / 100;
    const terminalGrowth = inputs.terminalGrowthRate / 100;
    let pv = 0;
    let fcf = baseFcf;

    for (let year = 1; year <= 5; year += 1) {
      fcf *= 1 + growth;
      pv += fcf / Math.pow(1 + discount, year);
    }

    const terminalValue = discount <= terminalGrowth ? 0 : (fcf * (1 + terminalGrowth)) / (discount - terminalGrowth);
    const terminalPv = terminalValue / Math.pow(1 + discount, 5);
    const equityValue = pv + terminalPv + (inputs.netCashEok ?? 0);
    const perShareValue = Math.round((equityValue * 100000000) / inputs.sharesOutstanding);

    return {
      name: tpl.name,
      intrinsicValue: Math.round(equityValue),
      perShareValue,
    };
  });
}
