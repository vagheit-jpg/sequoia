import { QuoteData } from './types';

const TOKEN_URL = process.env.KIWOOM_TOKEN_URL || 'https://api.kiwoom.com/oauth2/token';

async function getKiwoomToken() {
  const appkey = process.env.KIWOOM_APP_KEY;
  const secretkey = process.env.KIWOOM_SECRET_KEY;

  if (!appkey || !secretkey) {
    throw new Error('키움 앱키/시크릿키가 설정되지 않았습니다.');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey,
      secretkey,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`키움 토큰 발급 실패: ${res.status}`);
  }

  const json = await res.json();
  return json.token as string;
}

export async function fetchKiwoomQuote(symbol: string): Promise<QuoteData> {
  const endpoint = process.env.KIWOOM_QUOTE_URL;
  const apiId = process.env.KIWOOM_QUOTE_API_ID;

  if (!endpoint || !apiId) {
    throw new Error('KIWOOM_QUOTE_URL 또는 KIWOOM_QUOTE_API_ID가 설정되지 않았습니다.');
  }

  const token = await getKiwoomToken();
  const stockCode = symbol.replace(/\.(KS|KQ)$/i, '');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: `Bearer ${token}`,
      'api-id': apiId,
    },
    body: JSON.stringify({
      stk_cd: stockCode,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`키움 현재가 조회 실패: ${res.status}`);
  }

  const json = await res.json();
  const row = json?.data || json?.output || json?.stk_prpr || json;
  const price = Number(row?.cur_prc ?? row?.price ?? row?.stck_prpr);
  const change = Number(row?.pred_pre ?? row?.change ?? row?.prdy_vrss);
  const changePercent = Number(row?.flu_rt ?? row?.change_rate ?? row?.prdy_ctrt);

  if (!Number.isFinite(price)) {
    throw new Error('키움 응답에서 현재가를 찾지 못했습니다.');
  }

  return {
    source: 'kiwoom',
    symbol: stockCode,
    name: row?.stk_nm ?? row?.hts_kor_isnm ?? stockCode,
    price,
    change: Number.isFinite(change) ? change : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    currency: 'KRW',
    asOf: new Date().toISOString(),
  };
}
