import { NextRequest, NextResponse } from 'next/server';
import { fetchCorpMap, searchCorpMap } from '@/lib/dart/corp-map';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  if (!q.trim()) return NextResponse.json({ items: [] });
  try {
    const rows = await fetchCorpMap();
    const items = searchCorpMap(rows, q).map((row) => ({
      name: row.corp_name,
      stockCode: row.stock_code,
      corpCode: row.corp_code,
      modifyDate: row.modify_date,
    }));
    return NextResponse.json({ items, source: 'OpenDART corpCode.xml' });
  } catch (error: any) {
    return NextResponse.json({ items: [], error: error.message || 'search failed' }, { status: 500 });
  }
}
