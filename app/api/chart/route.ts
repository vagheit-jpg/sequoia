import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooMonthlyBars } from '@/lib/yahoo';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') || '005930';
  const rows = await fetchYahooMonthlyBars(symbol);
  return NextResponse.json({ symbol, rows });
}
