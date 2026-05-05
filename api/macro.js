// api/macro.js — ECOS 거시경제 + Yahoo Finance 지수
const ECOS_KEY = process.env.ECOS_API_KEY || "";
const CACHE_TTL = 6 * 60 * 60 * 1000;

let cache = { data: null, ts: 0 };

// ── ECOS 호출
async function fetchECOS(statCode, itemCode, startDate, endDate, freq = "MM") {
  // ECOS 공식 URL: /StatisticSearch/{key}/json/kr/{startRow}/{endRow}/{statCode}/{freq}/{startDate}/{endDate}/{itemCode}
  // encodeURIComponent 제거 — *AA 같은 와일드카드가 %2AAA로 인코딩되면 ERROR-100 발생
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/800/${statCode}/${freq}/${startDate}/${endDate}/${itemCode}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json?.RESULT?.CODE && json.RESULT.CODE !== "INFO-000") {
    console.warn(`[ECOS] ${statCode}/${itemCode}: ${json.RESULT.MESSAGE}`);
    return [];
  }
  const rows = json?.StatisticSearch?.row || [];
return rows.map(r => ({
  date: r.TIME,
  value: parseFloat(r.DATA_VALUE),
  itemCode2: r.ITEM_CODE2,
  itemName2: r.ITEM_NAME2,
  unitName: r.UNIT_NAME,
}))
.filter(r => !isNaN(r.value));
}

// ── FRED 호출
const FRED_KEY = process.env.FRED_API_KEY || "";
async function fetchFRED(seriesId, startDate) {
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json` +
    `&observation_start=${startDate}&sort_order=asc`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json?.observations) {
    console.warn(`[FRED] ${seriesId}: no observations`);
    return [];
  }
  return json.observations
    .map(r => ({ date: r.date.replace(/-/g, "").slice(0, 8), value: parseFloat(r.value) }))
    .filter(r => !isNaN(r.value));
}

// ── Yahoo Finance 지수 월봉 (^KS11, ^KQ11)
async function fetchIndexMonthly(yahooTicker) {
  const now = Math.floor(Date.now() / 1000);
  const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
    `?interval=1mo&period1=${tenYearsAgo}&period2=${now}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${yahooTicker} ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${yahooTicker}`);

  const timestamps = result.timestamps || result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  return timestamps.map((ts, i) => {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return {
      date: `${y}${m}`,
      price: closes[i] ? Math.round(closes[i]) : null,
    };
  }).filter(r => r.price != null);
}

// ── Yahoo Finance VIX 월봉
async function fetchVIXMonthly() {
  const now = Math.floor(Date.now() / 1000);
  const threeYearsAgo = now - 3 * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX` +
    `?interval=1mo&period1=${threeYearsAgo}&period2=${now}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo VIX ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No VIX data");
  const timestamps = result.timestamps || result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps.map((ts, i) => {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return { date: `${y}${m}`, value: closes[i] ? +closes[i].toFixed(2) : null };
  }).filter(r => r.value != null);
}

// ── Yahoo Finance 일별 → 월별 (범용: BIZD, DXY, 구리, 금 등)
async function fetchYahooMonthly(yahooTicker, yearsBack = 5) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - yearsBack * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}` +
    `?interval=1mo&period1=${from}&period2=${now}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${yahooTicker} ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data: ${yahooTicker}`);
  const timestamps = result.timestamps || result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps.map((ts, i) => {
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return { date: `${y}${m}`, value: closes[i] ? +closes[i].toFixed(4) : null };
  }).filter(r => r.value != null);
}

// ── 일별 → 월별 변환 (말일 값 사용)
function dailyToMonthly(arr) {
  const map = {};
  for (const r of arr) {
    const ym = r.date.slice(0, 6); // YYYYMMDD → YYYYMM
    map[ym] = r.value; // 같은 달이면 덮어쓰기 → 마지막 값(말일)
  }
  return Object.entries(map).sort((a,b)=>a[0]>b[0]?1:-1).map(([date,value])=>({date,value}));
}

// ── YoY 계산
function calcMonthlyYoY(arr) {
  return arr.map((r, i) => {
    if (i < 12) return { ...r, yoy: null };
    const base = arr[i - 12]?.value;
    return { ...r, yoy: base ? +((r.value / base - 1) * 100).toFixed(1) : null };
  });
}

function calcQuarterlyYoY(arr) {
  return arr.map(r => {
    const prevYear = String(parseInt(r.date.slice(0, 4)) - 1) + r.date.slice(4);
    const prev = arr.find(p => p.date === prevYear);
    return { ...r, yoy: prev != null && prev.value ? +((r.value / prev.value - 1) * 100).toFixed(1) : null };
  });
}


// ══════════════════════════════════════════════════════════════
// 역사적 위기 벤치마크 — 각 위기 당시 DEFCON 지표값 (검증된 수치)
// ══════════════════════════════════════════════════════════════
const CRISIS_EVENT_SEEDS = [
  'south_sea_1720|1720 남해회사 버블|1720.09|1|bubble_burst|UK|초기 주식버블',
  'mississippi_1720|1720 미시시피 버블|1720.08|1|bubble_burst|France|초기 신용버블',
  'railway_1847|1847 영국 철도버블 붕괴|1847.10|1|bubble_burst|UK|인프라 버블',
  'panic_1857|1857 글로벌 공황|1857.10|1|banking_crisis|US/Global|은행공황',
  'panic_1873|1873 장기불황 시작|1873.09|1|banking_crisis|US/Europe|신용버블 붕괴',
  'baring_1890|1890 베어링 위기|1890.11|2|credit_crisis|UK/Argentina|국제 신용위기',
  'panic_1893|1893 미국 공황|1893.05|1|banking_crisis|US|철도·은행위기',
  'panic_1907|1907 미국 은행공황|1907.10|1|banking_crisis|US|은행공황',
  'ww1_1914|1914 1차대전 시장폐쇄|1914.07|1|geopolitical_shock|Global|전쟁충격',
  'postwar_1920|1920~21 전후 디플레 침체|1920.12|2|rate_shock|US|긴축·디플레',
  'roaring_1928|1928 광란의 20년대 말기|1928.12|4|bubble_late|US|버블 말기',
  'crash_1929|1929 미국 대공황 주가붕괴|1929.10|1|bubble_burst|US|버블 붕괴',
  'banking_1931|1931 글로벌 은행위기|1931.09|1|banking_crisis|Global|은행위기',
  'reflation_1933|1933 뉴딜·금본위 이탈 반등|1933.04|4|policy_easing_rebound|US|정책반등',
  'recession_1937|1937 긴축 재침체|1937.08|2|rate_shock|US|정책실패',
  'ww2_1940|1940 전쟁확대 충격|1940.05|2|geopolitical_shock|Global|전쟁충격',
  'korean_war_1950|1950 한국전쟁 충격|1950.06|2|geopolitical_shock|Korea/Global|전쟁충격',
  'nifty_1969|1969 니프티피프티 과열|1969.12|4|bubble_late|US|집중장세 말기',
  'bretton_1971|1971 브레튼우즈 붕괴|1971.08|3|policy_uncertainty|Global|통화체제 전환',
  'oil_1973|1973 1차 오일쇼크|1973.10|2|inflation_shock|Global|스태그플레이션',
  'bear_1974|1974 글로벌 약세장|1974.10|1|inflation_shock|Global|침체·인플레',
  'oil_1979|1979 2차 오일쇼크|1979.10|2|inflation_shock|Global|인플레 재가속',
  'volcker_1979|1979 볼커 긴축 쇼크|1979.10|2|rate_shock|US/EM|긴축충격',
  'latin_debt_1982|1982 라틴아메리카 외채위기|1982.08|1|credit_crisis|EM|외채위기',
  'us_bull_1982|1982 미국 장기 강세장 출발|1982.08|5|bull_market|US|정책전환 반등',
  'plaza_1985|1985 플라자합의|1985.09|4|bull_market|Global|환율정책 전환',
  'black_monday_1987|1987 블랙먼데이|1987.10|2|liquidity_crisis|US/Global|기술적 폭락',
  'sl_crisis_1989|1989 미국 S&L 위기|1989.08|2|property_debt_crisis|US|부동산·은행위기',
  'japan_bubble_1989|1989 일본 자산버블 정점|1989.12|4|bubble_late|Japan|버블 정점',
  'japan_1990|1990 일본 버블 붕괴|1990.01|3|bubble_burst|Japan|버블 붕괴',
  'nordic_1991|1991 북유럽 은행위기|1991.09|1|banking_crisis|Nordic|부동산·은행위기',
  'erm_1992|1992 유럽 ERM 위기|1992.09|2|fx_crisis|Europe|외환위기',
  'bond_1994|1994 채권 대학살|1994.02|3|rate_shock|US/Global|금리충격',
  'mexico_1994|1994 멕시코 테킬라 위기|1994.12|1|fx_crisis|EM|외환위기',
  'asia_fx_1997|1997 아시아 외환위기|1997.07|1|fx_crisis|Asia|외환·신용위기',
  'imf_1997|1997 한국 IMF 외환위기|1997.11|1|fx_crisis|Korea|외환·신용위기',
  'russia_1998|1998 러시아 디폴트|1998.08|1|credit_crisis|EM|국가부도',
  'ltcm_1998|1998 LTCM 위기|1998.09|2|liquidity_crisis|US/Global|레버리지 청산',
  'brazil_1999|1999 브라질 헤알 위기|1999.01|2|fx_crisis|EM|외환위기',
  'dotcom_late_1999|1999 닷컴버블 말기|1999.12|4|bubble_late|US|버블 말기',
  'dotcom_2000|2000 IT 버블 붕괴|2000.03|2|bubble_burst|US/Global|버블 붕괴',
  'nine_eleven_2001|2001 9·11 충격|2001.09|2|geopolitical_shock|US/Global|테러충격',
  'argentina_2001|2001 아르헨티나 디폴트|2001.12|1|fx_crisis|EM|국가부도',
  'enron_2002|2002 엔론·회계위기|2002.07|2|credit_crisis|US|신뢰위기',
  'sars_2003|2003 SARS 충격|2003.04|3|geopolitical_shock|Asia|감염병 충격',
  'korea_card_2003|2003 한국 카드채 위기|2003.03|2|credit_crisis|Korea|소비신용 위기',
  'china_supercycle_2004|2004 중국 원자재 슈퍼사이클|2004.12|5|bull_market|Global/China|원자재 강세장',
  'kospi_bull_2005|2005 한국 재평가 강세장|2005.12|5|bull_market|Korea|재평가 강세',
  'housing_boom_2005|2005 미국 주택버블 확장|2005.12|4|bubble_late|US|부동산 버블',
  'subprime_2007|2007 서브프라임 초기|2007.08|2|credit_crisis|US|신용위기 초기',
  'kospi_peak_2007|2007 코스피 2000 과열|2007.10|4|bubble_late|Korea|강세장 말기',
  'bear_stearns_2008|2008 베어스턴스 구제|2008.03|2|banking_crisis|US|은행위기 초기',
  'gfc_2008|2008 글로벌 금융위기|2008.10|1|credit_crisis|Global|시스템 위기',
  'gfc_bottom_2009|2009 금융위기 정책반등|2009.03|4|policy_easing_rebound|Global|유동성 반등',
  'dubai_2009|2009 두바이월드 부채위기|2009.11|3|property_debt_crisis|EM|부동산 부채',
  'flash_crash_2010|2010 플래시 크래시|2010.05|3|liquidity_crisis|US|시장구조 충격',
  'greece_2010|2010 그리스 재정위기|2010.05|2|credit_crisis|Europe|재정위기',
  'europe_2011|2011 유럽 재정위기|2011.09|2|credit_crisis|Europe|재정·은행위기',
  'us_downgrade_2011|2011 미국 신용등급 강등|2011.08|2|policy_uncertainty|US|신뢰위기',
  'draghi_2012|2012 ECB 드라기 전환|2012.07|4|policy_easing_rebound|Europe|정책전환',
  'taper_2013|2013 테이퍼 텐트럼|2013.05|3|rate_shock|US/EM|금리충격',
  'india_2013|2013 인도 루피 위기|2013.08|3|fx_crisis|India/EM|외환취약성',
  'oil_crash_2014|2014 유가 폭락|2014.12|3|commodity_crash|Global|원자재 붕괴',
  'euro_qe_2015|2015 ECB QE 반등|2015.03|4|policy_easing_rebound|Europe|유동성 반등',
  'china_2015|2015 중국 위안화 쇼크|2015.08|3|china_slowdown|China/Global|중국둔화',
  'hy_energy_2016|2016 유가·하이일드 위기|2016.02|2|credit_crisis|US/Global|에너지 신용위기',
  'brexit_2016|2016 브렉시트 충격|2016.06|3|policy_uncertainty|UK/Europe|정치충격',
  'global_sync_2017|2017 글로벌 동반확장|2017.12|5|bull_market|Global|동반확장',
  'crypto_winter_2018|2018 크립토 겨울|2018.12|3|bubble_burst|Global|투기버블 붕괴',
  'volmageddon_2018|2018 변동성 ETN 쇼크|2018.02|3|liquidity_crisis|US|변동성 충격',
  'trade_war_2018|2018 미중 무역전쟁|2018.09|3|china_slowdown|US/China|무역충격',
  'turkey_2018|2018 터키 리라 위기|2018.08|2|fx_crisis|Turkey/EM|외환위기',
  'argentina_2018|2018 아르헨티나 IMF 위기|2018.09|2|fx_crisis|Argentina/EM|국가채무 위기',
  'fed_2018|2018 연준 긴축 조정|2018.12|4|rate_shock|US/Global|긴축 후반',
  'repo_2019|2019 미국 레포시장 경색|2019.09|3|liquidity_crisis|US|단기자금 경색',
  'hongkong_2019|2019 홍콩 시위·시장불안|2019.08|3|policy_uncertainty|Hong Kong|정치충격',
  'covid_2020|2020 코로나 충격|2020.03|2|geopolitical_shock|Global|외생충격',
  'dash_cash_2020|2020 달러 현금화 위기|2020.03|1|liquidity_crisis|Global|현금화 위기',
  'reopening_2020|2020 유동성 V자 반등|2020.08|5|policy_easing_rebound|Global|정책반등',
  'meme_2021|2021 밈주식 숏스퀴즈|2021.01|4|bubble_late|US|투기 과열',
  'spac_crypto_2021|2021 SPAC·크립토 과열|2021.02|4|bubble_late|US/Global|투기 과열',
  'ark_2021|2021 혁신성장주 고점|2021.02|4|bubble_late|US|성장주 과열',
  'growth_peak_2021|2021 성장주/테크 과열|2021.11|4|bubble_late|US/Global|성장주 고점',
  'evergrande_2021|2021 중국 헝다 부동산 위기|2021.09|2|property_debt_crisis|China|부동산 부채',
  'inflation_2022|2022 인플레이션·금리충격|2022.06|3|inflation_shock|Global|인플레 긴축',
  'tightening_2022|2022 미국 긴축 위기|2022.10|3|rate_shock|US/Korea|긴축 후반',
  'uk_ldi_2022|2022 영국 LDI 위기|2022.09|2|liquidity_crisis|UK|금리·레버리지 위기',
  'korea_pf_2022|2022 한국 레고랜드·PF 불안|2022.10|2|credit_crisis|Korea|PF 신용위기',
  'ftx_2022|2022 FTX 붕괴|2022.11|3|credit_crisis|Global|투기신용 붕괴',
  'svb_2023|2023 SVB 은행위기|2023.03|2|banking_crisis|US|은행위기',
  'cs_2023|2023 크레디트스위스 위기|2023.03|2|banking_crisis|Europe|은행 신뢰위기',
  'ai_concentration_2023|2023 AI·빅테크 집중장세|2023.12|5|concentration_bull|US/Global|집중 강세장',
  'china_deflation_2023|2023 중국 디플레·부동산 둔화|2023.08|3|china_slowdown|China|디플레 둔화',
  'boj_ycc_2023|2023 일본 YCC 수정|2023.07|4|rate_shock|Japan|금리체제 전환',
  'regional_bank_2024|2024 미국 지역은행 부동산 우려|2024.02|3|property_debt_crisis|US|상업용부동산 스트레스',
  'ai_boom_2024|2024~2025 AI/빅테크 집중장세|2024.12|5|concentration_bull|US/Global|AI 집중장세',
  'japan_reflation_2024|2024 일본 리플레이션 강세|2024.03|5|bull_market|Japan|리플레이션 강세',
  'gold_breakout_2024|2024 금 가격 돌파|2024.04|4|safe_asset_bull|Global|안전자산 강세',
  'korea_valueup_2024|2024 한국 밸류업 기대장|2024.02|4|bull_market|Korea|정책 재평가',
  'cre_2024|2024 글로벌 상업용부동산 스트레스|2024.06|3|property_debt_crisis|Global|부동산 신용스트레스',
];

const REGIME_VECTOR_PRESETS = {
  bubble_late: { 신용위험:66, 유동성:68, 시장공포:86, 실물경기:76, 물가:48 },
  bubble_burst: { 신용위험:14, 유동성:18, 시장공포:8, 실물경기:18, 물가:32 },
  credit_crisis: { 신용위험:8, 유동성:16, 시장공포:10, 실물경기:18, 물가:32 },
  banking_crisis: { 신용위험:10, 유동성:14, 시장공포:12, 실물경기:22, 물가:38 },
  fx_crisis: { 신용위험:12, 유동성:10, 시장공포:16, 실물경기:20, 물가:12 },
  rate_shock: { 신용위험:32, 유동성:20, 시장공포:30, 실물경기:45, 물가:14 },
  inflation_shock: { 신용위험:24, 유동성:18, 시장공포:22, 실물경기:18, 물가:5 },
  liquidity_crisis: { 신용위험:16, 유동성:6, 시장공포:10, 실물경기:28, 물가:45 },
  policy_easing_rebound: { 신용위험:42, 유동성:78, 시장공포:45, 실물경기:32, 물가:66 },
  bull_market: { 신용위험:78, 유동성:74, 시장공포:86, 실물경기:78, 물가:62 },
  concentration_bull: { 신용위험:70, 유동성:60, 시장공포:86, 실물경기:68, 물가:44 },
  geopolitical_shock: { 신용위험:30, 유동성:35, 시장공포:14, 실물경기:30, 물가:28 },
  property_debt_crisis: { 신용위험:18, 유동성:24, 시장공포:28, 실물경기:28, 물가:34 },
  commodity_crash: { 신용위험:34, 유동성:42, 시장공포:32, 실물경기:36, 물가:70 },
  china_slowdown: { 신용위험:34, 유동성:30, 시장공포:30, 실물경기:28, 물가:58 },
  policy_uncertainty: { 신용위험:36, 유동성:34, 시장공포:28, 실물경기:40, 물가:42 },
  soft_landing: { 신용위험:74, 유동성:58, 시장공포:82, 실물경기:72, 물가:54 },
  safe_asset_bull: { 신용위험:52, 유동성:48, 시장공포:54, 실물경기:56, 물가:34 },
};

const CRISIS_COLORS = { 1:'#FF1A1A', 2:'#FF6B00', 3:'#F0C800', 4:'#38BDF8', 5:'#00C878' };

function adjustVector(base, idx) {
  const out = {...base};
  Object.keys(out).forEach((k, j) => {
    const delta = ((idx * 7 + j * 3) % 9) - 4;
    out[k] = Math.max(0, Math.min(100, out[k] + delta));
  });
  return out;
}

const CRISIS_BENCHMARKS = CRISIS_EVENT_SEEDS.map((row, idx) => {
  const [id,label,date,defconRaw,type,region,phase] = row.split('|');
  const defcon = Number(defconRaw);
  const cat = adjustVector(REGIME_VECTOR_PRESETS[type] || REGIME_VECTOR_PRESETS.policy_uncertainty, idx);
  return {
    id, label, date, defcon, color: CRISIS_COLORS[defcon], region, type, phase,
    desc: `${label} 국면을 ${phase} 유형으로 구조화한 역사 패턴 템플릿`,
    cat,
    impact: { desc: `${phase} 유형의 자산가격·환율·신용시장 변동성 확대/완화 패턴` },
  };
});

// 유사도 계산 — 5개 카테고리 유클리드 거리 → 100점 환산
function calcSimilarity(currentCatScores, crisisCat) {
  const cats = ["신용위험","유동성","시장공포","실물경기","물가"];
  const curMap = {};
  (currentCatScores||[]).forEach(c => { curMap[c.cat] = c.score; });
  let sumSq = 0;
  cats.forEach(cat => {
    const cur = curMap[cat] ?? 50;
    const cri = crisisCat[cat] ?? 50;
    sumSq += Math.pow(cur - cri, 2);
  });
  const dist = Math.sqrt(sumSq); // 최대거리 ≈ sqrt(5*100^2) = 223, proximityScore와 동일 기준
  const similarity = Math.max(0, Math.round((1 - dist / 250) * 100));
  return similarity;
}


function buildCurrentVector(defconData) {
  const curMap = {};
  (defconData?.catScores || []).forEach(c => { curMap[c.cat] = c.score; });
  return { 신용위험:curMap["신용위험"]??50, 유동성:curMap["유동성"]??50, 시장공포:curMap["시장공포"]??50, 실물경기:curMap["실물경기"]??50, 물가:curMap["물가"]??50 };
}
function classifyRegime(topMatches) {
  const typeScore = {}, phaseScore = {};
  (topMatches || []).forEach((m, idx) => { const w=Math.max(1,6-idx), s=(m.similarity||0)*w; typeScore[m.type||"unknown"]=(typeScore[m.type||"unknown"]||0)+s; phaseScore[m.phase||"미분류"]=(phaseScore[m.phase||"미분류"]||0)+s; });
  const sortObj=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]); const types=sortObj(typeScore), phases=sortObj(phaseScore); const total=types.reduce((s,x)=>s+x[1],0)||1;
  return { primaryType:types[0]?.[0]||"unknown", secondaryType:types[1]?.[0]||null, primaryPhase:phases[0]?.[0]||"미분류", secondaryPhase:phases[1]?.[0]||null, confidence:Math.min(95,Math.round((types[0]?.[1]||0)/total*100)), typeMix:types.slice(0,5).map(([type,score])=>({type,weight:Math.round(score/total*100)})) };
}
function calculateTransitionRisk(defconData, navigation, topMatches) {
  const sefconRisk=Math.max(0,Math.min(100,100-(defconData?.totalScore??50))); const proximityScore=navigation?.proximityScore??topMatches?.[0]?.similarity??50; const dangerDensity=navigation?.dangerDensity??0; const topAvg=(topMatches||[]).slice(0,3).reduce((s,m)=>s+(m.similarity||0),0)/Math.max(1,Math.min(3,(topMatches||[]).length));
  const score=Math.round(sefconRisk*.40+proximityScore*.25+topAvg*.20+dangerDensity*.15); const level=score>=75?"위기":score>=60?"경고":score>=45?"주의":score>=30?"관찰":"안정";
  const message=score>=75?"현재 지표와 역사 패턴이 모두 위기권에 가깝습니다. 생존 우선 구간입니다.":score>=60?"역사적 위기 패턴 유사도가 높습니다. 방어 비중을 우선합니다.":score>=45?"일부 위험 전이 가능성이 있습니다. 현금과 분할 접근이 유리합니다.":score>=30?"중립권이나 위험 신호 변화를 감시해야 합니다.":"위험 전이 압력은 제한적입니다.";
  return {score,level,message,sefconRisk,proximityScore,topAvg:Math.round(topAvg),dangerDensity};
}
function generateAllocationGuide(transitionRisk) {
  const score=transitionRisk?.score??50;
  if(score>=75)return{stock:"10~25%",bond:"20~40%",cash:"40~60%",dollar:"20~40%",stance:"생존 우선",message:"신규 공격 매수보다 현금·달러·단기채 중심 방어가 우선입니다."};
  if(score>=60)return{stock:"20~35%",bond:"20~35%",cash:"35~55%",dollar:"15~30%",stance:"방어 우선",message:"리스크 자산은 선별 보유하고 추가 매수는 분할 접근합니다."};
  if(score>=45)return{stock:"35~50%",bond:"15~30%",cash:"25~40%",dollar:"10~25%",stance:"주의·균형",message:"현금 대기와 우량주 분할매수를 병행합니다."};
  if(score>=30)return{stock:"50~65%",bond:"10~25%",cash:"15~30%",dollar:"5~20%",stance:"선별 공격",message:"위험은 제한적이나 과열 구간은 피합니다."};
  return{stock:"60~80%",bond:"5~20%",cash:"10~25%",dollar:"0~15%",stance:"공격 가능",message:"거시 위험은 낮습니다. 종목 밸류에이션 규율은 유지합니다."};
}
function buildSelfEvolutionShadow(defconData, regime, transitionRisk) {
  return { version:"SEFCON-v3.0-shadow", mode:"shadow", minSamplesBeforeLearning:20, maxWeightChangePerUpdate:0.02, adaptiveWeights:{신용위험:.30,시장공포:.25,실물경기:.20,유동성:.15,물가:.10}, pendingPrediction:{createdAt:Date.now(),sefconScore:defconData?.totalScore??null,regime:regime?.primaryPhase??null,transitionRisk:transitionRisk?.score??null,horizons:["1M","3M","6M","12M"]}, message:"v3에서는 자동 반영 없이 예측·오차·보정 제안만 기록하는 Shadow Learning 구조입니다." };
}
function buildRegimeEngine(defconData, results, navigation, warnings) {
  const currentVector=buildCurrentVector(defconData); const topMatches=(results||[]).slice(0,7).map(({id,label,date,defcon,color,region,type,phase,desc,cat,impact,similarity})=>({id,label,date,defcon,color,region,type,phase,desc,cat,impact,similarity})); const regime=classifyRegime(topMatches.slice(0,5)); const transitionRisk=calculateTransitionRisk(defconData,navigation,topMatches); const allocationGuide=generateAllocationGuide(transitionRisk,regime); const selfEvolution=buildSelfEvolutionShadow(defconData,regime,transitionRisk);
  return {engine:"SEFCON Regime Engine",version:"v3.0",trainingSet:{totalEvents:CRISIS_BENCHMARKS.length,note:"역사적 사건 100개를 5대 위험축 벡터로 구조화한 휴리스틱 템플릿 DB입니다."},currentVector,topMatches,regime,transitionRisk,allocationGuide,warnings,selfEvolution};
}
function calcCrisisAnalysis(defconData) {
  const results=CRISIS_BENCHMARKS.map(crisis=>({...crisis,similarity:calcSimilarity(defconData.catScores,crisis.cat)})).sort((a,b)=>b.similarity-a.similarity); const top=results[0]; const top2=results[1];
  const curMap={}; (defconData.catScores||[]).forEach(c=>{curMap[c.cat]=c.score;}); const warnings=[]; if((curMap["신용위험"]??50)<40)warnings.push("신용위험 상승"); if((curMap["유동성"]??50)<35)warnings.push("유동성 압박"); if((curMap["시장공포"]??50)<35)warnings.push("시장 공포 확산"); if((curMap["실물경기"]??50)<40)warnings.push("실물경기 둔화"); if((curMap["물가"]??50)<40)warnings.push("물가 압력");
  const cats=["신용위험","유동성","시장공포","실물경기","물가"]; let sumSqTop=0; cats.forEach(cat=>{const cur=curMap[cat]??50; const cri=top?.cat?.[cat]??50; sumSqTop+=Math.pow(cur-cri,2);}); const distToTop=Math.sqrt(sumSqTop); const proximityScore=Math.max(0,Math.round((1-distToTop/250)*100));
  const indicators=defconData.indicators||[]; const dangerCount=indicators.filter(i=>i.score<0).length; const dangerDensity=indicators.length>0?Math.round((dangerCount/indicators.length)*100):0; const composite=proximityScore*.6+dangerDensity*.4; const estimatedMonths=composite>=72?"🔴 위기 패턴 진입":composite>=54?"🟠 경보 단계":composite>=36?"🟡 주의 단계":"🟢 안정 구간";
  const navigation={proximityScore,distToTop:Math.round(distToTop),dangerCount,totalIndicators:indicators.length,dangerDensity,estimatedMonths,topCrisis:top}; const regimeEngine=buildRegimeEngine(defconData,results,navigation,warnings); return{results,top,top2,warnings,navigation,regimeEngine};
}


// ── SEFCON Backtest Snapshot Engine — Supabase 저장용 응답 페이로드
function lastValid(arr, key = "value") {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const row = arr[i];
    const value = row?.[key] ?? row?.price ?? null;
    if (value != null && !Number.isNaN(Number(value))) return row;
  }
  return null;
}
function buildMarketSnapshotForBacktest(market = {}) {
  const kospi = lastValid(market.kospiMonthly, "price");
  const kosdaq = lastValid(market.kosdaqMonthly, "price");
  const usdkrw = lastValid(market.fx, "value");
  const vix = lastValid(market.fredVIX, "value");
  const dxy = lastValid(market.yahooDXY, "value");
  return {
    kospi: kospi ? { date: kospi.date, value: kospi.price } : null,
    kosdaq: kosdaq ? { date: kosdaq.date, value: kosdaq.price } : null,
    usdkrw: usdkrw ? { date: usdkrw.date, value: usdkrw.value } : null,
    vix: vix ? { date: vix.date, value: vix.value } : null,
    dxy: dxy ? { date: dxy.date, value: dxy.value } : null,
  };
}
function buildBacktestEnginePayload({ defconData, crisisAnalysis, market }) {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10);
  const regimeEngine = crisisAnalysis?.regimeEngine || {};
  const transitionRisk = regimeEngine?.transitionRisk || null;
  const snapshotKey = `SEFCON-v3-${ymd}`;
  return {
    enabled: true,
    mode: "shadow",
    engineVersion: "SEFCON-v3.0-100events-backtest",
    snapshotKey,
    snapshotDate: ymd,
    createdAt: now.toISOString(),
    horizons: ["1M", "3M", "6M", "12M"],
    prediction: {
      sefconScore: defconData?.totalScore ?? null,
      sefconRisk: defconData?.totalScore != null ? Math.max(0, Math.min(100, 100 - defconData.totalScore)) : null,
      defconLevel: defconData?.level ?? null,
      regime: regimeEngine?.regime ?? null,
      transitionRisk,
      topMatches: (regimeEngine?.topMatches || []).slice(0, 5).map(m => ({
        id: m.id, label: m.label, date: m.date, type: m.type, phase: m.phase, similarity: m.similarity,
        impact: m.impact || null,
      })),
      allocationGuide: regimeEngine?.allocationGuide ?? null,
      currentVector: regimeEngine?.currentVector ?? null,
      dangerousIndicatorDensity: crisisAnalysis?.navigation?.dangerDensity ?? null,
    },
    marketSnapshot: buildMarketSnapshotForBacktest(market),
    evaluationPolicy: {
      method: "forward_return_vs_transition_risk",
      errorTypes: ["정확한방어신호", "정확한공격신호", "과잉경고", "위험과소평가", "중립"],
      note: "App.jsx가 Supabase에 스냅샷을 저장하고, 평가일이 도래하면 현재 시장값과 비교해 outcome을 기록합니다.",
    },
  };
}

// ── SEFCON
function calcDefcon(indicators) {
  // ── 카테고리 가중치 (KLR 연구 기반 선행성 반영)
  // 신용위험 30% — 가장 빠른 선행지표 집중
  // 시장공포 25% — VIX 등 실시간 반응
  // 실물경기 20% — 유지
  // 유동성   15% — 일부 후행 포함
  // 물가     10% — 가장 후행적
  const CAT_WEIGHT = {
    "신용위험": 0.30,
    "시장공포": 0.25,
    "실물경기": 0.20,
    "유동성":   0.15,
    "물가":     0.10,
  };
  const cats = Object.keys(CAT_WEIGHT);

  const catScores = cats.map(cat => {
    const inds   = indicators.filter(i => i.cat === cat);
    const catRaw = inds.reduce((s, i) => s + i.score, 0);
    // catMax: 지표별 최대 가중 점수 합산
    // T10Y2Y(×2)→max4, Baa/HY/LEI(×1.5)→max3, 일반→max2
    const catMax = inds.reduce((s, i) => {
      const absScore = Math.abs(i.score);
      if (absScore > 3) return s + 4;       // ×2 지표
      if (absScore > 2) return s + 3;       // ×1.5 지표
      return s + 2;                          // 일반 지표
    }, 0) || (inds.length * 2);
    const score = catMax > 0 ? Math.round((catRaw + catMax) / (catMax * 2) * 100) : 50;
    return { cat, score: Math.max(0, Math.min(100, score)), count: inds.length, weight: CAT_WEIGHT[cat] };
  });

  // ── 전체 점수 = 카테고리 가중 평균 (선행성 반영)
  const totalScore = Math.round(
    catScores.reduce((s, c) => s + c.score * c.weight, 0)
  );
  const maxScore = 100;

  let defcon, defconLabel, defconColor, defconDesc;
  if      (totalScore <= 30) { defcon=1; defconLabel="SEFCON 1  붕괴임박"; defconColor="#FF1A1A"; defconDesc="복수의 위기 신호 동시 발생. 현금 비중 최우선. 역사적 위기 수준에 근접"; }
  else if (totalScore <= 45) { defcon=2; defconLabel="SEFCON 2  위기";     defconColor="#FF6B00"; defconDesc="선행지표 다수 경고. 리스크 자산 비중 즉시 축소 검토"; }
  else if (totalScore <= 58) { defcon=3; defconLabel="SEFCON 3  경계";     defconColor="#F0C800"; defconDesc="일부 지표 악화. 포트폴리오 점검 및 방어적 포지션 준비"; }
  else if (totalScore <= 72) { defcon=4; defconLabel="SEFCON 4  관망";     defconColor="#38BDF8"; defconDesc="대체로 양호. 선별적 기회 탐색 가능"; }
  else                       { defcon=5; defconLabel="SEFCON 5  안정";     defconColor="#00C878"; defconDesc="전 지표 정상. 적극적 투자 환경"; }

  return { defcon, defconLabel, defconColor, defconDesc, totalScore, maxScore, indicators, catScores };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // ── 디버그 모드: ?debug=1 — 각 시리즈 개별 테스트
  if (req.query?.debug === "1") {
    const tests = [
      ["기준금리", "722Y001", "0101000", "D", "20220101", "20241231"],
      // ── 명목 GDP 분기 후보
      ["GDP명목분기_200Y103_10106", "200Y103", "10106", "Q", "2020Q1", "2024Q4"],  // 계절조정, 명목, 분기 - GDP
      ["GDP명목분기_200Y103_AA",    "200Y103", "AA",    "Q", "2020Q1", "2024Q4"],  // 와일드카드
      ["GDP명목분기_200Y105_10106", "200Y105", "10106", "Q", "2020Q1", "2024Q4"],  // 원계열, 명목, 분기
      ["GDP명목분기_200Y107_10106", "200Y107", "10106", "Q", "2020Q1", "2024Q4"],  // 지출기준, 계절조정, 명목
      ["GDP명목연간_200Y113_10106", "200Y113", "10106", "A", "2015",   "2024"  ],  // 명목, 연간 (이미 스크린샷 확인)
      // ── 한국 대출행태서베이 (한국판 SLOOS)
      ["KR_SLOOS_대출태도_514Y001", "514Y001", "1",     "Q", "2020Q1", "2024Q4"],  // 대출태도
      ["KR_SLOOS_대출태도_AA",      "514Y001", "AA",    "Q", "2020Q1", "2024Q4"],
      ["KR_SLOOS_신용위험_514Y002", "514Y002", "1",     "Q", "2020Q1", "2024Q4"],  // 신용위험
      ["KR_SLOOS_대출수요_514Y003", "514Y003", "1",     "Q", "2020Q1", "2024Q4"],  // 대출수요
    ];
    const results = {};
    for (const [name, stat, item, freq, sd, ed] of tests) {
      // encodeURIComponent 제거 — 와일드카드(*) 그대로 전송
      const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/3/${stat}/${freq}/${sd}/${ed}/${item}`;
      try {
        const r = await fetch(url);
        const json = await r.json();
        results[name] = {
          code: json?.RESULT?.CODE || "OK",
          msg:  json?.RESULT?.MESSAGE || "",
          rows: json?.StatisticSearch?.row?.length || 0,
          sample: json?.StatisticSearch?.row?.[0] || null,
        };
      } catch(e) { results[name] = { error: e.message }; }
    }
    return res.status(200).json({ keyPresent: !!ECOS_KEY, keyPreview: ECOS_KEY?ECOS_KEY.slice(0,4)+"****":"EMPTY", keyLen: ECOS_KEY.length, keyFull: ECOS_KEY, results });
  }

  if (Date.now() - cache.ts < CACHE_TTL && cache.data) {
    return res.status(200).json(cache.data);
  }

  try {
    const now      = new Date();
    const endY     = now.getFullYear();
    const endM     = String(now.getMonth() + 1).padStart(2, "0");
    const endDate  = `${endY}${endM}`;
    const endD     = String(now.getDate()).padStart(2, "0");
    const endDate8 = `${endY}${endM}${endD}`;
    const startDate  = `${endY - 8}01`;
    const startDate8 = `${endY - 2}0101`;  // 일별은 최근 2년만 (200개 제한 대응)
    const startDateQ = `${endY - 8}Q1`;

    // ── 병렬 호출: ECOS 14개 + Yahoo 지수+4개 + FRED 8개
    const [gdpR, exportR, rateR, fxR, ppiR, bsiR, cpiR, kospiR, kosdaqR, hhCreditR, bond10YR, bond3YR,
           fredT10Y2YR, fredHYR, fredDGS10R, fredVIXR, fredUNRATER,
           fredSLOOSR, krSloosR, fredLEIR, fredICSAR, fredBAMLR,
           yahooBIZDR, yahooDXYR, yahooHGR, yahooGCR,
           ecosCDR, nominalGdpR,
           fredM2SLR, ecosKrM2R,
           foreignNetR] =
      await Promise.allSettled([
        fetchECOS("200Y102", "10111",   startDateQ, `${endY}Q4`, "Q"),  // GDP 실질 전기비%
        fetchECOS("901Y118", "T002",    startDate,  endDate,     "M"),  // 수출금액(천불)
        fetchECOS("722Y001", "0101000", startDate8, endDate8,    "D"),  // 기준금리(일별)
        fetchECOS("731Y003", "0000003", startDate8, endDate8,    "D"),  // 원/달러 종가(일별)
        fetchECOS("404Y014", "*AA",     startDate,  endDate,     "M"),  // PPI 총지수
        fetchECOS("512Y013", "99988",   startDate,  endDate,     "M"),  // BSI 전산업
        fetchECOS("901Y009", "0",       startDate,  endDate,     "M"),  // CPI 총지수
        fetchIndexMonthly("^KS11"),                                      // 코스피 월봉
        fetchIndexMonthly("^KQ11"),                                      // 코스닥 월봉
        fetchECOS("151Y001", "1000000", startDateQ, `${endY}Q4`, "Q"),  // 가계신용 잔액(분기, 십억원)
        fetchECOS("721Y001", "5050000", startDate,  endDate,     "M"),  // 국고채 10Y 수익률
        fetchECOS("721Y001", "5020000", startDate,  endDate,     "M"),  // 국고채 3Y 수익률
        fetchFRED("T10Y2Y",           `${endY - 3}-01-01`),             // 미국 장단기 금리차
        fetchFRED("DBAA",             `${endY - 3}-01-01`),             // 무디스 Baa 회사채
        fetchFRED("DGS10",            `${endY - 3}-01-01`),             // 미국 10년 국채 수익률
        fetchVIXMonthly(),                                               // VIX (Yahoo)
        fetchFRED("UNRATE",           `${endY - 5}-01-01`),             // 미국 실업률
        fetchFRED("DRTSCILM",         `${endY - 5}-01-01`),             // 미국 SLOOS 은행대출 기준강화 (복원)
        fetchECOS("514Y001", "AA",      startDateQ, `${endY}Q4`, "Q"),  // 한국 대출행태서베이 — 대출태도
        fetchFRED("USALOLITONOSTSAM", `${endY - 5}-01-01`),             // 미국 LEI 경기선행지수
        fetchFRED("IC4WSA",           `${endY - 3}-01-01`),             // 주간 실업청구 4주이동평균(천건)
        fetchFRED("BAMLH0A0HYM2",     `${endY - 5}-01-01`),             // ICE BofA HY 스프레드 (사모신용 대용)
        fetchYahooMonthly("BIZD", 5),                                    // BIZD ETF 가격 (그래프 참고용)
        fetchYahooMonthly("DX-Y.NYB", 5),                               // DXY 달러인덱스
        fetchYahooMonthly("HG=F", 5),                                    // 구리 선물
        fetchYahooMonthly("GC=F", 5),                                    // 금 선물
        fetchECOS("721Y001", "5010000", startDate,  endDate,     "M"),  // CD 91일물 수익률
        fetchECOS("200Y113", "10106",   `${endY - 10}`, `${endY}`, "A"),// 명목 GDP 연간 (십억원) — 자동 갱신
        fetchFRED("M2SL",             `${endY - 8}-01-01`),             // 미국 M2 통화량 (월별, 십억달러)
        fetchECOS("161Y006", "BBHA00", startDate,  endDate,     "M"),  // 한국 M2 광의통화 평잔 원계열 (월별, 십억원)
        fetchECOS("901Y055", "S22CC",  startDate,  endDate,     "M"),  // 외국인 KOSPI 순매수 (월별)
      ]);

    const ok = r => r.status === "fulfilled" ? r.value : [];

    const gdpArr        = ok(gdpR);
    const exportArr     = ok(exportR);
    const rateArr       = ok(rateR);
    const fxArr         = ok(fxR);
    const ppiArr        = ok(ppiR);
    const bsiArr        = ok(bsiR);
    const cpiArr        = ok(cpiR);
    const kospiMonthly  = ok(kospiR);
    const kosdaqMonthly = ok(kosdaqR);
    const hhCreditArr   = ok(hhCreditR);
    const bond10YArr    = ok(bond10YR);
    const bond3YArr     = ok(bond3YR);
    const fredT10Y2YRaw = ok(fredT10Y2YR);
    const fredHYRaw     = ok(fredHYR);
    const fredDGS10Raw  = ok(fredDGS10R);
    const fredVIXRaw    = ok(fredVIXR);
    const fredUNRATE    = ok(fredUNRATER);
    // 신규
    const fredSLOOSRaw  = ok(fredSLOOSR);  // 미국 SLOOS (복원)
    const krSloosRaw    = ok(krSloosR);    // 한국 대출행태서베이 (분기)
    const fredLEIRaw    = ok(fredLEIR);
    const fredICSARaw   = ok(fredICSAR);
    const fredBAMLRaw   = ok(fredBAMLR);   // ICE BofA HY 스프레드
    const yahooBIZDRaw  = ok(yahooBIZDR);
    const yahooDXYRaw   = ok(yahooDXYR);
    const yahooHGRaw    = ok(yahooHGR);
    const yahooGCRaw    = ok(yahooGCR);
    const ecosCDRaw     = ok(ecosCDR);
    const nominalGdpArr = ok(nominalGdpR); // 명목 GDP 연간 (십억원)
    const fredM2SLRaw   = ok(fredM2SLR);   // 미국 M2 (십억달러)
    const ecosKrM2Raw   = ok(ecosKrM2R);   // 한국 M2 (십억원)
    const foreignNetRaw = ok(foreignNetR); // 외국인 KOSPI 순매수 (월별)

    // ── 가공
    // GDP: 이미 전기비% → yoy 필드로 매핑
    const gdp         = gdpArr.map(r => ({ ...r, yoy: r.value }));
    const gdpLevel    = gdpArr;
    // 수출: 천불 → 일평균$M (1천불/21일/1000 = $M)
    const dailyExport = exportArr.map(r => ({ date: r.date, value: +(r.value / 21000).toFixed(1) }));
    const exportYoY   = calcMonthlyYoY(dailyExport);
    const rate        = dailyToMonthly(rateArr);
    const fx          = dailyToMonthly(fxArr);
    const ppi         = calcMonthlyYoY(ppiArr);
    // BSI: itemCode 99988은 한 달에 여러 row → 날짜별 마지막 값만 유지
    const bsiMap = {};
    for (const r of bsiArr) bsiMap[r.date] = r.value;
    const bsi = Object.entries(bsiMap).sort((a,b)=>a[0]>b[0]?1:-1).map(([date,value])=>({date,value}));
    const cpi         = calcMonthlyYoY(cpiArr);

    // ── 가계신용 YoY (분기, 전년동기비 %)
    const hhCreditYoY = calcQuarterlyYoY(hhCreditArr);

    // ── 장단기 금리차: 국고채 10Y − 3Y (월별, %p)
    const yieldSpread = bond10YArr.map(r => {
      const b3 = bond3YArr.find(b => b.date === r.date);
      return b3 != null ? { date: r.date, value: +(r.value - b3.value).toFixed(2) } : null;
    }).filter(Boolean);

    // ── FRED 일별 → 월별 변환
    const fredT10Y2Y = dailyToMonthly(fredT10Y2YRaw);
    // Baa-국채 신용스프레드 = DBAA - DGS10 (기준금리 영향 제거)
    const fredDGS10M  = dailyToMonthly(fredDGS10Raw);
    const dgs10Map    = {};
    fredDGS10M.forEach(r => { dgs10Map[r.date] = r.value; });
    const fredHY = dailyToMonthly(fredHYRaw).map(r => {
      const t10 = dgs10Map[r.date];
      return t10 != null ? { date: r.date, value: +(r.value - t10).toFixed(2) } : null;
    }).filter(Boolean);
    const fredVIX    = fredVIXRaw;  // Yahoo에서 이미 월별로 옴
    const lastFRED   = arr => arr?.slice(-1)[0]?.value ?? null;

    // ── 신규 가공
    // 미국 SLOOS: 일별 → 월별 (양수 = 대출기준 강화, 분기 발표 → 월별 근사)
    const fredSLOOS = dailyToMonthly(fredSLOOSRaw);
    // 한국 대출행태서베이 — 대출태도 (분기, 양수=대출기준 강화)
    const krSloos = krSloosRaw;  // ECOS 분기 데이터 그대로 사용
    // LEI: 일별 → 월별 (OECD 선행지수, 100 기준)
    const fredLEI = dailyToMonthly(fredLEIRaw);
    // IC4WSA: 주간 실업청구 4주이동평균 → 월별 (천건 단위)
    const fredICSA = dailyToMonthly(fredICSARaw.map(r => ({ ...r, value: +(r.value / 1000).toFixed(1) })));
    // UNRATE: 미국 실업률 (월별, %) — 이미 월별이므로 dailyToMonthly 불필요
    const fredUNRATEMonthly = fredUNRATE
      .map(r => ({ date: r.date.slice(0,6), value: r.value }))
      .filter(r => r.date && r.value != null);
    // ICE BofA HY 스프레드 — 일별 → 월별 (사모신용 위험 프리미엄 대용)
    const fredBAML = dailyToMonthly(fredBAMLRaw);
    // BIZD ETF 가격 (그래프 참고용만 — 지표 계산 미사용)
    const yahooBIZD = yahooBIZDRaw;
    // DXY 달러인덱스
    const yahooDXY = yahooDXYRaw;
    // 구리/금 비율 (월별 매칭)
    const yahooHG = yahooHGRaw;
    const yahooGC = yahooGCRaw;
    const copperGoldMap = {};
    yahooGC.forEach(r => { copperGoldMap[r.date] = r.value; });
    const copperGold = yahooHG.map(r => {
      const gold = copperGoldMap[r.date];
      return gold ? { date: r.date, value: +(r.value / gold * 1000).toFixed(4) } : null;
    }).filter(Boolean);
    // CD금리 스프레드 = CD91일 - 기준금리
    const cdMonthly = ecosCDRaw;
    const rateMonthly = dailyToMonthly(rateArr);
    const rateMap2 = {};
    rateMonthly.forEach(r => { rateMap2[r.date] = r.value; });
    const cdSpread = cdMonthly.map(r => {
      const base = rateMap2[r.date];
      return base != null ? { date: r.date, value: +(r.value - base).toFixed(2) } : null;
    }).filter(Boolean);
    // ── 가계부채/GDP 비율 — 명목 GDP 연간 자동 갱신 (200Y113/10106, 십억원)
    // 분기 근사: 연간÷4. 가계신용 잔액(십억원) ÷ 분기GDP(십억원) × 100
    const nominalGdpByYear = {};
    nominalGdpArr.forEach(r => { nominalGdpByYear[r.date] = r.value; }); // key: "2023" 등 연도
    const hhDebtGDP = hhCreditArr.map(r => {
      const yr = r.date?.slice(0, 4);
      // 해당 연도 없으면 가장 최근 연도 사용 (미공표 최근 분기 대응)
      const gdpAnnual = nominalGdpByYear[yr]
        ?? nominalGdpByYear[String(+yr - 1)]
        ?? nominalGdpByYear[String(+yr - 2)]
        ?? null;
      if (!gdpAnnual || !r.value) return null;
      // ECOS 151Y001 협의 기준: 예금취급기관 대출 + 판매신용 ÷ 연간 명목 GDP × 100
      // BIS 광의(~105%)와 다름 — 보정계수 없이 실제값 그대로 사용
      return { date: r.date, value: +(r.value / gdpAnnual * 100).toFixed(1) };
    }).filter(Boolean);

    // ── 미국/한국 M2 통화량 YoY 계산
    // M2SL은 FRED 월별 데이터 (단위: 십억달러) — dailyToMonthly 불필요, 이미 월별
    const usM2 = fredM2SLRaw.map(r => ({ date: r.date?.slice(0,7)?.replace("-","."), value: r.value })).filter(r=>r.date&&r.value!=null);
    const usM2YoY = calcMonthlyYoY(usM2); // { date, value(절대값), yoy }
    // 한국 M2: ECOS 월별 (십억원)
    const krM2 = ecosKrM2Raw.map(r => ({ date: r.date, value: r.value })).filter(r=>r.date&&r.value!=null);
    const krM2YoY = calcMonthlyYoY(krM2);

    // ── 외국인 KOSPI 순매수 (월별, 단위 확인 후 조정 필요)
    // S22CC: 외국인 순매수 → 양수=순매수, 음수=순매도
    // 3개월 이동평균으로 노이즈 제거 후 방향성 판단
   const foreignNet = foreignNetRaw
  .filter(r => r.itemCode2 === "VA") // 거래대금만 사용, VO(거래량)는 제외
  .map(r => ({
    date: r.date?.slice(0,6) ?? r.date,
    value: +(r.value / 100).toFixed(0) // 백만원 → 억원
  }))
  .filter(r => r.date && r.value != null);
    // 3개월 이동평균
    const foreignNet3M = foreignNet.map((r, i) => {
      if (i < 2) return { ...r, ma3: null };
      const avg = (foreignNet[i].value + foreignNet[i-1].value + foreignNet[i-2].value) / 3;
      return { ...r, ma3: +avg.toFixed(0) };
    });
    const lastForeignNet3M = foreignNet3M.filter(r => r.ma3 != null).slice(-1)[0]?.ma3 ?? null;
    // 최근 3개월 연속 방향 판단
 const foreignNetTrend = (() => {
  const recent = foreignNet.slice(-3).map(r => r.value);
  if (recent.length < 3) return null;

  const avg = recent.reduce((a,b)=>a+b,0) / 3; // 3개월 평균 (억원)

  // 🔥 규모 기준 (먼저 체크)
  if (avg <= -100000) return -2; // -10조 이상 매도 → 매물폭탄
  if (avg <= -30000)  return -1; // -3조 이상 매도

  if (avg >= 100000) return +2; // +10조 이상 매수
  if (avg >= 30000)  return +1; // +3조 이상 매수

  // 📉 방향 기준 (보조)
  if (recent.every(v => v < 0)) return -2;
  if (recent.filter(v => v < 0).length >= 2) return -1;

  if (recent.every(v => v > 0)) return +2;
  if (recent.filter(v => v > 0).length >= 2) return +1;

  return 0;
})();
    
    // ── SEFCON 지표
    const last    = arr => arr?.slice(-1)[0]?.value ?? null;
    const lastYoy = arr => [...(arr||[])].reverse().find(r=>r.yoy!=null)?.yoy ?? null;

    const scoreV = (v, [bad2, bad1, good1, good2], dir = 1) => {
      if (v == null) return 0;
      if (v * dir >= bad2  * dir) return -2;
      if (v * dir >= bad1  * dir) return -1;
      if (v * dir <= good2 * dir) return +2;
      if (v * dir <= good1 * dir) return +1;
      return 0;
    };

    const indicators = [
      // ── 신용위험 (6개)
      // T10Y2Y: 12~18개월 선행 → ×2 유지
      { cat:"신용위험", key:"미국금리역전", label:"미국 장단기금리차(T10Y2Y)", val:lastFRED(fredT10Y2Y), unit:"%",
        good:"정상", warn:"평탄", bad:"역전",
        score: scoreV(lastFRED(fredT10Y2Y), [-1.0, -0.5, 0.5, 1.0], -1) * 2 },
      // Baa스프레드: 6~12개월 선행 → ×1.5
      { cat:"신용위험", key:"하이일드", label:"미국 Baa 신용스프레드", val:lastFRED(fredHY), unit:"%p",
        good:"안정", warn:"경계", bad:"급등",
        score: Math.round(scoreV(lastFRED(fredHY), [4.0, 3.0, 2.0, 1.5], 1) * 1.5) },
      { cat:"신용위험", key:"금리차KR", label:"한국 10Y-3Y 금리차", val:last(yieldSpread), unit:"%p",
        good:"정상화", warn:"평탄", bad:"역전",
        score: scoreV(last(yieldSpread), [-0.5, 0.0, 0.5, 1.0], -1) },
      // HY스프레드: 6~12개월 선행 → ×1.5
      { cat:"신용위험", key:"HY스프레드", label:"ICE BofA HY 스프레드", val:lastFRED(fredBAML), unit:"%p",
        good:"안정", warn:"경계", bad:"위기",
        score: Math.round(scoreV(lastFRED(fredBAML), [9.0, 6.0, 4.0, 3.0], 1) * 1.5) },
      { cat:"신용위험", key:"미국SLOOS", label:"미국 SLOOS 대출기준강화", val:lastFRED(fredSLOOS), unit:"%",
        good:"완화", warn:"중립", bad:"강화",
        score: scoreV(lastFRED(fredSLOOS), [50, 20, -5, -20], 1) },
      { cat:"신용위험", key:"한국SLOOS", label:"한국 은행 대출태도지수", val:last(krSloos), unit:"",
        good:"완화", warn:"중립", bad:"강화",
        score: scoreV(last(krSloos), [40, 20, -5, -20], 1) },

      // ── 유동성 (6개)
      { cat:"유동성", key:"미국M2", label:"미국 M2 통화량 YoY", val:lastYoy(usM2YoY), unit:"%",
        good:"양호", warn:"주의", bad:"긴축/버블",
        score: (()=>{const v=lastYoy(usM2YoY);if(v==null)return 0;if(v<-2)return -2;if(v<0)return -1;if(v<=5)return 0;if(v<=10)return +1;return 0;})() },
      { cat:"유동성", key:"한국M2", label:"한국 M2 통화량 YoY", val:lastYoy(krM2YoY), unit:"%",
        good:"양호", warn:"주의", bad:"긴축/버블",
        score: (()=>{const v=lastYoy(krM2YoY);if(v==null)return 0;if(v<-2)return -2;if(v<0)return -1;if(v<=5)return 0;if(v<=10)return +1;return 0;})() },
      { cat:"유동성", key:"기준금리", label:"한국 기준금리", val:last(rate), unit:"%",
        good:"완화적", warn:"중립", bad:"긴축",
        score: scoreV(last(rate), [4.0, 3.0, 2.0, 1.0], 1) },
      { cat:"유동성", key:"환율", label:"원/달러 환율", val:last(fx), unit:"원",
        good:"강세", warn:"중립", bad:"약세",
        score: scoreV(last(fx), [1450, 1380, 1250, 1150], 1) },
      { cat:"유동성", key:"CD스프레드", label:"CD금리-기준금리 스프레드", val:last(cdSpread), unit:"%p",
        good:"안정", warn:"보통", bad:"확대",
        score: scoreV(last(cdSpread), [1.5, 1.0, 0.3, 0.1], 1) },
      { cat:"유동성", key:"가계부채GDP", label:"가계부채/GDP (ECOS협의)", val:last(hhDebtGDP), unit:"%",
        good:"안정", warn:"주의", bad:"과부하",
        score: scoreV(last(hhDebtGDP), [82, 75, 65, 60], 1) },

      // ── 시장공포 (3개)
      { cat:"시장공포", key:"VIX", label:"VIX 공포지수", val:lastFRED(fredVIX), unit:"",
        good:"안정", warn:"경계", bad:"공포",
        score: scoreV(lastFRED(fredVIX), [35, 25, 18, 13], 1) },
      { cat:"시장공포", key:"BSI", label:"BSI 제조업", val:last(bsi), unit:"",
        good:"확장", warn:"중립", bad:"수축",
        score: scoreV(last(bsi), [80, 90, 100, 110], -1) },
      { cat:"시장공포", key:"DXY", label:"DXY 달러인덱스", val:last(yahooDXY), unit:"",
        good:"약세", warn:"중립", bad:"강세",
        score: scoreV(last(yahooDXY), [108, 104, 100, 97], 1) },
      // 외국인 KOSPI 순매수: 3개월 연속 방향성으로 판단
      // 순매도 지속 = 외국인 이탈 = 시장공포/위험 신호
      { cat:"시장공포", key:"외국인순매수", label:"외국인 KOSPI 순매수 추이",
        val: lastForeignNet3M == null ? null : (()=>{
          const a=Math.abs(lastForeignNet3M); const s=lastForeignNet3M>=0?"+":"-";
          return a>=10000?`${s}${(a/10000).toFixed(1)}조`:`${s}${Math.round(a).toLocaleString()}억`;
        })(),
        unit:"",
        good:"순매수", warn:"혼조", bad:"순매도",
        score: foreignNetTrend ?? 0 },

      // ── 실물경기 (6개)
      { cat:"실물경기", key:"수출", label:"한국 수출 YoY", val:lastYoy(exportYoY), unit:"%",
        good:"증가", warn:"보합", bad:"감소",
        score: scoreV(lastYoy(exportYoY), [-15, -5, 5, 15], -1) },
      { cat:"실물경기", key:"ICSA", label:"주간 실업청구(천건)", val:lastFRED(fredICSA), unit:"k",
        good:"안정", warn:"증가", bad:"급등",
        score: scoreV(lastFRED(fredICSA), [300, 250, 210, 180], 1) },
      // UNRATE: 후행지표·ICSA 중복 → score:0 고정, 화면 표시·그래프 참고용만
      { cat:"실물경기", key:"UNRATE", label:"미국 실업률 (참고)", val:fredUNRATEMonthly.slice(-1)[0]?.value??null, unit:"%",
        good:"호조", warn:"상승", bad:"침체",
        score: 0 },
      { cat:"실물경기", key:"GDP", label:"한국 GDP성장률", val:lastYoy(gdp), unit:"%",
        good:"견조", warn:"완만", bad:"침체",
        score: scoreV(lastYoy(gdp), [-1, 1, 3, 4], -1) },
      // LEI: 6개월 선행 → ×1.5
      { cat:"실물경기", key:"LEI", label:"미국 LEI 경기선행지수", val:lastFRED(fredLEI), unit:"",
        good:"확장", warn:"둔화", bad:"수축",
        score: Math.round(scoreV(lastFRED(fredLEI), [98, 99, 100.5, 101.5], -1) * 1.5) },
      { cat:"실물경기", key:"구리금", label:"구리/금 비율(×1000)", val:last(copperGold), unit:"",
        good:"강세", warn:"중립", bad:"약세",
        score: scoreV(last(copperGold), [0.15, 0.18, 0.25, 0.30], -1) },

      // ── 물가 (3개) — 후행지표, 카테고리 가중치로 영향 조정
      { cat:"물가", key:"CPI", label:"한국 CPI YoY", val:lastYoy(cpi), unit:"%",
        good:"안정", warn:"보통", bad:"고인플",
        score: scoreV(lastYoy(cpi), [5, 3, 1, 0], 1) },
      { cat:"물가", key:"PPI", label:"한국 PPI YoY", val:lastYoy(ppi), unit:"%",
        good:"안정", warn:"보통", bad:"원가↑",
        score: scoreV(lastYoy(ppi), [6, 3, 1, 0], 1) },
      { cat:"물가", key:"가계신용", label:"가계신용 YoY", val:lastYoy(hhCreditYoY), unit:"%",
        good:"감소", warn:"완만", bad:"과열",
        score: scoreV(lastYoy(hhCreditYoY), [8, 5, 2, 0], 1) },
    ];

    const defconData = calcDefcon(indicators);
    const crisisAnalysis = calcCrisisAnalysis(defconData);
    const backtestEngine = buildBacktestEnginePayload({
      defconData,
      crisisAnalysis,
      market: { kospiMonthly, kosdaqMonthly, fx, fredVIX, yahooDXY },
    });

    const data = {
      gdp, gdpLevel, dailyExport, exportYoY,
      rate, fx, ppi, cpi, bsi,
      kospiMonthly, kosdaqMonthly,
      hhCreditYoY, yieldSpread,
      fredT10Y2Y, fredHY, fredVIX, fredUNRATE, fredUNRATEMonthly,
      fredSLOOS, krSloos, fredLEI, fredICSA, fredBAML,
      yahooBIZD, yahooDXY, copperGold, yahooHG, yahooGC,
      cdSpread, hhDebtGDP,
      usM2YoY, krM2YoY,
      foreignNet, foreignNet3M,
      defconData,
      crisisAnalysis,
      backtestEngine,
      updatedAt: Date.now(),
      _debug: {
        gdp:gdpArr.length, export:exportArr.length, rate:rateArr.length,
        fx:fxArr.length, ppi:ppiArr.length, bsi:bsiArr.length, cpi:cpiArr.length,
        kospi:kospiMonthly.length, kosdaq:kosdaqMonthly.length,
        hhCredit:hhCreditArr.length, bond10Y:bond10YArr.length, bond3Y:bond3YArr.length,
        fredT10Y2Y:fredT10Y2YRaw.length, fredHY:fredHYRaw.length, fredDGS10:fredDGS10Raw.length,
        fredVIX:fredVIXRaw.length, fredUNRATE:fredUNRATE.length,
        krSloos:krSloosRaw.length, fredSLOOS:fredSLOOSRaw.length, fredLEI:fredLEIRaw.length, fredICSA:fredICSARaw.length,
        fredBAML:fredBAMLRaw.length,
        yahooBIZD:yahooBIZDRaw.length, yahooDXY:yahooDXYRaw.length,
        yahooHG:yahooHGRaw.length, yahooGC:yahooGCRaw.length,
        cdSpread:cdSpread.length, hhDebtGDP:hhDebtGDP.length, nominalGdp:nominalGdpArr.length,
        usM2:fredM2SLRaw.length, krM2:ecosKrM2Raw.length,
        foreignNet:foreignNetRaw.length,
      }
    };

    cache = { data, ts: Date.now() };
    return res.status(200).json(data);

  } catch (e) {
    console.error("[macro]", e.message);
    if (cache.data) return res.status(200).json(cache.data);
    return res.status(500).json({ error: e.message });
  }
}
