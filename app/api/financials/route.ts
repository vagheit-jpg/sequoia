import { NextRequest, NextResponse } from 'next/server';
import { readFinancialCache, scrapeFnGuideFinancials } from '@/lib/financials';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') || '005930').replace(/[^0-9]/g, '');

  try {
    const cached = await readFinancialCache(symbol);
    return NextResponse.json({ source: 'cache', ...cached });
  } catch {
    const scraped = await scrapeFnGuideFinancials(symbol);
    return NextResponse.json({ source: 'fnguide', ...scraped });
  }
}
