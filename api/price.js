let kisToken = null;
let kisTokenExpiry = 0;

function isMarketOpen() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (day === 0 || day === 6) return false;
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

async function getKisToken() {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) return null;

  const now = Date.now();
  if (kisToken && now < kisTokenExpiry) return kisToken;

  const response = await fetch('https://openapi.koreainvestment.com:9443/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  if (!data?.access_token) return null;
  kisToken = data.access_token;
  kisTokenExpiry = now + ((data.expires_in ?? 3600) * 1000) - 60000;
  return kisToken;
}

async function fetchKisPrice(ticker) {
  const token = await getKisToken();
  if (!token) throw new Error('KIS 토큰 발급 실패');

  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const code = String(ticker).padStart(6, '0');

  const response = await fetch(
    `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: appKey,
        appsecret: appSecret,
        tr_id: 'FHKST01010100',
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );

  const data = await response.json();
  const output = data?.output;
  if (!output?.stck_prpr) throw new Error('KIS 응답 없음');

  return {
    price: parseInt(output.stck_prpr, 10) || 0,
    change: parseInt(output.prdy_vrss, 10) || 0,
    changePct: parseFloat(output.prdy_ctrt) || 0,
    prevClose: parseInt(output.stck_sdpr, 10) || 0,
    per: parseFloat(output.per) || null,
    pbr: parseFloat(output.pbr) || null,
    source: 'KIS',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  const { ticker } = req.query;
  if (!ticker) {
    return res.status(400).json({ error: 'ticker 파라미터 필요' });
  }

  try {
    const data = await fetchKisPrice(ticker);
    return res.status(200).json({ ...data, marketOpen: isMarketOpen() });
  } catch (error) {
    return res.status(200).json({
      price: null,
      prevClose: null,
      change: null,
      changePct: null,
      per: null,
      pbr: null,
      source: 'fallback',
      marketOpen: isMarketOpen(),
      message: error.message,
    });
  }
}
