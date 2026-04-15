export function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('ko-KR');
}

export function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${formatNumber(Math.round(Number(value)))}원`;
}

export function formatPercent(value, digits = 1, withSign = false) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const number = Number(value);
  const prefix = withSign && number > 0 ? '+' : '';
  return `${prefix}${number.toFixed(digits)}%`;
}

export function formatCompactEok(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const number = Number(value);
  if (Math.abs(number) >= 10000) {
    return `${(number / 10000).toFixed(2)}조`;
  }
  return `${formatNumber(number)}억`;
}

export function formatMarketCapFromWon(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const won = Number(value);
  const eok = won / 1e8;
  if (Math.abs(eok) >= 10000) {
    return `${(eok / 10000).toFixed(2)}조`;
  }
  return `${Math.round(eok).toLocaleString('ko-KR')}억`;
}

export function formatMultiple(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(digits)}배`;
}

export function formatStatus(value) {
  if (!value) return 'idle';
  return value;
}
