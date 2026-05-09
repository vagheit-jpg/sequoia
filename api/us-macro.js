/**
 * SEQUOIA GLOBAL — US Macro API
 * /api/us-macro.js
 *
 * 미국 시장 데이터 수집 엔진.
 * 기존 macro.js의 fetchFRED / fetchYahooMonthly / dailyToMonthly 구조를 동일하게 재사용.
 * 신규 API 계약 없음 — FRED + Yahoo Finance만 사용.
 */

const FRED_KEY  = process.env.FRED_API_KEY || "";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6시간

let cache = { data: null, ts: 0 };

// ── 날짜 정규화 (macro.js와 동일)
function normalizeDateKey(v, mode = "month") {
  if (v == null) return null;
  const s = String(v).trim().replace(/\./g, "-");
  let y = null, m = null, d = null;

  if      (/^\d{8}$/.test(s))          { y=s.slice(0,4); m=s.slice(4,6); d=s.slice(6,8); }
  else if (/^\d{6}$/.test(s))          { y=s.slice(0,4); m=s.slice(4,6); d="01"; }
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { y=s.slice(0,4); m=s.slice(5,7); d=s.slice(8,10); }
  else if (/^\d{4}-\d{2}$/.test(s))    { y=s.slice(0,4); m=s.slice(5,7); d="01"; }
  else {
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 6) { y=digits.slice(0,4); m=digits.slice(4,6); d=digits.slice(6,8)||"01"; }
  }
  if (!y || !m) return null;
  return mode === "day" ? `${y}${m}${d||"01"}` : `${y}${m}`;
}

// ── FRED 호출
async function fetchFRED(seriesId, startDate) {
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json` +
    `&observation_start=${startDate}&sort_order=asc`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json?.observations) {
    console.warn(`[FRED US] ${seriesId}: no observations`, json?.error_message || "");
    return [];
  }
  return json.observations
    .filter(r => r.value !== "." && r.value != null)
    .map(r => ({ date: normalizeDateKey(r.date, "day"), value: parseFloat(r.value) }))
    .filter(r => r.date && !Number.isNaN(r.value));
}

// ── Yahoo Finance 월봉 (범용)
async function fetchYahooMonthly(ticker, yearsBack = 5) {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - yearsBack * 365 * 24 * 60 * 60;
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=1mo&period1=${from}&period2=${now}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${ticker} ${res.status}`);
  const data   = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${ticker}`);
  const timestamps = result.timestamps || result.timestamp || [];
  const closes     = result.indicators?.quote?.[0]?.close || [];
  return timestamps.map((ts, i) => {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    return { date: `${y}${mo}`, value: closes[i] ? +closes[i].toFixed(4) : null };
  }).filter(r => r.value != null);
}

// ── 일별 → 월별 변환 (말일 값)
function dailyToMonthly(arr) {
  const map = {};
  for (const r of arr || []) {
    const ym = normalizeDateKey(r.date, "month");
    if (!ym) continue;
    map[ym] = r.value;
  }
  return Object.entries(map).sort((a, b) => a[0] > b[0] ? 1 : -1)
    .map(([date, value]) => ({ date, value }));
}

// ── YoY 계산
function calcMonthlyYoY(arr) {
  return arr.map((r, i) => {
    if (i < 12) return { ...r, yoy: null };
    const base = arr[i - 12]?.value;
    return { ...r, yoy: base ? +((r.value / base - 1) * 100).toFixed(1) : null };
  });
}

// ── Handler
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (Date.now() - cache.ts < CACHE_TTL && cache.data) {
    return res.status(200).json(cache.data);
  }

  try {
    const now       = new Date();
    const endY      = now.getFullYear();
    const startFRED = `${endY - 5}-01-01`;
    const startFRED8Y = `${endY - 8}-01-01`;

    // ── 병렬 데이터 수집
    // FRED: 이미 macro.js에 있는 것들 그대로 활용 (추가 API 계약 없음)
    // Yahoo: ^GSPC(S&P500), ^IXIC(나스닥), ^VIX, ^TNX, GLD, UUP
    const [
      spR, nasdaqR, vixR, tnxR, gldR, uupR,   // Yahoo
      t10y2yR, hyR, dgs10R, unrateR,            // FRED (기존)
      sloosr, leiR, icsaR, bamlR,               // FRED (기존)
      m2R, fedBalR,                              // FRED 신규
      ism_mfgR,                                  // FRED ISM 제조업
      umcsR,                                     // FRED 소비자신뢰
    ] = await Promise.allSettled([
      // Yahoo Finance
      fetchYahooMonthly("^GSPC",    8),   // S&P500
      fetchYahooMonthly("^IXIC",    8),   // 나스닥
      fetchYahooMonthly("^VIX",     5),   // VIX (Yahoo)
      fetchYahooMonthly("^TNX",     5),   // 미국 10년물
      fetchYahooMonthly("GLD",      5),   // 금 ETF
      fetchYahooMonthly("UUP",      5),   // 달러인덱스 ETF

      // FRED — 기존 macro.js에서 이미 검증된 시리즈
      fetchFRED("T10Y2Y",           startFRED),      // 장단기 금리차
      fetchFRED("DBAA",             startFRED),      // Baa 회사채
      fetchFRED("DGS10",            startFRED),      // 미국 10Y 국채
      fetchFRED("UNRATE",           startFRED8Y),    // 실업률
      fetchFRED("DRTSCILM",         startFRED8Y),    // SLOOS 대출기준
      fetchFRED("USALOLITONOSTSAM", startFRED8Y),    // LEI 선행지수
      fetchFRED("IC4WSA",           startFRED),      // 실업청구 4주평균
      fetchFRED("BAMLH0A0HYM2",     startFRED8Y),    // HY 스프레드

      // FRED — 신규 추가
      fetchFRED("M2SL",             startFRED8Y),    // 미국 M2
      fetchFRED("WALCL",            startFRED8Y),    // 연준 대차대조표
      fetchFRED("NAPM",             startFRED8Y),    // ISM 제조업 PMI (구 NAPM, ISM001 대체)
      fetchFRED("UMCSENT",          startFRED8Y),    // 소비자신뢰지수
    ]);

    const ok = r => r.status === "fulfilled" ? r.value : [];

    // ── Raw 데이터
    const spRaw     = ok(spR);
    const nasdaqRaw = ok(nasdaqR);
    const vixRaw    = ok(vixR);
    const tnxRaw    = ok(tnxR);
    const gldRaw    = ok(gldR);
    const uupRaw    = ok(uupR);

    const t10y2yRaw = ok(t10y2yR);
    const hyRaw     = ok(hyR);
    const dgs10Raw  = ok(dgs10R);
    const unrateRaw = ok(unrateR);
    const sloosRaw  = ok(sloosr);
    const leiRaw    = ok(leiR);
    const icsaRaw   = ok(icsaR);
    const bamlRaw   = ok(bamlR);
    const m2Raw     = ok(m2R);
    const fedBalRaw = ok(fedBalR);
    const ismRaw    = ok(ism_mfgR);
    const umcsRaw   = ok(umcsR);

    // ── 가공
    const sp500     = spRaw;     // 이미 월봉
    const nasdaq    = nasdaqRaw;
    const vix       = vixRaw;    // Yahoo 월봉
    const tnx       = dailyToMonthly(tnxRaw);  // 일별→월별
    const gld       = gldRaw;
    const dxy       = uupRaw;    // UUP = 달러인덱스 ETF

    // Baa 스프레드 = DBAA - DGS10 (기준금리 영향 제거)
    const dgs10M   = dailyToMonthly(dgs10Raw);
    const dgs10Map = {};
    dgs10M.forEach(r => { dgs10Map[r.date] = r.value; });
    const hy = dailyToMonthly(hyRaw).map(r => {
      const t10 = dgs10Map[r.date];
      return t10 != null ? { date: r.date, value: +(r.value - t10).toFixed(2) } : null;
    }).filter(Boolean);

    const t10y2y = dailyToMonthly(t10y2yRaw);
    const unrate = unrateRaw
      .map(r => ({ date: r.date ? r.date.slice(0, 6) : null, value: r.value }))
      .filter(r => r.date && r.value != null);
    const sloos  = dailyToMonthly(sloosRaw);
    const lei    = dailyToMonthly(leiRaw);
    const icsa   = dailyToMonthly(icsaRaw.map(r => ({ ...r, value: +(r.value / 1000).toFixed(1) })));
    const baml   = dailyToMonthly(bamlRaw);  // ICE BofA HY 스프레드

    // M2 YoY
    const m2 = m2Raw
      .map(r => ({
        date: r.date ? r.date.slice(0, 6).replace(/^(\d{4})(\d{2})$/, "$1.$2") : null,
        value: r.value,
      }))
      .filter(r => r.date && r.value != null && !Number.isNaN(r.value));
    const m2YoY = calcMonthlyYoY(m2);

    // 연준 대차대조표 YoY
    const fedBal    = dailyToMonthly(fedBalRaw);
    const fedBalYoY = calcMonthlyYoY(fedBal);

    // ISM / 소비자신뢰 월별
    const ism  = dailyToMonthly(ismRaw);
    const umcs = dailyToMonthly(umcsRaw);

    const data = {
      // 지수
      sp500, nasdaq, vix, tnx, gld, dxy,
      // 금리·신용
      t10y2y, hy, baml, sloos, lei, icsa, unrate,
      // 유동성
      m2YoY, fedBal, fedBalYoY,
      // 실물
      ism, umcs,
      // 메타
      market: "US",
      updatedAt: Date.now(),
      _debug: {
        sp500: spRaw.length, nasdaq: nasdaqRaw.length,
        vix: vixRaw.length, t10y2y: t10y2yRaw.length,
        hy: hyRaw.length, baml: bamlRaw.length,
        sloos: sloosRaw.length, lei: leiRaw.length,
        m2: m2Raw.length, fedBal: fedBalRaw.length,
        ism: ismRaw.length, umcs: umcsRaw.length,
      },
    };

    cache = { data, ts: Date.now() };
    return res.status(200).json(data);

  } catch (e) {
    console.error("[us-macro]", e.message);
    if (cache.data) return res.status(200).json(cache.data);
    return res.status(500).json({ error: e.message });
  }
}
