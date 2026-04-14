import { MonthlyBar } from './types';

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(value));
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, digits)}%`;
}

export function formatWon(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${formatNumber(value)}원`;
}

export function formatEok(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${formatNumber(value)}억원`;
}

export function getGapSignal(gapPercent: number | null | undefined) {
  if (gapPercent === null || gapPercent === undefined || Number.isNaN(Number(gapPercent))) {
    return { label: '중립', tone: 'neutral' as const };
  }
  if (gapPercent <= -20) return { label: '강력매수', tone: 'buyStrong' as const };
  if (gapPercent <= 0) return { label: '매수', tone: 'buy' as const };
  if (gapPercent >= 300) return { label: '초강력매도', tone: 'sellExtreme' as const };
  if (gapPercent >= 200) return { label: '강력매도', tone: 'sellStrong' as const };
  if (gapPercent >= 100) return { label: '매도', tone: 'sell' as const };
  return { label: '중립', tone: 'neutral' as const };
}

export function rollingAverage(values: number[], window: number) {
  return values.map((_, idx) => {
    if (idx + 1 < window) return null;
    const slice = values.slice(idx - window + 1, idx + 1);
    return slice.reduce((sum, v) => sum + v, 0) / window;
  });
}

export function addMa60AndGap(rows: Array<{ date: string; close: number }>): MonthlyBar[] {
  const closes = rows.map((row) => row.close);
  const ma60 = rollingAverage(closes, 60);
  return rows.map((row, idx) => ({
    date: row.date,
    close: row.close,
    ma60: ma60[idx],
    gap60: ma60[idx] ? ((row.close - ma60[idx]!) / ma60[idx]!) * 100 : null,
  }));
}

export function latest<T>(rows: T[]) {
  return rows.length ? rows[rows.length - 1] : null;
}
