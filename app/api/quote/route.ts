import { NextRequest, NextResponse } from 'next/server';
import { fetchKiwoomQuote } from '@/lib/kiwoom';
import { fetchYahooQuote } from '@/lib/yahoo';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') || '005930';

  try {
    if (process.env.USE_KIWOOM_QUOTE === 'true') {
      return NextResponse.json(await fetchKiwoomQuote(symbol));
    }
  } catch {
    // fall through
  }

  return NextResponse.json(await fetchYahooQuote(symbol));
}
