import { dartGetJson } from './client';

export type DartListItem = {
  rcept_no: string;
  report_nm: string;
  rcept_dt: string;
};

type DartListResponse = {
  status: string;
  message: string;
  list?: DartListItem[];
};

export type ReportMeta = {
  year: number;
  reprtCode: '11011' | '11012' | '11013' | '11014';
  reportName: string;
  rceptNo: string;
  rceptDt: string;
};

const CODE_META = {
  '11011': '사업보고서',
  '11012': '반기보고서',
  '11013': '1분기보고서',
  '11014': '3분기보고서',
} as const;

function detectReportCode(reportNm: string): ReportMeta['reprtCode'] | null {
  if (reportNm.includes('사업보고서')) return '11011';
  if (reportNm.includes('반기보고서')) return '11012';
  if (reportNm.includes('1분기보고서')) return '11013';
  if (reportNm.includes('3분기보고서')) return '11014';
  return null;
}

function detectYear(reportNm: string, rceptDt: string) {
  const direct = reportNm.match(/(20\d{2})/);
  if (direct) return Number(direct[1]);
  return Number(String(rceptDt).slice(0, 4));
}

export async function listRecentReports(corpCode: string) {
  const now = new Date();
  const end = now.toISOString().slice(0, 10).replaceAll('-', '');
  const start = `${now.getFullYear() - 6}0101`;
  const data = await dartGetJson<DartListResponse>('list.json', {
    corp_code: corpCode,
    bgn_de: start,
    end_de: end,
    last_reprt_at: 'Y',
    page_count: '100',
  });

  if (data.status !== '000' && data.status !== '013') {
    throw new Error(`DART list failed: ${data.status} ${data.message}`);
  }

  return (data.list ?? []).map((item) => {
    const reprtCode = detectReportCode(item.report_nm);
    if (!reprtCode) return null;
    return {
      year: detectYear(item.report_nm, item.rcept_dt),
      reprtCode,
      reportName: CODE_META[reprtCode],
      rceptNo: item.rcept_no,
      rceptDt: item.rcept_dt,
    };
  }).filter(Boolean) as ReportMeta[];
}
