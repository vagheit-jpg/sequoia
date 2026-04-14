import ClientDashboard from './components/ClientDashboard';
import { fetchKiwoomQuote } from '@/lib/kiwoom';
import { fetchYahooMonthlyBars, fetchYahooQuote } from '@/lib/yahoo';
import { readFinancialCache, scrapeFnGuideFinancials } from '@/lib/financials';
import { runDcf } from '@/lib/dcf';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams?: { symbol?: string } }) {
  const rawSymbol = searchParams?.symbol || '005930';
  const symbol = rawSymbol.replace(/[^0-9A-Za-z.]/g, '');

  const quote = await (async () => {
    try {
      if (process.env.USE_KIWOOM_QUOTE === 'true') {
        return await fetchKiwoomQuote(symbol);
      }
    } catch {
      // fall back to Yahoo
    }
    return fetchYahooQuote(symbol);
  })();

  const monthlyBars = await fetchYahooMonthlyBars(symbol);

  const financials = await (async () => {
    try {
      return await readFinancialCache(symbol.replace(/\.(KS|KQ)$/i, ''));
    } catch {
      return scrapeFnGuideFinancials(symbol.replace(/\.(KS|KQ)$/i, ''));
    }
  })();

  const dcf = runDcf(financials, {
    discountRate: Number(process.env.NEXT_PUBLIC_DCF_DISCOUNT_RATE || 10),
    terminalGrowthRate: Number(process.env.NEXT_PUBLIC_DCF_TERMINAL_GROWTH || 2),
    fcfGrowth5y: Number(process.env.NEXT_PUBLIC_DCF_FCF_GROWTH || 5),
    sharesOutstanding: Number(process.env.NEXT_PUBLIC_SHARES_OUTSTANDING || 5969782550),
    netCashEok: Number(process.env.NEXT_PUBLIC_NET_CASH_EOK || 0),
  });

  return <ClientDashboard initialSymbol={symbol} quote={quote} monthlyBars={monthlyBars} financials={financials} dcf={dcf} />;
}
