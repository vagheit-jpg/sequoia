export type QuoteData = {
  source: 'kiwoom' | 'yahoo';
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  marketState?: string;
  asOf: string;
};

export type MonthlyBar = {
  date: string;
  close: number;
  ma60: number | null;
  gap60: number | null;
};

export type FinancialRow = {
  period: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  eps: number | null;
  fcf: number | null;
  roe: number | null;
  debtRatio: number | null;
  currentRatio: number | null;
};

export type FinancialPayload = {
  symbol: string;
  companyName: string;
  annual: FinancialRow[];
  quarterly: FinancialRow[];
  meta?: {
    source?: string;
    updatedAt?: string;
    note?: string;
  };
};

export type DcfScenario = {
  name: string;
  intrinsicValue: number;
  perShareValue: number;
};
