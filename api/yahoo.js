export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const ticker = req.query.ticker || '';
  const market = (req.query.market || 'KOSDAQ').toUpperCase();
  const mode = req.query.mode || 'both';

  if (!ticker) return res.status(400).json({ error: 'ticker 필요' });

  const suffix1 = market.includes('KOSPI') ? '.KS' : '.KQ';
  const suffix2 = suffix1 === '.KS' ? '.KQ' : '.KS';
  const range = mode === 'price' ? '5d' : '10y';
  const interval = mode === 'price' ? '1d' : '1mo';

  async function tryFetch(suffix) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}${suffix}?interval=${interval}&range=${range}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
        },
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.chart?.result?.[0] || null;
    } catch {
      return null;
    }
  }

  let chart = await tryFetch(suffix1);
  if (!chart) chart = await tryFetch(suffix2);

  if (!chart) {
    return res.status(200).json({ monthly: [], currentPrice: null, error: 'Yahoo 데이터 없음' });
  }

  const meta = chart.meta || {};
  const currentPrice = Math.round(meta.regularMarketPrice || 0);
  const change = meta.regularMarketChange != null ? Math.round(meta.regularMarketChange) : 0;
  const changePct = meta.regularMarketChangePercent != null ? +meta.regularMarketChangePercent.toFixed(2) : 0;
  const prevClose = Math.round(meta.chartPreviousClose || meta.previousClose || (currentPrice - change) || 0);

  if (mode === 'price') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ currentPrice, prevClose, change, changePct, monthly: [] });
  }

  const ts = chart.timestamp || [];
  const q = chart.indicators?.quote?.[0] || {};
  const closes = q.close || [];
  const opens = q.open || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const vols = q.volume || [];

  const monthly = ts
    .map((time, index) => {
      const dt = new Date(time * 1000);
      return {
        ts: time,
        label: `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}`,
        year: dt.getFullYear(),
        month: dt.getMonth() + 1,
        price: Math.round(closes[index] || 0),
        open: Math.round(opens[index] || 0),
        high: Math.round(highs[index] || 0),
        low: Math.round(lows[index] || 0),
        volume: vols[index] || 0,
      };
    })
    .filter((item) => item.price > 0);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ monthly, currentPrice, prevClose, change, changePct });
}
