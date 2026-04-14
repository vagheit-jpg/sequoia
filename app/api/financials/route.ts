import { NextRequest, NextResponse } from 'next/server';
import { fetchFinancialPayload } from '@/lib/dart/financials';

export async function GET(req: NextRequest) {
  const stockCode = req.nextUrl.searchParams.get('stockCode');
  const corpCode = req.nextUrl.searchParams.get('corpCode');
  if (!stockCode) return NextResponse.json({ error: 'stockCode is required' }, { status: 400 });

  try {
    const payload = await fetchFinancialPayload(stockCode, corpCode);
    return NextResponse.json(payload);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'financial fetch failed',
      source: 'OpenDART',
      fallback: true,
      fetchedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
