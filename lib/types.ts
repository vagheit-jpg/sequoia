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

export type SearchItem = {
  name: string;
  stockCode: string;
  corpCode: string;
  modifyDate: string;
};

export type FinancialRow = {
  period: string;
  reportName: string;
  reportCode: string;
  rceptNo: string | null;
  source: 'OpenDART';
  fsDiv: 'CFS' | 'OFS' | null;
  fetchedAt: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  totalEquity: number | null;
  totalLiabilities: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  fcf: number | null;
  eps: number | null;
  roe: number | null;
  debtRatio: number | null;
  currentRatio: number | null;
  status: 'verified' | 'fallback' | 'partial';
};

export type FinancialPayload = {
  symbol: string;
  corpCode: string;
  companyName: string;
  annual: FinancialRow[];
  quarterly: FinancialRow[];
  meta: {
    source: 'OpenDART';
    fetchedAt: string;
    fallback: boolean;
    note?: string;
  };
};

export type DcfScenario = {
  name: string;
  intrinsicValue: number;
  perShareValue: number;
};
