import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

export type CorpMapRow = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  modify_date: string;
};

type CacheState = { rows: CorpMapRow[]; fetchedAt: number } | null;
let cache: CacheState = null;
const TTL = 1000 * 60 * 60 * 12;

function normalizeText(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

export async function fetchCorpMap(): Promise<CorpMapRow[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL) return cache.rows;

  const key = process.env.DART_API_KEY;
  if (!key) throw new Error('DART_API_KEY is missing');
  const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`corpCode.xml download failed: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const xmlEntry = zip.getEntries().find((entry: any) => entry.entryName.endsWith('.xml'));
  if (!xmlEntry) throw new Error('Invalid corpCode.xml ZIP');

  const xml = xmlEntry.getData().toString('utf8');
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const list = parsed?.result?.list ?? [];
  const rows = (Array.isArray(list) ? list : [list]).map((r: any) => ({
    corp_code: String(r.corp_code || '').trim(),
    corp_name: String(r.corp_name || '').trim(),
    stock_code: String(r.stock_code || '').trim(),
    modify_date: String(r.modify_date || '').trim(),
  })).filter((r: CorpMapRow) => r.corp_code.length === 8 && r.stock_code.length === 6);

  cache = { rows, fetchedAt: Date.now() };
  return rows;
}

export function searchCorpMap(rows: CorpMapRow[], query: string) {
  const raw = query.trim();
  const q = normalizeText(raw);
  if (!q) return [];

  const exactStock = rows.filter((r) => r.stock_code === raw);
  const exactName = rows.filter((r) => normalizeText(r.corp_name) === q);
  const partial = rows.filter((r) => normalizeText(r.corp_name).includes(q) || r.stock_code.includes(raw));

  const merged = [...exactStock, ...exactName, ...partial];
  const seen = new Set<string>();
  return merged.filter((row) => {
    const key = `${row.corp_code}-${row.stock_code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

export async function getCorpByStockCode(stockCode: string) {
  const rows = await fetchCorpMap();
  return rows.find((row) => row.stock_code === stockCode) || null;
}
