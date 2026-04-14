import { FinancialPayload, FinancialRow } from '../types';
import { dartGetJson } from './client';
import { getCorpByStockCode } from './corp-map';
import { listRecentReports, ReportMeta } from './reports';

type DartAccountRow = {
  rcept_no: string;
  reprt_code: string;
  bsns_year: string;
  stock_code: string;
  account_nm: string;
  fs_div: 'CFS' | 'OFS';
  sj_div: string;
  thstrm_amount?: string;
  thstrm_add_amount?: string;
};

type DartAccountResponse = {
  status: string;
  message: string;
  list?: DartAccountRow[];
};

const ALIAS = {
  revenue: ['매출액', '영업수익', '수익(매출액)', '보험료수익'],
  operatingProfit: ['영업이익'],
  netIncome: ['당기순이익', '분기순이익', '반기순이익', '연결당기순이익'],
  totalEquity: ['자본총계'],
  totalLiabilities: ['부채총계'],
  currentAssets: ['유동자산'],
  currentLiabilities: ['유동부채'],
  operatingCashFlow: ['영업활동으로 인한 현금흐름', '영업활동현금흐름'],
  capexPpe: ['유형자산의 취득'],
  capexIntangible: ['무형자산의 취득'],
  eps: ['기본주당이익', '희석주당이익', '주당순이익'],
} as const;

function toNum(value?: string) {
  if (!value) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pickAccount(rows: DartAccountRow[], aliases: readonly string[]) {
  return rows.find((row) => aliases.includes(row.account_nm.trim()));
}

function pickFlowValue(rows: DartAccountRow[], aliases: readonly string[]) {
  const row = pickAccount(rows, aliases);
  const cumulative = toNum(row?.thstrm_add_amount);
  if (cumulative !== null) return cumulative;
  return toNum(row?.thstrm_amount);
}

function pickBalanceValue(rows: DartAccountRow[], aliases: readonly string[]) {
  const row = pickAccount(rows, aliases);
  return toNum(row?.thstrm_amount);
}

function chooseFsRows(rows: DartAccountRow[]) {
  const cfs = rows.filter((row) => row.fs_div === 'CFS');
  if (cfs.length) return { rows: cfs, fsDiv: 'CFS' as const };
  const ofs = rows.filter((row) => row.fs_div === 'OFS');
  return { rows: ofs, fsDiv: ofs.length ? ('OFS' as const) : null };
}

function buildRawReport(meta: ReportMeta, rows: DartAccountRow[]) {
  const chosen = chooseFsRows(rows);
  const base = chosen.rows;
  const operatingCashFlow = pickFlowValue(base, ALIAS.operatingCashFlow);
  const capexPpe = pickFlowValue(base, ALIAS.capexPpe);
  const capexIntangible = pickFlowValue(base, ALIAS.capexIntangible);
  const capex = [capexPpe, capexIntangible].reduce<number | null>((acc, cur) => {
    if (cur === null) return acc;
    return (acc ?? 0) + Math.abs(cur);
  }, null);
  return {
    period: `${meta.year}`,
    reportName: meta.reportName,
    reportCode: meta.reprtCode,
    rceptNo: meta.rceptNo,
    source: 'OpenDART' as const,
    fsDiv: chosen.fsDiv,
    fetchedAt: new Date().toISOString(),
    revenue: pickFlowValue(base, ALIAS.revenue),
    operatingProfit: pickFlowValue(base, ALIAS.operatingProfit),
    netIncome: pickFlowValue(base, ALIAS.netIncome),
    totalEquity: pickBalanceValue(base, ALIAS.totalEquity),
    totalLiabilities: pickBalanceValue(base, ALIAS.totalLiabilities),
    currentAssets: pickBalanceValue(base, ALIAS.currentAssets),
    currentLiabilities: pickBalanceValue(base, ALIAS.currentLiabilities),
    operatingCashFlow,
    capex,
    eps: pickFlowValue(base, ALIAS.eps),
  };
}

function finalizeRow(row: Omit<FinancialRow, 'fcf' | 'roe' | 'debtRatio' | 'currentRatio' | 'status'> & { operatingCashFlow: number | null; capex: number | null; }) : FinancialRow {
  const roe = row.netIncome !== null && row.totalEquity ? (row.netIncome / row.totalEquity) * 100 : null;
  const debtRatio = row.totalLiabilities !== null && row.totalEquity ? (row.totalLiabilities / row.totalEquity) * 100 : null;
  const currentRatio = row.currentAssets !== null && row.currentLiabilities ? (row.currentAssets / row.currentLiabilities) * 100 : null;
  const fcf = row.operatingCashFlow !== null && row.capex !== null ? row.operatingCashFlow - row.capex : null;
  const missingCore = [row.revenue, row.operatingProfit, row.netIncome].some((v) => v === null);
  const status = row.fsDiv === 'CFS' && !missingCore ? 'verified' : row.fsDiv === 'OFS' ? 'fallback' : 'partial';
  return { ...row, fcf, roe, debtRatio, currentRatio, status };
}

async function fetchSingleAccount(corpCode: string, year: number, reprtCode: string) {
  const data = await dartGetJson<DartAccountResponse>('fnlttSinglAcnt.json', {
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: reprtCode,
  });
  if (data.status === '013') return null;
  if (data.status !== '000') throw new Error(`DART fnlttSinglAcnt failed: ${data.status} ${data.message}`);
  return data.list ?? [];
}

function subtractDelta(curr: number | null, prev: number | null) {
  if (curr === null) return null;
  if (prev === null) return curr;
  return curr - prev;
}

function convertQuarterFlow(rawRows: ReturnType<typeof buildRawReport>[]) {
  const q1 = rawRows.find((row) => row.reportCode === '11013');
  const q2cum = rawRows.find((row) => row.reportCode === '11012');
  const q3cum = rawRows.find((row) => row.reportCode === '11014');
  const q4cum = rawRows.find((row) => row.reportCode === '11011');
  const out: FinancialRow[] = [];

  const makeQuarter = (base: ReturnType<typeof buildRawReport>, quarter: string, revenue: number | null, operatingProfit: number | null, netIncome: number | null, operatingCashFlow: number | null, capex: number | null, eps: number | null) => finalizeRow({
    ...base,
    period: `${base.period}Q${quarter}`,
    revenue,
    operatingProfit,
    netIncome,
    operatingCashFlow,
    capex,
    eps,
  });

  if (q1) out.push(makeQuarter(q1, '1', q1.revenue, q1.operatingProfit, q1.netIncome, q1.operatingCashFlow, q1.capex, q1.eps));
  if (q2cum) out.push(makeQuarter(q2cum, '2', subtractDelta(q2cum.revenue, q1?.revenue ?? null), subtractDelta(q2cum.operatingProfit, q1?.operatingProfit ?? null), subtractDelta(q2cum.netIncome, q1?.netIncome ?? null), subtractDelta(q2cum.operatingCashFlow, q1?.operatingCashFlow ?? null), subtractDelta(q2cum.capex, q1?.capex ?? null), subtractDelta(q2cum.eps, q1?.eps ?? null)));
  if (q3cum) out.push(makeQuarter(q3cum, '3', subtractDelta(q3cum.revenue, q2cum?.revenue ?? q1?.revenue ?? null), subtractDelta(q3cum.operatingProfit, q2cum?.operatingProfit ?? q1?.operatingProfit ?? null), subtractDelta(q3cum.netIncome, q2cum?.netIncome ?? q1?.netIncome ?? null), subtractDelta(q3cum.operatingCashFlow, q2cum?.operatingCashFlow ?? q1?.operatingCashFlow ?? null), subtractDelta(q3cum.capex, q2cum?.capex ?? q1?.capex ?? null), subtractDelta(q3cum.eps, q2cum?.eps ?? q1?.eps ?? null)));
  if (q4cum) out.push(makeQuarter(q4cum, '4', subtractDelta(q4cum.revenue, q3cum?.revenue ?? q2cum?.revenue ?? q1?.revenue ?? null), subtractDelta(q4cum.operatingProfit, q3cum?.operatingProfit ?? q2cum?.operatingProfit ?? q1?.operatingProfit ?? null), subtractDelta(q4cum.netIncome, q3cum?.netIncome ?? q2cum?.netIncome ?? q1?.netIncome ?? null), subtractDelta(q4cum.operatingCashFlow, q3cum?.operatingCashFlow ?? q2cum?.operatingCashFlow ?? q1?.operatingCashFlow ?? null), subtractDelta(q4cum.capex, q3cum?.capex ?? q2cum?.capex ?? q1?.capex ?? null), subtractDelta(q4cum.eps, q3cum?.eps ?? q2cum?.eps ?? q1?.eps ?? null)));

  return out;
}

export async function fetchFinancialPayload(stockCode: string, corpCode?: string | null): Promise<FinancialPayload> {
  const corpFromMap = await getCorpByStockCode(stockCode);
  const corp = corpFromMap || (corpCode ? { corp_code: corpCode, corp_name: stockCode, stock_code: stockCode, modify_date: '' } : null);
  if (!corp) throw new Error('stockCode에 해당하는 corpCode를 찾지 못했습니다.');
  const reports = await listRecentReports(corp.corp_code);
  const sortedReports = [...reports].sort((a, b) => (b.year - a.year) || Number(b.reprtCode) - Number(a.reprtCode));

  const annualReports = sortedReports.filter((r) => r.reprtCode === '11011').slice(0, 5).sort((a, b) => a.year - b.year);
  const recentQuarterYears = Array.from(new Set(sortedReports.map((r) => r.year))).sort((a, b) => b - a).slice(0, 3);
  const quarterReports = recentQuarterYears.flatMap((year) => ['11013', '11012', '11014', '11011'].map((code) => sortedReports.find((r) => r.year === year && r.reprtCode === code)).filter(Boolean) as ReportMeta[]).slice(0, 12);

  const annual: FinancialRow[] = [];
  for (const meta of annualReports) {
    const rows = await fetchSingleAccount(corp.corp_code, meta.year, meta.reprtCode);
    if (!rows?.length) continue;
    const raw = buildRawReport(meta, rows);
    annual.push(finalizeRow(raw));
  }

  let quarterly: FinancialRow[] = [];
  for (const year of recentQuarterYears.sort((a, b) => a - b)) {
    const metas = quarterReports.filter((r) => r.year === year);
    const rawRows: ReturnType<typeof buildRawReport>[] = [];
    for (const meta of metas) {
      const rows = await fetchSingleAccount(corp.corp_code, meta.year, meta.reprtCode);
      if (!rows?.length) continue;
      rawRows.push(buildRawReport(meta, rows));
    }
    quarterly.push(...convertQuarterFlow(rawRows));
  }
  quarterly = quarterly.slice(-12);

  return {
    symbol: stockCode,
    corpCode: corp.corp_code,
    companyName: corp.corp_name,
    annual,
    quarterly,
    meta: {
      source: 'OpenDART',
      fetchedAt: new Date().toISOString(),
      fallback: annual.some((r) => r.status !== 'verified') || quarterly.some((r) => r.status !== 'verified'),
      note: 'OpenDART fresh fetch 우선',
    },
  };
}
