let corpListCache = null;
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function chosung(value) {
  return [...String(value || '')].map((char) => {
    const code = char.charCodeAt(0) - 0xac00;
    return code >= 0 && code <= 11171 ? CHO[Math.floor(code / 588)] : char;
  }).join('');
}

export async function loadCorpList() {
  if (corpListCache) return corpListCache;
  const response = await fetch('/corplist.json', { cache: 'force-cache' });
  if (!response.ok) throw new Error('corplist.json 로드 실패');
  const list = await response.json();
  corpListCache = Array.isArray(list) ? list : [];
  return corpListCache;
}

export async function searchCorpList(query) {
  const term = String(query || '').trim();
  if (!term) return [];
  const list = await loadCorpList();
  const compact = term.replace(/\s+/g, '').toLowerCase();
  const upper = term.toUpperCase();
  const isChoOnly = /^[ㄱ-ㅎ]+$/.test(term);

  return list
    .map((item) => {
      const name = String(item.name || '');
      const stock = String(item.stock || '');
      const corpCode = String(item.code || '');
      const compactName = name.replace(/\s+/g, '').toLowerCase();
      let score = -1;
      if (stock === upper) score = 100;
      else if (name === term) score = 95;
      else if (stock.startsWith(upper)) score = 90;
      else if (compactName.startsWith(compact)) score = 85;
      else if (compactName.includes(compact)) score = 75;
      else if (isChoOnly && chosung(name).includes(term)) score = 70;
      else if (corpCode.startsWith(term)) score = 60;
      return score >= 0 ? {
        corp_name: name,
        stock_code: stock,
        corp_code: corpCode,
        market: '',
        score,
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.corp_name.localeCompare(b.corp_name, 'ko'))
    .slice(0, 10);
}

export async function fetchPrice(ticker) {
  const response = await fetch(`/api/price?ticker=${encodeURIComponent(ticker)}`);
  if (!response.ok) throw new Error('현재가 API 호출 실패');
  return response.json();
}

export async function fetchYahooMonthly(ticker, market = 'KOSDAQ') {
  const response = await fetch(`/api/yahoo?ticker=${encodeURIComponent(ticker)}&market=${encodeURIComponent(market)}`);
  if (!response.ok) throw new Error('Yahoo API 호출 실패');
  return response.json();
}

export async function fetchDartCompany(corpCode) {
  const response = await fetch(`/api/dart?ep=company&corp_code=${encodeURIComponent(corpCode)}`);
  if (!response.ok) throw new Error('DART company 호출 실패');
  return response.json();
}

export async function fetchDartAnnual(corpCode) {
  const response = await fetch(`/api/dart?ep=financials&corp_code=${encodeURIComponent(corpCode)}`);
  if (!response.ok) throw new Error('DART financials 호출 실패');
  return response.json();
}
