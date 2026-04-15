export const config = { maxDuration: 25 };

const DART_BASE = 'https://opendart.fss.or.kr/api';

async function dartFetch(endpoint, params, apiKey) {
  const qs = new URLSearchParams({ crtfc_key: apiKey, ...params }).toString();
  const response = await fetch(`${DART_BASE}/${endpoint}?${qs}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (data?.status !== undefined) return data.status === '000' ? data : null;
  return data;
}

async function fetchFinancial(params, apiKey) {
  const tries = [
    { fs_div: 'CFS', endpoint: 'fnlttSinglAcntAll.json' },
    { fs_div: 'OFS', endpoint: 'fnlttSinglAcntAll.json' },
    { fs_div: 'CFS', endpoint: 'fnlttMultiAcnt.json' },
    { fs_div: 'OFS', endpoint: 'fnlttMultiAcnt.json' },
  ];

  for (const item of tries) {
    const data = await dartFetch(item.endpoint, { ...params, fs_div: item.fs_div }, apiKey);
    if (data?.list?.length) return data;
  }
  return null;
}

function amountToEok(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw || raw === '-') return null;
  const num = Number.parseInt(raw, 10);
  return Number.isFinite(num) ? Math.round(num / 1e8) : null;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, '').trim().toLowerCase();
}

function matchAccount(row, ids = [], names = []) {
  const accountId = normalize(row.account_id);
  const accountName = normalize(row.account_nm);
  return ids.some((id) => normalize(id) === accountId)
    || names.some((name) => accountName.includes(normalize(name)) || normalize(name).includes(accountName));
}

function pickAmount(list, sjDivs, ids = [], names = []) {
  const rows = list.filter((row) => sjDivs.includes(row.sj_div));
  const preferred = [
    ...rows.filter((row) => row.fs_div === 'CFS' || String(row.fs_nm || '').includes('연결')),
    ...rows,
  ];

  for (const row of preferred) {
    if (matchAccount(row, ids, names)) {
      const amount = amountToEok(row.thstrm_amount ?? row.thstrm_add_amount ?? row.frmtrm_amount);
      if (amount != null) return amount;
    }
  }
  return null;
}

function parseAnnualRow(list, year) {
  if (!list?.length) return null;

  const revenue = pickAmount(
    list,
    ['IS', 'CIS'],
    ['ifrs-full_Revenue', 'ifrs_Revenue', 'dart_Revenue'],
    ['매출액', '수익(매출액)', '영업수익', '수익'],
  );
  if (revenue == null) return null;

  const operatingIncome = pickAmount(
    list,
    ['IS', 'CIS'],
    ['dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'],
    ['영업이익', '영업손익'],
  ) ?? 0;

  const netIncome = pickAmount(
    list,
    ['IS', 'CIS'],
    [
      'ifrs-full_ProfitLoss',
      'ifrs-full_ProfitLossAttributableToOwnersOfParent',
      'dart_ProfitLossAttributableToOwnersOfParentEntity',
    ],
    ['당기순이익', '당기순이익(손실)', '반기순이익', '분기순이익', '연결당기순이익'],
  ) ?? 0;

  const equity = pickAmount(
    list,
    ['BS'],
    ['ifrs-full_Equity', 'ifrs-full_EquityAttributableToOwnersOfParent'],
    ['자본총계', '자본합계'],
  );

  return {
    year,
    revenue,
    operatingIncome,
    netIncome,
    equity,
  };
}

async function handleFinancials(corpCode, apiKey) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, index) => currentYear - 1 - index);
  const results = await Promise.all(
    years.map((year) => fetchFinancial({ corp_code: corpCode, bsns_year: String(year), reprt_code: '11011' }, apiKey)),
  );

  return results
    .map((data, index) => (data?.list ? parseAnnualRow(data.list, years[index]) : null))
    .filter(Boolean)
    .sort((a, b) => a.year - b.year);
}

async function handleCompany(corpCode, apiKey) {
  const data = await dartFetch('company.json', { corp_code: corpCode }, apiKey);
  if (!data) return null;

  const shares = Number.parseInt(String(data.stock_tot_co || data.isu_stock_totqy || '0').replace(/,/g, ''), 10) || 0;
  return {
    ok: true,
    shares,
    name: data.corp_name || '',
    ceo: data.ceo_nm || '-',
    sector: data.induty_code_nm || data.induty_code || '',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'DART_API_KEY 미설정' });

  const { ep, corp_code } = req.query;

  try {
    if (ep === 'company') {
      if (!corp_code) return res.status(400).json({ error: 'corp_code 필요' });
      const company = await handleCompany(corp_code, apiKey);
      return res.status(200).json(company || { ok: false, shares: 0 });
    }

    if (ep === 'financials') {
      if (!corp_code) return res.status(400).json({ error: 'corp_code 필요' });
      const annualData = await handleFinancials(corp_code, apiKey);
      return res.status(200).json({ ok: true, annualData });
    }

    return res.status(400).json({ error: '지원하지 않는 ep' });
  } catch (error) {
    return res.status(500).json({ error: 'DART 처리 중 오류', detail: error.message });
  }
}
