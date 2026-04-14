import { addMa60AndGap } from './utils';
import { QuoteData } from './types';

function normalizeYahooSymbol(symbol: string) {
  if (symbol.endsWith('.KS') || symbol.endsWith('.KQ')) return symbol;
  if (/^\d{6}$/.test(symbol)) return `${symbol}.KS`;
  return symbol;
}

export async function fetchYahooQuote(symbol: string): Promise<QuoteData> {
  const normalized = normalizeYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${normalized}?interval=1d&range=5d`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error('Yahoo 시세 조회 실패');
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  const close = meta?.regularMarketPrice;
  const prev = meta?.chartPreviousClose;
  const change = close - prev;
  const changePercent = prev ? (change / prev) * 100 : 0;

  return {
    source: 'yahoo',
    symbol: normalized,
    name: meta?.instrumentType || normalized,
    price: close,
    change,
    changePercent,
    currency: meta?.currency || 'KRW',
    marketState: meta?.marketState,
    asOf: new Date().toISOString(),
  };
}

export async function fetchYahooMonthlyBars(symbol: string) {
  const normalized = normalizeYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${normalized}?interval=1mo&range=10y&includeAdjustedClose=true`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error('Yahoo 월봉 조회 실패');
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp || [];
  const closes: number[] = result?.indicators?.quote?.[0]?.close || [];

  const bars = timestamps
    .map((ts, idx) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: Number(closes[idx]),
    }))
    .filter((row) => Number.isFinite(row.close));

  return addMa60AndGap(bars);
}
