import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { FinancialPayload, FinancialRow } from './types';

function toNumber(text: string | undefined) {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '').replace(/\([^)]*\)/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === 'N/A') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function findMetricRow(table: string[][], candidates: string[]) {
  return table.find((row) => candidates.some((candidate) => row[0]?.includes(candidate)));
}

function buildRows(headers: string[], matrix: string[][]): FinancialRow[] {
  const revenue = findMetricRow(matrix, ['매출액']);
  const operatingProfit = findMetricRow(matrix, ['영업이익']);
  const netIncome = findMetricRow(matrix, ['당기순이익', '지배주주순이익']);
  const eps = findMetricRow(matrix, ['EPS']);
  const fcf = findMetricRow(matrix, ['FCF']);
  const roe = findMetricRow(matrix, ['ROE']);
  const debtRatio = findMetricRow(matrix, ['부채비율']);
  const currentRatio = findMetricRow(matrix, ['유동비율']);

  return headers.map((period, idx) => ({
    period,
    revenue: toNumber(revenue?.[idx + 1]),
    operatingProfit: toNumber(operatingProfit?.[idx + 1]),
    netIncome: toNumber(netIncome?.[idx + 1]),
    eps: toNumber(eps?.[idx + 1]),
    fcf: toNumber(fcf?.[idx + 1]),
    roe: toNumber(roe?.[idx + 1]),
    debtRatio: toNumber(debtRatio?.[idx + 1]),
    currentRatio: toNumber(currentRatio?.[idx + 1]),
  }));
}

export async function readFinancialCache(symbol: string) {
  const filePath = path.join(process.cwd(), 'public', 'data', 'financials', `${symbol}.json`);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as FinancialPayload;
}

export async function scrapeFnGuideFinancials(symbol: string): Promise<FinancialPayload> {
  const url = `https://comp.fnguide.com/SVO2/ASP/SVD_Finance.asp?pGB=1&gicode=A${symbol}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://comp.fnguide.com/',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`FnGuide 조회 실패: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const companyName = $('.corp_group1 h1').first().text().trim() || symbol;
  const tables = $('table').toArray().slice(0, 8);

  const parsedTables = tables.map((table) => {
    const rows: string[][] = [];
    $(table)
      .find('tr')
      .each((_, tr) => {
        const cells = $(tr)
          .find('th,td')
          .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
          .get();
        if (cells.length) rows.push(cells);
      });
    return rows;
  });

  const annualTable = parsedTables.find((table) => table.some((r) => r.join(' ').includes('매출액')) && table.some((r) => r.join(' ').includes('/12')));
  const quarterlyTable = parsedTables.find((table) => table.some((r) => r.join(' ').includes('매출액')) && table.some((r) => r.join(' ').includes('/03')));

  if (!annualTable || !quarterlyTable) {
    throw new Error('FnGuide 테이블 구조를 해석하지 못했습니다.');
  }

  const annualHeaders = annualTable[0].slice(1, 6);
  const quarterlyHeaders = quarterlyTable[0].slice(1, 9);

  const annual = buildRows(annualHeaders, annualTable);
  const quarterly = buildRows(quarterlyHeaders, quarterlyTable);

  return {
    symbol,
    companyName,
    annual,
    quarterly,
    meta: {
      source: 'FnGuide scrape',
      updatedAt: new Date().toISOString(),
      note: 'FnGuide HTML 구조 변경 시 파서 수정 필요',
    },
  };
}
