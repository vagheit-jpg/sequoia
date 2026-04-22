import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ComposedChart, AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, ReferenceDot, ReferenceArea,
} from "recharts";

// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const DART_KEY = "a7e481c4bf47725fd8b3da1d8bab2a6b1755157b";
const PROXY    = "https://api.allorigins.win/raw?url=";

const dartGet = async (ep, params = {}) => {
  const qs  = new URLSearchParams({ crtfc_key: DART_KEY, ...params }).toString();
  const url = `https://opendart.fss.or.kr/api/${ep}?${qs}`;
  try {
    const r = await fetch(PROXY + encodeURIComponent(url));
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

// Yahoo Finance 월봉 + 현재가
const fetchYahoo = async (ticker) => {
  try {
    // 10년 월봉
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.KQ?interval=1mo&range=10y`;
    const r1 = await fetch(PROXY + encodeURIComponent(chartUrl));
    const d1 = await r1.json();
    const chart = d1?.chart?.result?.[0];
    if (!chart) return { monthly: [], currentPrice: null };

    const ts     = chart.timestamp || [];
    const closes = chart.indicators.quote[0].close || [];
    const opens  = chart.indicators.quote[0].open  || [];
    const highs  = chart.indicators.quote[0].high  || [];
    const lows   = chart.indicators.quote[0].low   || [];
    const vols   = chart.indicators.quote[0].volume || [];

    const monthly = ts.map((t, i) => {
      const dt = new Date(t * 1000);
      return {
        ts: t,
        label: `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,"0")}`,
        year:  dt.getFullYear(),
        month: dt.getMonth()+1,
        price:  Math.round(closes[i] || 0),
        open:   Math.round(opens[i]  || 0),
        high:   Math.round(highs[i]  || 0),
        low:    Math.round(lows[i]   || 0),
        volume: vols[i] || 0,
      };
    }).filter(d => d.price > 0);

    // 현재가 (최신 meta)
    const currentPrice = Math.round(chart.meta?.regularMarketPrice || closes[closes.length-1] || 0);
    const prevClose    = Math.round(chart.meta?.chartPreviousClose || 0);
    const change       = currentPrice - prevClose;
    const changePct    = prevClose ? +((change/prevClose)*100).toFixed(2) : 0;

    return { monthly, currentPrice, prevClose, change, changePct };
  } catch (e) {
    console.error("Yahoo error:", e);
    return { monthly: [], currentPrice: null };
  }
};

// ═══════════════════════════════════════════════
//  색상 — 다크/라이트 모드
// ═══════════════════════════════════════════════
const DARK = {
  bg:"#040710", card:"#080D1C", card2:"#0C1228", border:"#141E35",
  grid:"#0A1020", text:"#DCE8F8", muted:"#8AA8C8", dim:"#1A2840",
  gold:"#C8962A", goldL:"#E8B840", blue:"#1E72F0", blueL:"#5BA0FF",
  green:"#00C878", greenD:"#009858", red:"#FF3D5A", orange:"#FF7830",
  purple:"#8855FF", cyan:"#00CCE8", teal:"#10A898", pink:"#E040A8",
  yellow:"#F0C020", lime:"#84CC16",
};
const LIGHT = {
  bg:"#F2F4F8", card:"#FFFFFF", card2:"#EBF0F8", border:"#D0DAE8",
  grid:"#E4EAF4", text:"#0D1B2E", muted:"#5A7090", dim:"#C8D4E4",
  gold:"#A67C00", goldL:"#C89A00", blue:"#1558CC", blueL:"#2474EE",
  green:"#007A48", greenD:"#005C34", red:"#CC1830", orange:"#CC5500",
  purple:"#6633CC", cyan:"#0099BB", teal:"#007766", pink:"#AA2288",
  yellow:"#AA8800", lime:"#4A7A00",
};
// C는 컴포넌트 내에서 동적으로 주입됨 — 초기값 DARK
let C = DARK;
const PALETTE_DARK  = [DARK.blue,DARK.green,DARK.gold,DARK.purple,DARK.cyan,DARK.teal,DARK.orange,DARK.red,DARK.pink,DARK.yellow];
const PALETTE_LIGHT = [LIGHT.blue,LIGHT.green,LIGHT.gold,LIGHT.purple,LIGHT.cyan,LIGHT.teal,LIGHT.orange,LIGHT.red,LIGHT.pink,LIGHT.yellow];
let PALETTE = PALETTE_DARK;

// ═══════════════════════════════════════════════
//  엔진 — 월봉 기반
// ═══════════════════════════════════════════════

// EMA
const ema = (arr, n) => {
  const k = 2/(n+1); let e = arr[0];
  return arr.map((v,i) => { if(i===0) return e; e = v*k + e*(1-k); return +e.toFixed(0); });
};

// 60개월 이동평균 + 이격도
const calcMA60 = (monthly) => {
  const N = 60;
  return monthly.map((d, i) => {
    if (i < N-1) return { ...d, ma60: null, gap60: null };
    const avg = monthly.slice(i-N+1, i+1).reduce((s,x)=>s+x.price,0)/N;
    const gap = +((d.price/avg - 1)*100).toFixed(2);
    return { ...d, ma60: +avg.toFixed(0), gap60: gap };
  });
};

// MA 5, 20
const calcMA = (monthly, n) => {
  return monthly.map((d,i) => {
    if (i < n-1) return { ...d, [`ma${n}`]: null };
    const avg = monthly.slice(i-n+1,i+1).reduce((s,x)=>s+x.price,0)/n;
    return { ...d, [`ma${n}`]: +avg.toFixed(0) };
  });
};

// RSI 월봉
const calcRSI = (monthly, n=14) => {
  return monthly.map((d,i) => {
    if (i < n) return { ...d, rsi: null };
    const sl = monthly.slice(i-n+1, i+1);
    let g=0, l=0;
    for(let j=1;j<sl.length;j++){
      const diff = sl[j].price - sl[j-1].price;
      if(diff>0) g+=diff; else l-=diff;
    }
    const rsi = l===0 ? 100 : 100-(100/(1+g/l/n*(n)));
    return { ...d, rsi: +rsi.toFixed(1) };
  });
};

// MACD 월봉
const calcMACD = (monthly) => {
  const cl   = monthly.map(d=>d.price);
  const e12  = ema(cl,12);
  const e26  = ema(cl,26);
  const macd = cl.map((_,i)=>+(e12[i]-e26[i]));
  const sig  = ema(macd,9);
  const hist = macd.map((m,i)=>+(m-sig[i]));
  return monthly.map((d,i)=>({ ...d, macd:macd[i], signal:sig[i], hist:hist[i] }));
};

// OBV 월봉
const calcOBV = (monthly) => {
  let obv = 0;
  return monthly.map((d,i) => {
    if(i===0) return {...d, obv:0};
    obv += d.price>monthly[i-1].price ? d.volume
         : d.price<monthly[i-1].price ? -d.volume : 0;
    return { ...d, obv };
  });
};

// MFI 월봉
const calcMFI = (monthly, n=14) => {
  return monthly.map((d,i) => {
    if(i<n) return {...d, mfi:null};
    const sl = monthly.slice(i-n+1,i+1);
    let pos=0, neg=0;
    sl.forEach((s,j)=>{
      if(j===0) return;
      const mfr = s.price*s.volume;
      if(s.price>sl[j-1].price) pos+=mfr; else neg+=mfr;
    });
    const mfi = neg===0 ? 100 : 100-(100/(1+pos/neg));
    return {...d, mfi:+mfi.toFixed(1)};
  });
};

// DCF
const calcDCF = ({fcf,gr,tg,dr,shares}) => {
  let pv=0, cf=fcf;
  for(let y=1;y<=10;y++){ cf*=(1+gr); pv+=cf/Math.pow(1+dr,y); }
  const tvPV = (cf*(1+tg)/(dr-tg)) / Math.pow(1+dr,10);
  return { intrinsic: +((pv+tvPV)/shares).toFixed(0) };
};

// PER/PBR 밴드 생성 — 연간 EPS/BPS를 월 단위 선형 보간하여 곡선형 밴드 생성
const buildBands = (monthly, annData) => {
  // 연도별 EPS/BPS 맵
  const epsMap = {}, bpsMap = {};
  annData.forEach(r => { epsMap[r.year] = r.eps; bpsMap[r.year] = r.bps || 0; });

  // 보간: 각 월의 EPS/BPS를 전년도 → 당해연도 사이 선형 보간
  // 예) 2022년 1월 = 2021 EPS + 전년차분 EPS * 1/12
  const interpVal = (year, month, map) => {
    const years = Object.keys(map).map(Number).sort((a,b)=>a-b);
    // 가장 가까운 이전·이후 연도 찾기
    let y0 = years.filter(y => y <= year).slice(-1)[0];
    let y1 = years.filter(y => y >  year)[0];
    if (!y0) y0 = years[0];
    if (!y1) return map[y0] || 400; // 미래 연도 없으면 마지막값 유지
    const v0 = map[y0], v1 = map[y1];
    // y0 의 12월 → y1 의 12월 사이에서 현재 월 위치
    const totalMonths = (y1 - y0) * 12;
    const elapsedMonths = (year - y0) * 12 + (month - 1);
    const t = elapsedMonths / totalMonths;
    return v0 + (v1 - v0) * t;
  };

  return monthly.map(d => {
    const eps = interpVal(d.year, d.month, epsMap);
    const bps = interpVal(d.year, d.month, bpsMap);
    return {
      ...d,
      perLo:  Math.round(eps * 7),    // PER 7배  (저평가 하단)
      perHi:  Math.round(eps * 20),   // PER 20배 (고평가 상단)
      pbrLo:  Math.round(bps * 1.0),  // PBR 1배  (저평가 하단)
      pbrHi:  Math.round(bps * 3.5),  // PBR 3.5배 (고평가 상단)
      perMid: Math.round(eps * 13),   // PER 중간선 참고용
    };
  });
};

// F-Score
const calcFScore = (fin) => {
  const items = [
    {name:"ROA > 0",        val:fin.roa>0?1:0,       desc:"수익성"},
    {name:"ΔROA > 0",       val:fin.droa>0?1:0,      desc:"수익 개선"},
    {name:"CFO > 0",        val:fin.cfo>0?1:0,       desc:"영업현금"},
    {name:"발생액 < 0",     val:fin.accrual<0?1:0,   desc:"이익 질"},
    {name:"레버리지 감소",  val:fin.lever<0?1:0,     desc:"재무안정"},
    {name:"유동성 개선",    val:fin.liquid>0?1:0,    desc:"유동성"},
    {name:"주식 미발행",    val:fin.dilution<=0?1:0, desc:"희석 없음"},
    {name:"매출총이익률 ↑", val:fin.gross>0?1:0,     desc:"경쟁력"},
    {name:"자산회전율 ↑",   val:fin.ato>0?1:0,       desc:"효율성"},
  ];
  return { items, total: items.reduce((s,x)=>s+x.val,0) };
};

// ═══════════════════════════════════════════════
//  분기 수급 데이터 (엠아이텍 샘플 — KRX 연동 전)
//  inst/foreign: 분기 순매수(억), instPct/foreignPct: 지분율(%)
// ═══════════════════════════════════════════════
const Q_SUPPLY_DATA = [
  {label:"2021\nQ1",y:2021,q:1,inst:12, foreign:8,  instPct:7.8, foreignPct:5.6},
  {label:"2021\nQ2",y:2021,q:2,inst:25, foreign:18, instPct:8.2, foreignPct:6.1},
  {label:"2021\nQ3",y:2021,q:3,inst:15, foreign:22, instPct:8.5, foreignPct:6.8},
  {label:"2021\nQ4",y:2021,q:4,inst:30, foreign:25, instPct:9.0, foreignPct:7.2},
  {label:"2022\nQ1",y:2022,q:1,inst:42, foreign:38, instPct:9.5, foreignPct:7.9},
  {label:"2022\nQ2",y:2022,q:2,inst:65, foreign:72, instPct:10.2,foreignPct:9.1},
  {label:"2022\nQ3",y:2022,q:3,inst:-20,foreign:30, instPct:9.8, foreignPct:9.5},
  {label:"2022\nQ4",y:2022,q:4,inst:-35,foreign:-28,instPct:9.1, foreignPct:8.8},
  {label:"2023\nQ1",y:2023,q:1,inst:88, foreign:95, instPct:9.8, foreignPct:9.5},
  {label:"2023\nQ2",y:2023,q:2,inst:-45,foreign:-52,instPct:9.0, foreignPct:8.6},
  {label:"2023\nQ3",y:2023,q:3,inst:-30,foreign:-18,instPct:8.6, foreignPct:8.2},
  {label:"2023\nQ4",y:2023,q:4,inst:20, foreign:15, instPct:8.8, foreignPct:8.4},
  {label:"2024\nQ1",y:2024,q:1,inst:38, foreign:42, instPct:9.2, foreignPct:8.9},
  {label:"2024\nQ2",y:2024,q:2,inst:22, foreign:30, instPct:9.4, foreignPct:9.2},
  {label:"2024\nQ3",y:2024,q:3,inst:-10,foreign:18, instPct:9.2, foreignPct:9.4},
  {label:"2024\nQ4",y:2024,q:4,inst:5,  foreign:-8, instPct:9.3, foreignPct:9.2},
  {label:"2025\nQ1",y:2025,q:1,inst:45, foreign:50, instPct:9.8, foreignPct:9.8},
  {label:"2025\nQ2",y:2025,q:2,inst:32, foreign:28, instPct:10.1,foreignPct:10.0},
  {label:"2025\nQ3",y:2025,q:3,inst:-15,foreign:12, instPct:9.9, foreignPct:10.1},
  {label:"2025\nQ4",y:2025,q:4,inst:28, foreign:22, instPct:10.2,foreignPct:10.3},
];

/**
 * 수급 신호 감지 — 의미있는 조건 기반
 * 쌍매수⭐: 기관+외인 지분율 동시 +0.5%p 이상 증가
 * 쌍매도⚠: 기관+외인 지분율 동시 -0.5%p 이상 감소
 * 외인집중🌐: 외인 지분율 +0.5%p 이상 단독 증가
 * 기관집중🏦: 기관 지분율 +0.5%p 이상 단독 증가
 * → 신호 없음이 정상, 신호가 희소할수록 신뢰도 높음
 */
const INST_THRESH    = 0.5;  // 기관 지분율 변화 임계값(%)
const FOREIGN_THRESH = 0.4;  // 외인 지분율 변화 임계값(%)

const detectQSignals = (qData) => {
  return qData.map((d, i) => {
    if (i === 0) return { ...d, signal: null };
    const prev       = qData[i - 1];
    const dInst      = +(d.instPct    - prev.instPct).toFixed(2);
    const dForeign   = +(d.foreignPct - prev.foreignPct).toFixed(2);
    let signal = null;
    if (dInst >= INST_THRESH && dForeign >= FOREIGN_THRESH) {
      signal = { type:"쌍매수", color:C.green,  icon:"⭐", dInst, dForeign };
    } else if (dInst <= -INST_THRESH && dForeign <= -FOREIGN_THRESH) {
      signal = { type:"쌍매도", color:C.red,    icon:"⚠",  dInst, dForeign };
    } else if (dForeign >= FOREIGN_THRESH) {
      signal = { type:"외인집중", color:C.blueL, icon:"🌐", dInst, dForeign };
    } else if (dInst >= INST_THRESH) {
      signal = { type:"기관집중", color:C.purple,icon:"🏦", dInst, dForeign };
    }
    return { ...d, dInst, dForeign, signal };
  });
};

// ═══════════════════════════════════════════════
//  엠아이텍 기본 데이터
// ═══════════════════════════════════════════════
const ANN_DATA = [
  {year:2018,rev:343,op:73, net:61, eps:188,roe:11.5,debt:30,curr:420,fcf:52,bps:1640},
  {year:2019,rev:372,op:68, net:67, eps:207,roe:13.0,debt:25,curr:485,fcf:58,bps:1860},
  {year:2020,rev:363,op:70, net:55, eps:170,roe:12.1,debt:23,curr:480,fcf:48,bps:2010},
  {year:2021,rev:503,op:132,net:120,eps:389,roe:20.4,debt:21,curr:480,fcf:105,bps:2300},
  {year:2022,rev:606,op:204,net:191,eps:677,roe:25.8,debt:13,curr:864,fcf:168,bps:2780},
  {year:2023,rev:464,op:141,net:130,eps:400,roe:14.5,debt:6, curr:1672,fcf:130,bps:3020},
  {year:2024,rev:538,op:176,net:183,eps:565,roe:18.1,debt:9, curr:995, fcf:170,bps:3363},
  {year:2025,rev:672,op:207,net:204,eps:629,roe:19.8,debt:9, curr:1055,fcf:190,bps:3850},
];

// ═══════════════════════════════════════════════
//  배당 데이터 (연도별)
// ═══════════════════════════════════════════════
const DIVIDEND_DATA = [
  {year:2015, dps:0,   yield:0,    payout:0},
  {year:2016, dps:0,   yield:0,    payout:0},
  {year:2017, dps:0,   yield:0,    payout:0},
  {year:2018, dps:100, yield:2.8,  payout:53},
  {year:2019, dps:100, yield:2.4,  payout:48},
  {year:2020, dps:100, yield:2.8,  payout:59},
  {year:2021, dps:150, yield:2.9,  payout:39},
  {year:2022, dps:200, yield:2.2,  payout:30},
  {year:2023, dps:200, yield:2.4,  payout:50},
  {year:2024, dps:250, yield:3.2,  payout:44},
  {year:2025, dps:300, yield:4.1,  payout:48},
];

// ═══════════════════════════════════════════════
//  사업정보 (엠아이텍 사업보고서 기반)
// ═══════════════════════════════════════════════
const BUSINESS_INFO = {
  overview: `엠아이텍(M.I.Tech)은 1992년 설립된 비혈관 스텐트 전문 의료기기 기업입니다. 소화기·담도·기관지·요관 등 인체 내강(lumen)을 넓히는 스텐트를 설계·제조하여 전 세계 80여 개국에 수출하고 있으며, 매출의 약 79%가 수출에서 발생합니다.`,
  products: [
    { name: "소화기 스텐트", desc: "식도·십이지장·대장 스텐트, 전체 매출의 87% 차지. 세계 최고 수준의 플렉서블리티(유연성)와 방사선 불투과성이 특징.", pct: 87 },
    { name: "내시경 상품", desc: "Olympus 등 내시경 관련 소모품 및 상품 판매. 전략적 파트너십 기반.", pct: 7 },
    { name: "기타 제품", desc: "담도·기관지·요관 스텐트 및 관련 의료기기.", pct: 6 },
  ],
  competitive: [
    { title: "글로벌 기술력", desc: "비혈관 스텐트 세계 5위권, 한국 1위. 유럽 CE·미국 FDA 인증 보유." },
    { title: "Olympus 파트너십", desc: "세계 최대 내시경 기업 Olympus와 OEM 공급 계약. 2026년 유럽 Olympus 재계약 (판가 20~30% 인상)." },
    { title: "무차입 재무구조", desc: "부채비율 8.5%로 실질적 무차입 경영. 현금성 자산 풍부." },
    { title: "R&D 역량", desc: "매출의 약 6~8%를 R&D에 투자. 생분해성 스텐트·약물방출 스텐트 등 차세대 제품 개발 중." },
  ],
  risk: [
    { title: "환율 리스크", desc: "수출 비중 79%로 원화 강세 시 매출·이익 감소 가능." },
    { title: "고객 집중", desc: "Olympus向 매출 비중이 높아 거래선 다변화 필요." },
    { title: "의료기기 규제", desc: "각국 의료기기 허가·갱신 절차에 시간·비용 소요." },
    { title: "원자재 변동", desc: "니켈·티타늄 등 원소재 가격 변동이 원가에 영향." },
  ],
  pipeline: [
    { name: "생분해성 스텐트", stage: "임상 2상", year: "2026E" },
    { name: "약물방출 스텐트", stage: "전임상", year: "2027E" },
    { name: "AI 보조 시술 시스템", stage: "연구개발", year: "2028E" },
  ],
  history: [
    { year: "1992", event: "㈜엠아이텍 설립" },
    { year: "2003", event: "KOSDAQ 상장" },
    { year: "2008", event: "Olympus사와 OEM 공급 계약 체결" },
    { year: "2015", event: "유럽 CE 인증 확대 (대장·십이지장 스텐트)" },
    { year: "2019", event: "미국 FDA 510(k) 추가 인증" },
    { year: "2022", event: "창사 최대 영업이익 달성 (204억)" },
    { year: "2026", event: "Olympus 유럽 재계약 (판가 20~30%↑)" },
  ],
};

// 월봉 샘플 데이터 (Yahoo 로드 실패 시 fallback) - 2015.01 ~ 2025.12
const buildFallbackMonthly = () => {
  const data = [];
  const base = [
    // [year, month, price, vol]
    [2015,1,1750,120000],[2015,4,1900,130000],[2015,7,2000,125000],[2015,10,2050,140000],
    [2016,1,2100,145000],[2016,4,2250,155000],[2016,7,2350,150000],[2016,10,2480,160000],
    [2017,1,2550,165000],[2017,4,2700,175000],[2017,7,2850,170000],[2017,10,2980,180000],
    [2018,1,3150,190000],[2018,4,3300,200000],[2018,7,3500,195000],[2018,10,3620,205000],
    [2019,1,3750,210000],[2019,4,3900,220000],[2019,7,4100,215000],[2019,10,4250,225000],
    [2020,1,3800,230000],[2020,2,2800,350000],[2020,3,2300,420000],[2020,4,2900,280000],
    [2020,5,3100,240000],[2020,6,3300,220000],[2020,7,3500,210000],[2020,8,3600,200000],
    [2020,9,3550,195000],[2020,10,3600,205000],[2020,11,3800,215000],[2020,12,3600,200000],
    [2021,1,4000,250000],[2021,2,4200,260000],[2021,3,4500,270000],[2021,4,4800,280000],
    [2021,5,5000,290000],[2021,6,5200,300000],[2021,7,5600,320000],[2021,8,5500,310000],
    [2021,9,5400,300000],[2021,10,5450,305000],[2021,11,5300,295000],[2021,12,5450,310000],
    [2022,1,6000,350000],[2022,2,6500,370000],[2022,3,7000,390000],[2022,4,7500,400000],
    [2022,5,8000,450000],[2022,6,9500,520000],[2022,7,9200,490000],[2022,8,8900,470000],
    [2022,9,8500,440000],[2022,10,8300,420000],[2022,11,8000,400000],[2022,12,8100,410000],
    [2023,1,10000,550000],[2023,2,12000,620000],[2023,3,15200,680000],[2023,4,14000,600000],
    [2023,5,13000,560000],[2023,6,12100,520000],[2023,7,11000,490000],[2023,8,10500,470000],
    [2023,9,9800,450000],[2023,10,9200,430000],[2023,11,8800,410000],[2023,12,8200,400000],
    [2024,1,8500,390000],[2024,2,8800,400000],[2024,3,8600,395000],[2024,4,9000,410000],
    [2024,5,9100,420000],[2024,6,8800,405000],[2024,7,8500,395000],[2024,8,8300,380000],
    [2024,9,8100,375000],[2024,10,7900,360000],[2024,11,7800,350000],[2024,12,7800,345000],
    [2025,1,8000,360000],[2025,2,8200,370000],[2025,3,8330,375000],
    [2025,4,8100,360000],[2025,5,8250,365000],[2025,6,8000,355000],[2025,7,7600,340000],[2025,8,7200,330000],
    [2025,9,7100,325000],[2025,10,6900,315000],[2025,11,6800,310000],[2025,12,6750,308000],
    [2026,1,6800,320000],[2026,2,6900,330000],[2026,3,7050,340000],
  ];
  return base.map(([year,month,price,vol])=>({
    label:`${year}.${String(month).padStart(2,"0")}`,
    year, month, price, volume:vol,
    open:Math.round(price*0.98), high:Math.round(price*1.03), low:Math.round(price*0.96),
  }));
};

// 분기별 EPS / FCF (주가 비교용) — 2016Q1 ~ 2025Q4
const Q_EPS_FCF = [
  {label:"2016\nQ1",y:2016,q:1,qEps:34, qFcf:9},
  {label:"2016\nQ2",y:2016,q:2,qEps:43, qFcf:12},
  {label:"2016\nQ3",y:2016,q:3,qEps:37, qFcf:10},
  {label:"2016\nQ4",y:2016,q:4,qEps:52, qFcf:14},
  {label:"2017\nQ1",y:2017,q:1,qEps:40, qFcf:11},
  {label:"2017\nQ2",y:2017,q:2,qEps:49, qFcf:13},
  {label:"2017\nQ3",y:2017,q:3,qEps:43, qFcf:12},
  {label:"2017\nQ4",y:2017,q:4,qEps:58, qFcf:15},
  {label:"2018\nQ1",y:2018,q:1,qEps:40, qFcf:11},
  {label:"2018\nQ2",y:2018,q:2,qEps:52, qFcf:14},
  {label:"2018\nQ3",y:2018,q:3,qEps:46, qFcf:13},
  {label:"2018\nQ4",y:2018,q:4,qEps:50, qFcf:14},
  {label:"2019\nQ1",y:2019,q:1,qEps:43, qFcf:12},
  {label:"2019\nQ2",y:2019,q:2,qEps:55, qFcf:15},
  {label:"2019\nQ3",y:2019,q:3,qEps:52, qFcf:14},
  {label:"2019\nQ4",y:2019,q:4,qEps:57, qFcf:17},
  {label:"2020\nQ1",y:2020,q:1,qEps:34, qFcf:9},
  {label:"2020\nQ2",y:2020,q:2,qEps:40, qFcf:11},
  {label:"2020\nQ3",y:2020,q:3,qEps:46, qFcf:13},
  {label:"2020\nQ4",y:2020,q:4,qEps:50, qFcf:15},
  {label:"2021\nQ1",y:2021,q:1,qEps:62, qFcf:18},
  {label:"2021\nQ2",y:2021,q:2,qEps:87, qFcf:28},
  {label:"2021\nQ3",y:2021,q:3,qEps:68, qFcf:22},
  {label:"2021\nQ4",y:2021,q:4,qEps:155,qFcf:37},
  {label:"2022\nQ1",y:2022,q:1,qEps:118,qFcf:35},
  {label:"2022\nQ2",y:2022,q:2,qEps:161,qFcf:52},
  {label:"2022\nQ3",y:2022,q:3,qEps:167,qFcf:48},
  {label:"2022\nQ4",y:2022,q:4,qEps:142,qFcf:33},
  {label:"2023\nQ1",y:2023,q:1,qEps:84, qFcf:25},
  {label:"2023\nQ2",y:2023,q:2,qEps:93, qFcf:30},
  {label:"2023\nQ3",y:2023,q:3,qEps:87, qFcf:28},
  {label:"2023\nQ4",y:2023,q:4,qEps:139,qFcf:47},
  {label:"2024\nQ1",y:2024,q:1,qEps:173,qFcf:56},
  {label:"2024\nQ2",y:2024,q:2,qEps:148,qFcf:42},
  {label:"2024\nQ3",y:2024,q:3,qEps:136,qFcf:38},
  {label:"2024\nQ4",y:2024,q:4,qEps:108,qFcf:34},
  {label:"2025\nQ1",y:2025,q:1,qEps:179,qFcf:58},
  {label:"2025\nQ2",y:2025,q:2,qEps:179,qFcf:52},
  {label:"2025\nQ3",y:2025,q:3,qEps:154,qFcf:44},
  {label:"2025\nQ4",y:2025,q:4,qEps:216,qFcf:36},
];

// 분기별 재무 데이터 (재무탭·안정성탭용) — 2016Q1 ~ 2025Q4 (40분기 = 10년)
const Q_FINANCIAL = [
  {label:"2016\nQ1",y:2016,q:1,rev:72, op:14,net:11,eps:34, roe:8.5, debt:35.2,curr:310},
  {label:"2016\nQ2",y:2016,q:2,rev:80, op:17,net:14,eps:43, roe:9.2, debt:34.0,curr:325},
  {label:"2016\nQ3",y:2016,q:3,rev:78, op:16,net:12,eps:37, roe:8.8, debt:33.1,curr:332},
  {label:"2016\nQ4",y:2016,q:4,rev:90, op:20,net:17,eps:52, roe:10.2,debt:32.5,curr:340},
  {label:"2017\nQ1",y:2017,q:1,rev:76, op:16,net:13,eps:40, roe:9.0, debt:31.8,curr:355},
  {label:"2017\nQ2",y:2017,q:2,rev:84, op:19,net:16,eps:49, roe:9.8, debt:30.5,curr:368},
  {label:"2017\nQ3",y:2017,q:3,rev:82, op:18,net:14,eps:43, roe:9.3, debt:29.8,curr:375},
  {label:"2017\nQ4",y:2017,q:4,rev:96, op:22,net:19,eps:58, roe:10.8,debt:29.0,curr:385},
  {label:"2018\nQ1",y:2018,q:1,rev:80, op:17,net:13,eps:40, roe:9.5, debt:32.0,curr:390},
  {label:"2018\nQ2",y:2018,q:2,rev:88, op:20,net:17,eps:52, roe:10.5,debt:31.0,curr:405},
  {label:"2018\nQ3",y:2018,q:3,rev:86, op:19,net:15,eps:46, roe:10.0,debt:30.2,curr:412},
  {label:"2018\nQ4",y:2018,q:4,rev:89, op:17,net:16,eps:50, roe:11.2,debt:29.5,curr:420},
  {label:"2019\nQ1",y:2019,q:1,rev:87, op:15,net:14,eps:43, roe:10.2,debt:27.0,curr:435},
  {label:"2019\nQ2",y:2019,q:2,rev:94, op:18,net:18,eps:55, roe:11.5,debt:26.0,curr:450},
  {label:"2019\nQ3",y:2019,q:3,rev:92, op:17,net:17,eps:52, roe:11.0,debt:25.2,curr:462},
  {label:"2019\nQ4",y:2019,q:4,rev:99, op:18,net:18,eps:57, roe:12.0,debt:24.5,curr:475},
  {label:"2020\nQ1",y:2020,q:1,rev:84, op:15,net:11,eps:34, roe:9.5, debt:25.0,curr:455},
  {label:"2020\nQ2",y:2020,q:2,rev:88, op:17,net:13,eps:40, roe:10.2,debt:24.5,curr:462},
  {label:"2020\nQ3",y:2020,q:3,rev:92, op:19,net:15,eps:46, roe:10.8,debt:23.8,curr:470},
  {label:"2020\nQ4",y:2020,q:4,rev:99, op:19,net:16,eps:50, roe:11.5,debt:23.0,curr:480},
  {label:"2021\nQ1",y:2021,q:1,rev:107,op:28,net:20,eps:62, roe:14.0,debt:22.1,curr:468},
  {label:"2021\nQ2",y:2021,q:2,rev:122,op:36,net:28,eps:87, roe:17.2,debt:21.5,curr:475},
  {label:"2021\nQ3",y:2021,q:3,rev:118,op:31,net:22,eps:68, roe:15.8,debt:21.0,curr:478},
  {label:"2021\nQ4",y:2021,q:4,rev:156,op:37,net:50,eps:155,roe:22.5,debt:21.3,curr:480},
  {label:"2022\nQ1",y:2022,q:1,rev:131,op:48,net:38,eps:118,roe:21.5,debt:17.2,curr:620},
  {label:"2022\nQ2",y:2022,q:2,rev:158,op:58,net:52,eps:161,roe:25.0,debt:14.8,curr:740},
  {label:"2022\nQ3",y:2022,q:3,rev:162,op:60,net:54,eps:167,roe:25.5,debt:13.5,curr:810},
  {label:"2022\nQ4",y:2022,q:4,rev:155,op:38,net:46,eps:142,roe:23.5,debt:12.6,curr:864},
  {label:"2023\nQ1",y:2023,q:1,rev:120,op:36,net:27,eps:84, roe:15.5,debt:9.2, curr:1320},
  {label:"2023\nQ2",y:2023,q:2,rev:115,op:30,net:30,eps:93, roe:16.0,debt:8.0, curr:1480},
  {label:"2023\nQ3",y:2023,q:3,rev:112,op:28,net:28,eps:87, roe:15.5,debt:7.2, curr:1560},
  {label:"2023\nQ4",y:2023,q:4,rev:117,op:47,net:45,eps:139,roe:18.0,debt:6.4, curr:1672},
  {label:"2024\nQ1",y:2024,q:1,rev:133,op:54,net:56,eps:173,roe:22.5,debt:7.5, curr:1120},
  {label:"2024\nQ2",y:2024,q:2,rev:128,op:38,net:48,eps:148,roe:21.0,debt:7.8, curr:1080},
  {label:"2024\nQ3",y:2024,q:3,rev:154,op:60,net:44,eps:136,roe:20.2,debt:8.2, curr:1040},
  {label:"2024\nQ4",y:2024,q:4,rev:122,op:24,net:35,eps:108,roe:19.5,debt:8.9, curr:995},
  {label:"2025\nQ1",y:2025,q:1,rev:172,op:67,net:58,eps:179,roe:22.8,debt:8.5, curr:1065},
  {label:"2025\nQ2",y:2025,q:2,rev:165,op:60,net:58,eps:179,roe:22.0,debt:8.4, curr:1060},
  {label:"2025\nQ3",y:2025,q:3,rev:149,op:52,net:50,eps:154,roe:21.2,debt:8.4, curr:1058},
  {label:"2025\nQ4",y:2025,q:4,rev:184,op:28,net:70,eps:216,roe:21.8,debt:8.5, curr:1055},
];

// PER/PBR 밴드용 — Q_FINANCIAL에 EPS·BPS 밴드 추가
const Q_BAND_DATA = (()=>{
  const epsMap={}, bpsMap={};
  ANN_DATA.forEach(r=>{ epsMap[r.year]=r.eps; bpsMap[r.year]=r.bps||0; });
  return Q_FINANCIAL.map(d=>{
    const eps = epsMap[d.y]||epsMap[d.y-1]||400;
    const bps = bpsMap[d.y]||bpsMap[d.y-1]||3000;
    return {
      ...d,
      perLo:  Math.round(eps*7),
      perHi:  Math.round(eps*20),
      perMid: Math.round(eps*13),
      pbrLo:  Math.round(bps*1.0),
      pbrHi:  Math.round(bps*3.5),
    };
  });
})();

// 주간 수급 데이터 (최근 1년, 52주)
const W_SUPPLY_DATA = (()=>{
  const weeks=[];
  // 2025.04 ~ 2026.04 (52주) 샘플
  const seed = [
    {inst:8,foreign:12,instPct:9.8,foreignPct:9.8},
    {inst:-5,foreign:3,instPct:9.75,foreignPct:9.83},
    {inst:12,foreign:18,instPct:9.85,foreignPct:9.98},
    {inst:-8,foreign:-6,instPct:9.78,foreignPct:9.92},
    {inst:3,foreign:-2,instPct:9.8,foreignPct:9.9},
    {inst:15,foreign:22,instPct:9.9,foreignPct:10.05},
    {inst:-3,foreign:8,instPct:9.88,foreignPct:10.1},
    {inst:6,foreign:-4,instPct:9.9,foreignPct:10.07},
    {inst:-12,foreign:-15,instPct:9.8,foreignPct:9.95},
    {inst:2,foreign:5,instPct:9.82,foreignPct:9.98},
    {inst:18,foreign:20,instPct:9.95,foreignPct:10.12},
    {inst:-6,foreign:3,instPct:9.9,foreignPct:10.15},
    {inst:4,foreign:-8,instPct:9.92,foreignPct:10.08},
    {inst:-2,foreign:6,instPct:9.91,foreignPct:10.12},
    {inst:10,foreign:14,instPct:9.98,foreignPct:10.22},
    {inst:-4,foreign:-3,instPct:9.95,foreignPct:10.19},
    {inst:7,foreign:9,instPct:10.0,foreignPct:10.25},
    {inst:-9,foreign:-12,instPct:9.92,foreignPct:10.14},
    {inst:3,foreign:4,instPct:9.94,foreignPct:10.17},
    {inst:14,foreign:19,instPct:10.04,foreignPct:10.3},
    {inst:-5,foreign:2,instPct:10.0,foreignPct:10.32},
    {inst:6,foreign:-5,instPct:10.02,foreignPct:10.27},
    {inst:-3,foreign:7,instPct:10.0,foreignPct:10.32},
    {inst:11,foreign:13,instPct:10.08,foreignPct:10.42},
    {inst:-7,foreign:-8,instPct:10.02,foreignPct:10.35},
    {inst:2,foreign:4,instPct:10.04,foreignPct:10.38},
    {inst:8,foreign:10,instPct:10.1,foreignPct:10.46},
    {inst:-4,foreign:6,instPct:10.07,foreignPct:10.5},
    {inst:5,foreign:-3,instPct:10.09,foreignPct:10.47},
    {inst:-10,foreign:-14,instPct:10.0,foreignPct:10.35},
    {inst:13,foreign:16,instPct:10.1,foreignPct:10.48},
    {inst:-2,foreign:5,instPct:10.08,foreignPct:10.52},
    {inst:4,foreign:-6,instPct:10.1,foreignPct:10.46},
    {inst:-6,foreign:3,instPct:10.06,foreignPct:10.49},
    {inst:9,foreign:11,instPct:10.14,foreignPct:10.58},
    {inst:-3,foreign:-4,instPct:10.11,foreignPct:10.54},
    {inst:6,foreign:8,instPct:10.16,foreignPct:10.6},
    {inst:-8,foreign:-10,instPct:10.08,foreignPct:10.5},
    {inst:3,foreign:5,instPct:10.11,foreignPct:10.54},
    {inst:12,foreign:15,instPct:10.2,foreignPct:10.65},
    {inst:-5,foreign:2,instPct:10.16,foreignPct:10.68},
    {inst:7,foreign:-3,instPct:10.19,foreignPct:10.65},
    {inst:-2,foreign:6,instPct:10.18,foreignPct:10.7},
    {inst:10,foreign:12,instPct:10.25,foreignPct:10.8},
    {inst:-4,foreign:-5,instPct:10.21,foreignPct:10.75},
    {inst:5,foreign:7,instPct:10.25,foreignPct:10.8},
    {inst:-7,foreign:-9,instPct:10.18,foreignPct:10.72},
    {inst:3,foreign:4,instPct:10.2,foreignPct:10.75},
    {inst:9,foreign:11,instPct:10.28,foreignPct:10.84},
    {inst:-3,foreign:2,instPct:10.25,foreignPct:10.86},
    {inst:6,foreign:8,instPct:10.3,foreignPct:10.92},
    {inst:-5,foreign:-6,instPct:10.26,foreignPct:10.87},
  ];
  // 주봉 가격 샘플 (2025.04~2026.04)
  const prices=[8330,8200,8100,8050,8150,8300,8250,8180,8000,7900,7800,7750,7700,7650,7600,7550,7500,7450,7400,7350,7300,7250,7200,7150,7100,7050,7000,6950,6900,6870,6850,6830,6820,6810,6800,6790,6780,6770,6760,6750,6740,6730,6720,6710,6700,6720,6740,6750,6760,6780,6800,6800];
  seed.forEach((s,i)=>{
    const dt = new Date(2025,3,7); // 2025.04.07
    dt.setDate(dt.getDate() + i*7);
    const mo = String(dt.getMonth()+1).padStart(2,"0");
    const da = String(dt.getDate()).padStart(2,"0");
    const label=`${dt.getFullYear()}.${mo}.${da}`;
    const prev = i>0?seed[i-1]:{instPct:s.instPct,foreignPct:s.foreignPct};
    const dI = +(s.instPct-prev.instPct).toFixed(2);
    const dF = +(s.foreignPct-prev.foreignPct).toFixed(2);
    let signal=null;
    if(i>0){
      if(dI>=0.08&&dF>=0.06)      signal={type:"쌍매수",color:"#00C878",icon:"⭐"};
      else if(dI<=-0.08&&dF<=-0.06) signal={type:"쌍매도",color:"#FF3D5A",icon:"⚠"};
      else if(dF>=0.08)            signal={type:"외인집중",color:"#5BA0FF",icon:"🌐"};
      else if(dI>=0.08)            signal={type:"기관집중",color:"#8855FF",icon:"🏦"};
    }
    const FIXED_SHORT = [3.2,3.8,2.9,4.1,3.5,4.8,5.2,4.6,3.9,4.3,5.6,4.9,3.7,4.2,5.1,4.4,3.6,4.7,5.3,4.0,3.3,4.5,5.8,4.1,3.8,4.9,5.5,4.2,3.5,4.6,5.0,4.3,3.7,4.8,5.2,4.5,3.9,5.1,5.6,4.7,4.0,5.3,5.9,4.8,4.2,5.5,6.1,5.0,4.4,5.7,6.3,5.2];
    weeks.push({label,...s,price:prices[i]||6800,dInst:dI,dForeign:dF,signal,
      short:FIXED_SHORT[i]||4.0});
  });
  return weeks;
})();

// ── 월별 EPS·FCF 매핑 (분기값을 해당 분기 3개월에 균등 배분)
const buildMonthlyEpsFcf = () => {
  const qMap = {1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12]};
  const result = {};
  Q_EPS_FCF.forEach(d => {
    qMap[d.q].forEach(m => {
      result[`${d.y}.${String(m).padStart(2,"0")}`] = {
        mEps: Math.round(d.qEps / 3),
        mFcf: Math.round(d.qFcf / 3),
        qEps: d.qEps,
        qFcf: d.qFcf,
        isQEnd: m === qMap[d.q][2], // 분기말 월 여부
      };
    });
  });
  return result;
};
const M_EPS_FCF_MAP = buildMonthlyEpsFcf();

// ── 코스피/코스닥 시장 지수 월봉 데이터 (2021.01 ~ 2025.12, 60개월)
const MARKET_DATA = [
  {label:"2021.01",kospi:3152,kosdaq:994},{label:"2021.02",kospi:3088,kosdaq:958},
  {label:"2021.03",kospi:3061,kosdaq:970},{label:"2021.04",kospi:3198,kosdaq:1010},
  {label:"2021.05",kospi:3170,kosdaq:1000},{label:"2021.06",kospi:3278,kosdaq:1040},
  {label:"2021.07",kospi:3302,kosdaq:1060},{label:"2021.08",kospi:3199,kosdaq:1050},
  {label:"2021.09",kospi:3130,kosdaq:1020},{label:"2021.10",kospi:2970,kosdaq:1000},
  {label:"2021.11",kospi:2980,kosdaq:980},{label:"2021.12",kospi:2977,kosdaq:975},
  {label:"2022.01",kospi:2663,kosdaq:880},{label:"2022.02",kospi:2700,kosdaq:895},
  {label:"2022.03",kospi:2757,kosdaq:915},{label:"2022.04",kospi:2695,kosdaq:890},
  {label:"2022.05",kospi:2685,kosdaq:882},{label:"2022.06",kospi:2332,kosdaq:745},
  {label:"2022.07",kospi:2451,kosdaq:790},{label:"2022.08",kospi:2472,kosdaq:800},
  {label:"2022.09",kospi:2155,kosdaq:680},{label:"2022.10",kospi:2294,kosdaq:716},
  {label:"2022.11",kospi:2472,kosdaq:775},{label:"2022.12",kospi:2236,kosdaq:700},
  {label:"2023.01",kospi:2480,kosdaq:760},{label:"2023.02",kospi:2430,kosdaq:745},
  {label:"2023.03",kospi:2476,kosdaq:780},{label:"2023.04",kospi:2570,kosdaq:820},
  {label:"2023.05",kospi:2577,kosdaq:838},{label:"2023.06",kospi:2564,kosdaq:862},
  {label:"2023.07",kospi:2610,kosdaq:895},{label:"2023.08",kospi:2556,kosdaq:870},
  {label:"2023.09",kospi:2465,kosdaq:820},{label:"2023.10",kospi:2277,kosdaq:740},
  {label:"2023.11",kospi:2535,kosdaq:822},{label:"2023.12",kospi:2655,kosdaq:855},
  {label:"2024.01",kospi:2500,kosdaq:820},{label:"2024.02",kospi:2642,kosdaq:855},
  {label:"2024.03",kospi:2746,kosdaq:882},{label:"2024.04",kospi:2692,kosdaq:870},
  {label:"2024.05",kospi:2723,kosdaq:880},{label:"2024.06",kospi:2797,kosdaq:905},
  {label:"2024.07",kospi:2770,kosdaq:900},{label:"2024.08",kospi:2674,kosdaq:865},
  {label:"2024.09",kospi:2593,kosdaq:840},{label:"2024.10",kospi:2560,kosdaq:760},
  {label:"2024.11",kospi:2455,kosdaq:730},{label:"2024.12",kospi:2400,kosdaq:700},
  {label:"2025.01",kospi:2480,kosdaq:720},{label:"2025.02",kospi:2520,kosdaq:745},
  {label:"2025.03",kospi:2580,kosdaq:762},{label:"2025.04",kospi:2620,kosdaq:780},
  {label:"2025.05",kospi:2660,kosdaq:800},{label:"2025.06",kospi:2700,kosdaq:818},
  {label:"2025.07",kospi:2750,kosdaq:840},{label:"2025.08",kospi:2720,kosdaq:828},
  {label:"2025.09",kospi:2695,kosdaq:818},{label:"2025.10",kospi:2680,kosdaq:810},
  {label:"2025.11",kospi:2695,kosdaq:818},{label:"2025.12",kospi:2710,kosdaq:830},
];

// RSI 계산 (시장 지수용)
const calcMarketRSI = (data, key, n=14) => {
  return data.map((d,i) => {
    if(i<n) return {...d,[`rsi_${key}`]:null};
    const sl=data.slice(i-n+1,i+1);
    let g=0,l=0;
    for(let j=1;j<sl.length;j++){
      const diff=sl[j][key]-sl[j-1][key];
      if(diff>0) g+=diff; else l-=diff;
    }
    const rsi = l===0?100:100-(100/(1+g/l));
    return {...d,[`rsi_${key}`]:+rsi.toFixed(1)};
  });
};

// MACD 계산 (시장 지수용)
const calcMarketMACD = (data, key) => {
  const cl=data.map(d=>d[key]);
  const k12=2/13, k26=2/27, k9=2/10;
  let e12=cl[0],e26=cl[0];
  const macdArr=cl.map((v,i)=>{
    if(i===0){e12=v;e26=v;return 0;}
    e12=v*k12+e12*(1-k12);
    e26=v*k26+e26*(1-k26);
    return +(e12-e26).toFixed(1);
  });
  let sig=macdArr[0];
  const sigArr=macdArr.map((v,i)=>{
    if(i===0){sig=v;return v;}
    sig=v*k9+sig*(1-k9);
    return +sig.toFixed(1);
  });
  return data.map((d,i)=>({...d,
    [`macd_${key}`]:macdArr[i],
    [`signal_${key}`]:sigArr[i],
    [`hist_${key}`]:+(macdArr[i]-sigArr[i]).toFixed(1),
  }));
};

const MARKET_WITH_INDICATORS = (() => {
  let d = [...MARKET_DATA];
  d = calcMarketRSI(d,'kospi');
  d = calcMarketRSI(d,'kosdaq');
  d = calcMarketMACD(d,'kospi');
  d = calcMarketMACD(d,'kosdaq');
  return d;
})();

const MITECH_BASE = {
  corpCode:"00401484", ticker:"179290", name:"엠아이텍",
  sector:"의료기기·비혈관 스텐트", market:"KOSDAQ",
  ceo:"곽재오", shares:32365678,
  currentPrice:6800, prevClose:6820, change:-20, changePct:-0.29,
  per:11.7, pbr:1.65, targetPrice:13000,
  annualData: ANN_DATA,
  dcfInput:{fcf:190,gr:0.18,tg:0.03,dr:0.10},
  fScoreInput:{roa:0.16,droa:0.03,cfo:0.18,accrual:-0.02,lever:-0.03,liquid:0.05,dilution:0,gross:0.02,ato:0.01},
  regionalSales:[
    {region:"일본·아시아",pct:41,amount:276,color:C.blue},
    {region:"유럽",      pct:27,amount:181,color:C.green},
    {region:"국내",      pct:21,amount:141,color:C.gold},
    {region:"북미",      pct:8, amount:54, color:C.purple},
    {region:"기타",      pct:3, amount:20, color:C.cyan},
  ],
  segmentSales:[
    {segment:"소화기 스텐트",pct:87,amount:585,color:C.blue},
    {segment:"내시경(상품)", pct:7, amount:47, color:C.green},
    {segment:"기타",        pct:6, amount:40, color:C.gold},
  ],
  majorShareholders:[
    {name:"시너지이노베이션 외",pct:53.09,shares:17182094,change:0},
    {name:"보스톤사이언티픽",  pct:9.83, shares:3180000, change:0},
    {name:"외국인",           pct:6.09, shares:1971000, change:+0.3},
    {name:"기관",             pct:8.40, shares:2719000, change:+1.2},
    {name:"자사주",            pct:1.20, shares:388000,  change:0},
    {name:"소액주주",          pct:21.39,shares:6921000, change:-1.5},
  ],
  disclosures:[
    {date:"2026-02-25",type:"실적",  title:"2025년 매출 672억·영업이익 207억 — 창사 최대",sentiment:"pos"},
    {date:"2026-01-15",type:"계약",  title:"유럽 Olympus 재계약 (판가 20~30% 인상)",sentiment:"pos"},
    {date:"2025-11-14",type:"실적",  title:"3Q25 누적 매출 486억 (+20.4% YoY)",sentiment:"pos"},
    {date:"2025-08-14",type:"실적",  title:"2Q25 매출 165억 (+28.9% YoY)",sentiment:"pos"},
    {date:"2025-05-14",type:"리포트",title:"SK증권 매수유지 TP 13,000원",sentiment:"neu"},
    {date:"2025-03-19",type:"보고서",title:"2024년 사업보고서",sentiment:"neu"},
    {date:"2024-10-28",type:"리포트",title:"다올투자증권 유럽 회복 본격화",sentiment:"pos"},
  ],
};

// ═══════════════════════════════════════════════
//  공통 UI
// ═══════════════════════════════════════════════
const Tag = ({children,color=C.blue,size=9}) => (
  <span style={{background:`${color}22`,color,fontSize:size,padding:"2px 7px",borderRadius:4,fontWeight:700,whiteSpace:"nowrap"}}>{children}</span>
);

const KPI = ({label,value,color,sub,badge,unit=""}) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 11px",flex:1,minWidth:88,position:"relative"}}>
    {badge&&<span style={{position:"absolute",top:5,right:6,background:badge==="▲"?`${C.green}22`:`${C.red}22`,color:badge==="▲"?C.green:C.red,fontSize:10,padding:"1px 4px",borderRadius:3}}>{badge}</span>}
    <div style={{color:C.muted,fontSize:11,letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:3}}>{label}</div>
    <div style={{color,fontSize:16,fontWeight:900,fontFamily:"'IBM Plex Mono',monospace",lineHeight:1}}>
      {value}<span style={{fontSize:10,color:C.muted,marginLeft:2}}>{unit}</span>
    </div>
    {sub&&<div style={{color:C.muted,fontSize:11,marginTop:2}}>{sub}</div>}
  </div>
);

const ST = ({children,accent=C.blue,right}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:9,marginTop:2}}>
    <div style={{display:"flex",alignItems:"center",gap:7}}>
      <div style={{width:3,height:15,background:accent,borderRadius:2}}/>
      <span style={{color:C.text,fontSize:14,fontWeight:800,letterSpacing:"0.03em"}}>{children}</span>
    </div>
    {right&&<span style={{color:C.muted,fontSize:12}}>{right}</span>}
  </div>
);

const Box = ({children,mb=14,p="14px 7px 6px 3px"}) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:13,padding:p,marginBottom:mb}}>{children}</div>
);

const CW = ({children,h=220,mb=14}) => (
  <Box mb={mb}><ResponsiveContainer width="100%" height={h}>{children}</ResponsiveContainer></Box>
);

// X축 — 연도.월 (10년 모드: 연도만 / 일반: 연도+Jan)
const MonthXTick = ({x,y,payload,data,yearOnly=false}) => {
  const d = data?.find(r=>r.label===payload.value);
  if(!d) return null;
  const showYear = d.month===1;
  if(!showYear) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={-1} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={800} fontFamily="monospace">{d.year}</text>
      {!yearOnly&&<text x={0} y={11} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">Jan</text>}
    </g>
  );
};

// X축 — 분기 공급 데이터용 (10년 모드: Q1만 연도 표시 / 일반: 연도+Q#)
const QSupplyTick = ({x,y,payload,data,yearOnly=false}) => {
  const d = data?.find(r=>r.label===payload.value);
  if(!d) return null;
  if(yearOnly) {
    // 10년 모드: Q1에 연도만, 나머지 숨김
    if(d.q!==1) return null;
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={5} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={800} fontFamily="monospace">{d.y}</text>
      </g>
    );
  }
  return (
    <g transform={`translate(${x},${y})`}>
      {d.q===1&&<text x={0} y={-1} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={800} fontFamily="monospace">{d.y}</text>}
      <text x={0} y={d.q===1?12:10} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">Q{d.q}</text>
    </g>
  );
};

// X축 — compare 탭용 (Q_EPS_FCF 데이터)
const QCompareTick = ({x,y,payload}) => {
  if(!payload?.value) return null;
  const parts = payload.value.split('\n');
  const y2 = parseInt(parts[0])||0;
  const q  = parseInt((parts[1]||'').replace('Q',''))||0;
  return (
    <g transform={`translate(${x},${y})`}>
      {q===1&&<text x={0} y={-1} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={800} fontFamily="monospace">{y2}</text>}
      <text x={0} y={q===1?12:10} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">Q{q}</text>
    </g>
  );
};

// X축 — 주봉 수급용 (YYYY.MM.DD 레이블, 월 첫주만 표시)
const WeekXTick = ({x,y,payload}) => {
  if(!payload?.value) return null;
  const parts = payload.value.split('.');
  const mo  = parts[1]||'';
  const day = parts[2]||'';
  const isMonthStart = day<='07';
  if(!isMonthStart) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={5} textAnchor="middle" fill={C.text} fontSize={9} fontWeight={700} fontFamily="monospace">{parts[0]}.{mo}</text>
    </g>
  );
};

// 툴팁
const MTip = ({active,payload,label,data}) => {
  if(!active||!payload?.length) return null;
  const d = data?.find(r=>r.label===label);
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 13px",minWidth:155,boxShadow:"0 8px 32px #0006"}}>
      <div style={{color:C.muted,fontSize:11,marginBottom:6,fontFamily:"monospace"}}>{d?`${d.year}년 ${d.month}월`:label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}>
          <span style={{color:p.color||C.muted,fontSize:12}}>{p.name}</span>
          <span style={{color:C.text,fontSize:12,fontWeight:700}}>
            {["price","ma60","ma20","ma5","perLo","perHi","perMid","pbrLo","pbrHi"].includes(p.dataKey)?`${(p.value||0).toLocaleString()}원`
            :["rsi","mfi","gap60","gap20"].includes(p.dataKey)?`${p.value}%`
            :p.dataKey==="obv"?`${((p.value||0)/1e6).toFixed(2)}M`
            :p.dataKey==="per"?`${p.value}배`
            :p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════
//  현재가 티커 컴포넌트
// ═══════════════════════════════════════════════
const PriceTicker = ({co}) => {
  const up = co.change >= 0;
  return (
    <div style={{
      background:`linear-gradient(135deg,${C.card2},${C.card})`,
      border:`1px solid ${up?`${C.green}44`:C.border}`,
      borderRadius:12,padding:"9px 14px",marginBottom:12,
      display:"flex",alignItems:"center",gap:6,flexWrap:"nowrap",overflowX:"auto",
    }}>
      {[
        {label:"PER",    value:`${co.per}배`,                                                          color:C.gold},
        {label:"PBR",    value:`${co.pbr}배`,                                                          color:C.gold},
        {label:"목표가", value:`${co.targetPrice?.toLocaleString()}`,                                   color:C.blueL},
        {label:"상승여력",value:`+${(((co.targetPrice/co.currentPrice)-1)*100).toFixed(0)}%`,          color:C.green},
        {label:"시가총액",value:`${Math.round((co.currentPrice||0)*(co.shares||0)/1e8).toLocaleString()}억`, color:C.cyan},
      ].map(k=>(
        <div key={k.label} style={{textAlign:"center",flex:"1 0 auto",minWidth:52}}>
          <div style={{color:C.muted,fontSize:10,marginBottom:1}}>{k.label}</div>
          <div style={{color:k.color,fontSize:14,fontWeight:700,fontFamily:"monospace",whiteSpace:"nowrap"}}>{k.value}</div>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════
//  레이더 스코어
// ═══════════════════════════════════════════════
const Radar6 = ({scores}) => {
  const d=[
    {s:"재무건전성",v:scores.fin},{s:"성장성",v:scores.growth},
    {s:"안정성",v:scores.stable},{s:"밸류",v:scores.value},
    {s:"모멘텀",v:scores.mom},{s:"수급",v:scores.supply},
  ];
  const avg = Math.round(d.reduce((s,x)=>s+x.v,0)/6);
  return (
    <div style={{display:"flex",gap:12,alignItems:"center",background:C.card,border:`1px solid ${C.border}`,borderRadius:13,padding:13,marginBottom:14}}>
      <div style={{width:130,height:130,flexShrink:0}}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={d}>
            <PolarGrid stroke={C.border}/>
            <PolarAngleAxis dataKey="s" tick={{fill:C.muted,fontSize:9}}/>
            <Radar dataKey="v" stroke={C.gold} fill={C.gold} fillOpacity={0.2} strokeWidth={2}/>
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{color:C.muted,fontSize:10,marginBottom:1}}>종합 투자 스코어</div>
        <div style={{fontSize:32,fontWeight:900,color:C.gold,fontFamily:"monospace",lineHeight:1}}>{avg}</div>
        <div style={{color:C.muted,fontSize:10}}>/100점</div>
        <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:3}}>
          {d.map(x=>(
            <div key={x.s} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:52,fontSize:10,color:C.muted,flexShrink:0}}>{x.s}</div>
              <div style={{flex:1,height:3,background:C.border,borderRadius:2}}>
                <div style={{width:`${x.v}%`,height:"100%",background:x.v>=80?C.green:x.v>=60?C.gold:C.red,borderRadius:2}}/>
              </div>
              <div style={{width:22,fontSize:10,color:C.text,textAlign:"right",fontFamily:"monospace",flexShrink:0}}>{x.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════
//  메인 앱
// ═══════════════════════════════════════════════
export default function SequoiaV3() {
  const [darkMode, setDarkMode]       = useState(true);
  // C, PALETTE를 모드에 따라 동적 설정
  C       = darkMode ? DARK  : LIGHT;
  PALETTE = darkMode ? PALETTE_DARK : PALETTE_LIGHT;

  const [term, setTerm]           = useState("엠아이텍");
  const [co, setCo]               = useState(MITECH_BASE);
  const [monthly, setMonthly]     = useState(buildFallbackMonthly());
  const [tab, setTab]             = useState("overview");
  const [loading, setLoading]     = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [dartOk, setDartOk]       = useState(false);
  const [yahooOk, setYahooOk]     = useState(false);
  const [chartMode, setChartMode] = useState("Q");
  const [finRange, setFinRange]   = useState(20);
  const [stabRange, setStabRange] = useState(20); // 안정성탭 기간: 4=1년,12=3년,20=5년,40=10년
  const [divRange, setDivRange]   = useState(10); // 배당탭 기간: 5 or 10
  const [dcfP, setDcfP]           = useState(MITECH_BASE.dcfInput);
  const [rangeIdx, setRangeIdx]   = useState(0); // 0=10년,1=5년,2=3년,3=1년

  // 표시 기간 필터
  const RANGES = [
    {label:"10년", months:120},
    {label:"5년",  months:60},
    {label:"3년",  months:36},
    {label:"1년",  months:12},
  ];
  // 현재 날짜 기준 직전월까지만 표시 (재무탭 제외 모든 그래프)
  const latestLabel = useMemo(()=>{
    const now = new Date();
    // 직전월 기준 (이번달 데이터 미확정이므로 전월까지)
    const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}`;
  },[]);

  const displayMonthly = useMemo(()=>{
    const sliced = monthly.slice(-RANGES[rangeIdx].months);
    // 직전월 이후 데이터는 제거 (미래 샘플 제거)
    return sliced.filter(d=>d.label<=latestLabel);
  },[monthly,rangeIdx,latestLabel]);

  // 엔진 적용
  const withMA60 = useMemo(()=>calcMA60(displayMonthly),[displayMonthly]);
  const withAll  = useMemo(()=>{
    let r = withMA60;
    r = buildBands(r, co.annualData);
    return r;
  },[withMA60,co]);
  const withRSI  = useMemo(()=>calcRSI(displayMonthly),[displayMonthly]);
  const withMACD = useMemo(()=>calcMACD(displayMonthly),[displayMonthly]);
  const withOBV  = useMemo(()=>calcOBV(displayMonthly),[displayMonthly]);
  const withMFI  = useMemo(()=>calcMFI(displayMonthly),[displayMonthly]);
  const withSig  = useMemo(()=>detectQSignals(Q_SUPPLY_DATA),[]);
  const dcfResult = useMemo(()=>calcDCF({...dcfP,shares:co.shares/1e8}),[dcfP,co.shares]);
  const fScore   = useMemo(()=>calcFScore(co.fScoreInput),[co.fScoreInput]);

  // 이격도 신호 (가장 최근)
  const lastGap = withMA60.slice(-1)[0]?.gap60 ?? null;
  const gapSignal = lastGap===null ? null : lastGap >= 100 ? "SELL" : lastGap <= -20 ? "BUY" : null;

  // TTM (분기 Q_FINANCIAL 4개 합산)
  const ttmData = useMemo(()=>{
    const res=[];
    for(let i=3;i<Q_FINANCIAL.length;i++){
      const sl=Q_FINANCIAL.slice(i-3,i+1);
      const d=Q_FINANCIAL[i];
      res.push({
        label:d.label, y:d.y, q:d.q,
        rev: sl.reduce((s,x)=>s+x.rev,0),
        op:  sl.reduce((s,x)=>s+x.op,0),
        net: sl.reduce((s,x)=>s+x.net,0),
        eps: sl.reduce((s,x)=>s+x.eps,0),
        roe: d.roe, debt:d.debt, curr:d.curr,
      });
    }
    return res;
  },[]);

  // FCF TTM (Q_EPS_FCF 4개 합산)
  const ttmFcfData = useMemo(()=>{
    const res=[];
    for(let i=3;i<Q_EPS_FCF.length;i++){
      const sl=Q_EPS_FCF.slice(i-3,i+1);
      const d=Q_EPS_FCF[i];
      res.push({
        label:d.label, y:d.y, q:d.q,
        qFcf: sl.reduce((s,x)=>s+x.qFcf,0),
        qEps: sl.reduce((s,x)=>s+x.qEps,0),
      });
    }
    return res;
  },[]);

  // (compare 탭은 Q_EPS_FCF + displayMonthly 직접 사용)

  // 스코어
  const lastAnn = co.annualData.slice(-1)[0]||{};
  const scores = {
    fin:   Math.min(100,Math.round(95-lastAnn.debt*1.5)),
    growth:Math.min(100,Math.round(70+(lastAnn.rev-380)/3)),
    stable:Math.min(100,Math.round(95-lastAnn.debt*2)),
    value: Math.min(100,Math.max(0,Math.round(100-(co.currentPrice/(dcfResult.intrinsic||1)-1)*80))),
    mom:   Math.min(100,Math.max(0,Math.round(50+(lastGap||0)/4))),
    supply:Math.min(100,Math.max(30,Math.round(65))),
  };

  // Yahoo 로드
  const loadYahoo = useCallback(async(ticker)=>{
    setPriceLoading(true);
    try {
      const res = await fetchYahoo(ticker);
      if(res.monthly?.length>10){
        setMonthly(res.monthly);
        setCo(prev=>({
          ...prev,
          currentPrice: res.currentPrice||prev.currentPrice,
          prevClose:    res.prevClose||prev.prevClose,
          change:       res.change||prev.change,
          changePct:    res.changePct||prev.changePct,
        }));
        setYahooOk(true);
      }
    } catch{}
    setPriceLoading(false);
  },[]);

  // DART 검색
  const handleSearch = useCallback(async()=>{
    if(!term.trim()) return;
    setLoading(true);
    try {
      const qs  = new URLSearchParams({crtfc_key:DART_KEY,corp_name:term.trim()}).toString();
      const r   = await fetch(PROXY+encodeURIComponent(`https://opendart.fss.or.kr/api/company.json?${qs}`));
      const d   = await r.json();
      if(d?.results?.length){
        const corp = d.results.find(x=>x.corp_name===term.trim())||d.results[0];
        setCo(prev=>({...prev,corpCode:corp.corp_code,ticker:corp.stock_code,name:corp.corp_name,ceo:corp.ceo_nm,market:corp.stock_name}));
        setDartOk(true);
        await loadYahoo(corp.stock_code);
        // 공시
        const dqs = new URLSearchParams({crtfc_key:DART_KEY,corp_code:corp.corp_code,bgn_de:"20240101",pblntf_ty:"A",page_count:"8"}).toString();
        const dr  = await fetch(PROXY+encodeURIComponent(`https://opendart.fss.or.kr/api/list.json?${dqs}`));
        const dd  = await dr.json();
        if(dd?.list) {
          const discs = dd.list.map(x=>({date:x.rcept_dt?.replace(/(\d{4})(\d{2})(\d{2})/,"$1-$2-$3"),type:"공시",title:x.report_nm,sentiment:"neu"}));
          setCo(prev=>({...prev,disclosures:discs}));
        }
      } else {
        alert(`"${term}" 종목을 찾을 수 없습니다.`);
      }
    } catch(e){ console.error(e); }
    setLoading(false);
  },[term,loadYahoo]);

  // 초기 Yahoo 로드
  useEffect(()=>{ loadYahoo("179290"); },[]);

  const xMonthProps = (data, forceYearOnly=false) => {
    const yearOnly = forceYearOnly || rangeIdx===0; // 10년(rangeIdx=0)이면 연도만
    return {
      dataKey:"label", height:yearOnly?20:32,
      tick:<MonthXTick data={data} yearOnly={yearOnly}/>,
      tickLine:false, axisLine:{stroke:C.border}, interval:0,
    };
  };
  const yp = (unit="",w=40) => ({tick:{fill:C.muted,fontSize:11},tickLine:false,axisLine:false,unit,width:w});

  const TABS=[
    {id:"overview",   label:"📊 종합"},
    {id:"business",   label:"🏢 사업정보"},
    {id:"price60",    label:"📈 주가·60MA"},
    {id:"perbpr",     label:"💹 PER/PBR"},
    {id:"compare",    label:"🔗 주가비교"},
    {id:"financial",  label:"💰 재무·TTM"},
    {id:"technical",  label:"🧮 기술분석"},
    {id:"valuation",  label:"💎 가치평가"},
    {id:"stability",  label:"🛡 안정성"},
    {id:"dividend",   label:"💸 배당"},
    {id:"sales",      label:"🌍 매출구조"},
    {id:"governance", label:"🏛 주주·공시"},
    {id:"masters",    label:"👑 9인의 거장"},
  ];

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"'Pretendard','Noto Sans KR',sans-serif",paddingBottom:60,transition:"background 0.25s,color 0.25s"}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-thumb{background:${C.dim};border-radius:4px}
        input[type=range]{accent-color:${C.gold}}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:`linear-gradient(180deg,${C.card},${C.bg})`,borderBottom:`1px solid ${C.border}`,padding:"12px 14px 10px",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(8px)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:9}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <div style={{width:28,height:28,borderRadius:7,background:`linear-gradient(135deg,${C.gold},${C.orange})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:900,color:"#000",flexShrink:0}}>S</div>
            <div>
              <div style={{fontSize:12,fontWeight:900,letterSpacing:"0.1em",color:C.gold,lineHeight:1}}>SEQUOIA QUANTUM</div>
              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.2em"}}>INVESTMENT INTELLIGENCE SYSTEM</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {priceLoading&&<div style={{width:10,height:10,border:`2px solid ${C.cyan}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>}
            <div style={{width:6,height:6,borderRadius:"50%",background:yahooOk?C.green:C.muted,title:yahooOk?"실시간 주가":"샘플"}}/>
            <div style={{width:6,height:6,borderRadius:"50%",background:dartOk?C.blue:C.muted,title:dartOk?"DART연결":"기본"}}/>
            {/* 다크/라이트 모드 토글 */}
            <button onClick={()=>setDarkMode(m=>!m)} style={{
              background:darkMode?`${C.gold}22`:`${C.blue}18`,
              border:`1px solid ${darkMode?C.gold:C.blue}`,
              borderRadius:20, padding:"4px 12px", cursor:"pointer",
              fontSize:12, color:darkMode?C.gold:C.blue, fontWeight:700,
              whiteSpace:"nowrap",
            }}>
              {darkMode ? "☀ 라이트" : "🌙 다크"}
            </button>
          </div>
        </div>

        {/* 검색 */}
        <div style={{display:"flex",gap:7,marginBottom:9}}>
          <div style={{display:"flex",alignItems:"center",gap:7,background:C.card2,border:`1.5px solid ${C.border}`,borderRadius:9,padding:"7px 11px",flex:1}}>
            <span style={{color:C.muted,fontSize:13}}>🔍</span>
            <input value={term} onChange={e=>setTerm(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
              placeholder="종목명 입력 (예: 삼성전자, LG화학...)"
              style={{background:"transparent",border:"none",outline:"none",color:C.text,fontSize:13,flex:1}}/>
            {loading&&<div style={{width:11,height:11,border:`2px solid ${C.blue}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>}
          </div>
          <button onClick={handleSearch} style={{background:C.blue,color:"#fff",border:"none",borderRadius:9,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>조회</button>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:5}}>
          <div>
            <span style={{fontSize:15,fontWeight:900}}>{co.name}</span>
            <span style={{fontSize:12,color:C.muted,marginLeft:6}}>{co.ticker} · {co.market} · CEO {co.ceo}</span>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <span style={{fontSize:22,fontWeight:900,color:co.change>=0?C.green:C.red,fontFamily:"monospace"}}>{co.currentPrice?.toLocaleString()}원</span>
            <span style={{
              background:co.change>=0?`${C.green}22`:`${C.red}22`,
              color:co.change>=0?C.green:C.red,
              fontSize:14,padding:"2px 8px",borderRadius:4,fontWeight:700,whiteSpace:"nowrap"
            }}>{co.change>=0?"▲":"▼"}{Math.abs(co.changePct||0)}%</span>
          </div>
        </div>
      </div>

      <div style={{padding:"10px 11px 0"}}>
        {/* 현재가 티커 */}
        <PriceTicker co={co}/>

        {/* 이격도 신호 배너 */}
        {gapSignal&&(
          <div style={{background:gapSignal==="SELL"?`${C.red}18`:`${C.green}18`,border:`1px solid ${gapSignal==="SELL"?C.red:C.green}`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <span style={{fontSize:17,marginRight:8}}>{gapSignal==="SELL"?"🔴":"🟢"}</span>
              <span style={{color:gapSignal==="SELL"?C.red:C.green,fontSize:14,fontWeight:900}}>
                {gapSignal==="SELL"?"⚠ 매도 신호 — 60MA 이격도 +100% 초과":"✅ 매수 신호 — 60MA 이격도 -20% 이하"}
              </span>
            </div>
            <Tag color={gapSignal==="SELL"?C.red:C.green}>{lastGap!==null?`${lastGap>0?"+":""}${lastGap}%`:"-"}</Tag>
          </div>
        )}

        {/* 탭 */}
        <div style={{display:"flex",gap:4,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              background:tab===t.id?C.blue:C.card,
              color:tab===t.id?"#fff":C.muted,
              border:`1px solid ${tab===t.id?C.blue:C.border}`,
              borderRadius:8,padding:"8px 13px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,
              transition:"all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* 기간 선택 (주가 관련 탭 — 수급 제외) */}
        {["price60","perbpr","compare","technical"].includes(tab)&&(
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {RANGES.map((r,i)=>(
              <button key={i} onClick={()=>setRangeIdx(i)} style={{
                background:rangeIdx===i?`${C.cyan}22`:"transparent",color:rangeIdx===i?C.cyan:C.muted,
                border:`1px solid ${rangeIdx===i?C.cyan:C.border}`,borderRadius:7,padding:"7px 14px",fontSize:13,cursor:"pointer",fontWeight:600,
              }}>{r.label}</button>
            ))}
            <span style={{color:C.muted,fontSize:12,alignSelf:"center",marginLeft:"auto"}}>월봉 기준</span>
          </div>
        )}

        {/* ════ TAB: 종합 ════ */}
        {tab==="overview"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* 종목 기본정보 배너 */}
            <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:11,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:C.muted,fontSize:10,marginBottom:2}}>{co.market} · {co.sector}</div>
                <div style={{color:C.text,fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{co.name} ({co.ticker})</div>
                <div style={{color:C.muted,fontSize:10,marginTop:1}}>CEO {co.ceo} · {(co.shares/1e6).toFixed(1)}백만주</div>
              </div>
              <div style={{display:"flex",gap:10,flexShrink:0}}>
                {[
                  {label:"시가총액",value:`${Math.round(co.currentPrice*co.shares/1e8).toLocaleString()}억`,color:C.cyan},
                  {label:"목표가",  value:`${co.targetPrice?.toLocaleString()}원`,color:C.green},
                  {label:"상승여력",value:`+${(((co.targetPrice/co.currentPrice)-1)*100).toFixed(0)}%`,color:C.green},
                ].map(k=>(
                  <div key={k.label} style={{textAlign:"center"}}>
                    <div style={{color:C.muted,fontSize:9}}>{k.label}</div>
                    <div style={{color:k.color,fontSize:12,fontWeight:800,fontFamily:"monospace",whiteSpace:"nowrap"}}>{k.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <Radar6 scores={scores}/>
            <ST accent={C.blue} right="최근연간">핵심 KPI</ST>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
              <KPI label="매출(연간)" value={`${lastAnn.rev}억`} color={C.blueL}/>
              <KPI label="영업이익"   value={`${lastAnn.op}억`}  color={C.green} sub={`OPM ${((lastAnn.op/lastAnn.rev)*100).toFixed(0)}%`}/>
              <KPI label="순이익"     value={`${lastAnn.net}억`} color={C.cyan}/>
              <KPI label="EPS"       value={`${lastAnn.eps}`}   color={C.gold} unit="원"/>
              <KPI label="ROE"       value={`${lastAnn.roe}%`}  color={C.purple}/>
              <KPI label="FCF"       value={`${lastAnn.fcf}억`} color={C.teal}/>
              <KPI label="부채비율"  value={`${lastAnn.debt}%`} color={C.green} sub="최우량"/>
              <KPI label="유동비율"  value={`${lastAnn.curr}%`} color={C.cyan}/>
            </div>
            <ST accent={C.green}>연간 실적 요약 (YoY 성장률 포함)</ST>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",marginBottom:12}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:C.card2}}>
                  {["연도","매출","YoY","영업이익","OPM","EPS","FCF","ROE","부채"].map(h=>(
                    <th key={h} style={{color:C.muted,padding:"5px 3px",textAlign:"center",borderBottom:`1px solid ${C.border}`,fontSize:9}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{co.annualData.map((r,i)=>{
                  const prev = co.annualData[i-1];
                  const yoy  = prev ? +((r.rev/prev.rev-1)*100).toFixed(1) : null;
                  const isLast = i===co.annualData.length-1;
                  return (
                    <tr key={r.year} style={{background:isLast?C.card2:"transparent",borderBottom:`1px solid ${C.grid}`}}>
                      <td style={{color:isLast?C.gold:C.text,padding:"5px 3px",textAlign:"center",fontFamily:"monospace",fontWeight:isLast?900:400,fontSize:10}}>{r.year}</td>
                      <td style={{color:C.blueL,padding:"5px 3px",textAlign:"right",fontFamily:"monospace",fontSize:10}}>{r.rev}</td>
                      <td style={{color:yoy===null?C.muted:yoy>=0?C.green:C.red,padding:"5px 3px",textAlign:"center",fontFamily:"monospace",fontSize:9}}>
                        {yoy===null?"—":`${yoy>=0?"+":""}${yoy}%`}
                      </td>
                      <td style={{color:C.green,padding:"5px 3px",textAlign:"right",fontFamily:"monospace",fontSize:10}}>{r.op}</td>
                      <td style={{color:C.muted,padding:"5px 3px",textAlign:"right",fontFamily:"monospace",fontSize:9}}>{((r.op/r.rev)*100).toFixed(0)}%</td>
                      <td style={{color:C.gold,padding:"5px 3px",textAlign:"right",fontFamily:"monospace",fontSize:10}}>{r.eps}</td>
                      <td style={{color:C.teal,padding:"5px 3px",textAlign:"right",fontFamily:"monospace",fontSize:10}}>{r.fcf||"-"}</td>
                      <td style={{color:C.purple,padding:"5px 3px",textAlign:"right",fontFamily:"monospace",fontSize:10}}>{r.roe}%</td>
                      <td style={{color:r.debt<=15?C.green:r.debt<=50?C.gold:C.red,padding:"5px 3px",textAlign:"right",fontFamily:"monospace",fontSize:10}}>{r.debt}%</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════ TAB: 사업정보 ════ */}
        {tab==="business"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* 사업 개요 */}
            <div style={{background:`linear-gradient(135deg,${C.card2},${C.card})`,border:`1px solid ${C.border}`,borderRadius:13,padding:"14px 16px",marginBottom:14}}>
              <div style={{color:C.gold,fontSize:12,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>🏢 사업 개요</div>
              <div style={{color:C.text,fontSize:13,lineHeight:1.7}}>{BUSINESS_INFO.overview}</div>
            </div>

            {/* 주요 제품 */}
            <ST accent={C.blue}>주요 제품 · 사업 영역</ST>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
              {BUSINESS_INFO.products.map((p,i)=>(
                <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{color:PALETTE[i],fontSize:14,fontWeight:800}}>{p.name}</span>
                    <span style={{color:PALETTE[i],fontSize:15,fontWeight:900,fontFamily:"monospace"}}>{p.pct}%</span>
                  </div>
                  <div style={{height:5,background:C.border,borderRadius:3,marginBottom:7}}>
                    <div style={{width:`${p.pct}%`,height:"100%",background:PALETTE[i],borderRadius:3,opacity:0.85}}/>
                  </div>
                  <div style={{color:C.muted,fontSize:12,lineHeight:1.5}}>{p.desc}</div>
                </div>
              ))}
            </div>

            {/* 경쟁우위 */}
            <ST accent={C.green}>경쟁 우위 · 핵심 강점</ST>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {BUSINESS_INFO.competitive.map((c,i)=>(
                <div key={i} style={{background:C.card,border:`1px solid ${C.green}33`,borderTop:`2px solid ${C.green}`,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{color:C.green,fontSize:13,fontWeight:800,marginBottom:5}}>✅ {c.title}</div>
                  <div style={{color:C.muted,fontSize:12,lineHeight:1.5}}>{c.desc}</div>
                </div>
              ))}
            </div>

            {/* 리스크 */}
            <ST accent={C.red}>투자 리스크 요인</ST>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {BUSINESS_INFO.risk.map((r,i)=>(
                <div key={i} style={{background:C.card,border:`1px solid ${C.red}33`,borderTop:`2px solid ${C.orange}`,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{color:C.orange,fontSize:13,fontWeight:800,marginBottom:5}}>⚠ {r.title}</div>
                  <div style={{color:C.muted,fontSize:12,lineHeight:1.5}}>{r.desc}</div>
                </div>
              ))}
            </div>

            {/* 파이프라인 */}
            <ST accent={C.purple}>R&D 파이프라인</ST>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,overflow:"hidden",marginBottom:14}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:C.card2}}>
                  {["제품명","단계","예상시기"].map(h=>(
                    <th key={h} style={{color:C.muted,padding:"9px 12px",textAlign:"center",borderBottom:`1px solid ${C.border}`,fontSize:12}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{BUSINESS_INFO.pipeline.map((p,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.grid}`}}>
                    <td style={{color:C.text,padding:"9px 12px",fontSize:13,fontWeight:600}}>{p.name}</td>
                    <td style={{padding:"9px 12px",textAlign:"center"}}>
                      <span style={{background:`${C.purple}22`,color:C.purple,fontSize:12,padding:"3px 9px",borderRadius:5,fontWeight:700}}>{p.stage}</span>
                    </td>
                    <td style={{color:C.gold,padding:"9px 12px",textAlign:"center",fontFamily:"monospace",fontSize:12}}>{p.year}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            {/* 연혁 */}
            <ST accent={C.gold}>주요 연혁</ST>
            <div style={{position:"relative",paddingLeft:20,marginBottom:14}}>
              <div style={{position:"absolute",left:7,top:0,bottom:0,width:2,background:`linear-gradient(180deg,${C.gold},${C.blue})`}}/>
              {BUSINESS_INFO.history.map((h,i)=>(
                <div key={i} style={{position:"relative",marginBottom:12,paddingLeft:18}}>
                  <div style={{position:"absolute",left:-6,top:4,width:10,height:10,borderRadius:"50%",background:i===BUSINESS_INFO.history.length-1?C.gold:C.border,border:`2px solid ${i===BUSINESS_INFO.history.length-1?C.gold:C.blue}`}}/>
                  <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                    <span style={{color:C.gold,fontSize:13,fontWeight:800,fontFamily:"monospace",minWidth:32,flexShrink:0}}>{h.year}</span>
                    <span style={{color:C.text,fontSize:13,lineHeight:1.4}}>{h.event}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════ TAB: 주가·60MA (내재가치선) ════ */}
        {tab==="price60"&&(()=>{
          // 이격도 기반 매수/매도 신호 감지
          const gapSignals = withAll.filter(d=>d.gap60!=null).map((d,i,arr)=>{
            const prev = arr[i-1];
            let sig = null;
            if (d.gap60 >= 100 && (!prev || prev.gap60 < 100)) sig = {type:"매도", color:C.red, icon:"▼", desc:`이격도 +${d.gap60}% 과열`};
            else if (d.gap60 <= -20 && (!prev || prev.gap60 > -20)) sig = {type:"매수", color:C.green, icon:"▲", desc:`이격도 ${d.gap60}% 저평가`};
            else if (d.gap60 >= 60 && (!prev || prev.gap60 < 60)) sig = {type:"경고", color:C.orange, icon:"!", desc:`이격도 +${d.gap60}% 주의`};
            return sig ? {...d, sig} : null;
          }).filter(Boolean);

          // 커스텀 이격도 막대 색상 (매수/매도/중립 구간별)
          const coloredGap = withAll.map(d=>({
            ...d,
            gap60Pos: d.gap60!=null && d.gap60>0 ? d.gap60 : 0,
            gap60Neg: d.gap60!=null && d.gap60<0 ? d.gap60 : 0,
          }));

          return (
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* 설명 배너 */}
            <div style={{background:`${C.gold}11`,border:`1px solid ${C.gold}44`,borderRadius:10,padding:"10px 14px",marginBottom:12}}>
              <div style={{color:C.goldL,fontSize:13,fontWeight:700,marginBottom:3}}>💡 60개월 이동평균 = 내재가치선</div>
              <div style={{color:C.muted,fontSize:12,lineHeight:1.5}}>
                60개월선은 단기 노이즈를 제거한 <span style={{color:C.gold}}>장기 내재가치의 흐름</span>을 보여줍니다.<br/>
                <span style={{color:C.red}}>이격도 +100% 초과 → 과열 (매도▼)</span> &nbsp;|&nbsp; <span style={{color:C.orange}}>+60% → 경고(!)</span> &nbsp;|&nbsp; <span style={{color:C.green}}>이격도 -20% 미만 → 저평가 (매수▲)</span>
              </div>
            </div>

            <ST accent={C.gold}>주가 vs 60개월 이동평균선 (매수▲ · 매도▼ 신호)</ST>
            <Box mb={12} p="14px 7px 6px 3px">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={withAll} margin={{top:20,right:12,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis {...xMonthProps(displayMonthly)}/>
                  <YAxis {...yp("원",44)} tickFormatter={v=>`${(v/1000).toFixed(0)}K`}/>
                  <Tooltip content={<MTip data={displayMonthly}/>}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:12}}/>
                  {/* 매수 영역 */}
                  <ReferenceArea y1={0} y2={withAll.find(d=>d.ma60)?.ma60*0.8||5000} fill={`${C.green}08`}/>
                  <Area dataKey="price" name="주가(원)" stroke={C.cyan} strokeWidth={1.5} fill={`${C.cyan}12`} dot={false}/>
                  <Line dataKey="ma60" name="60MA 내재가치선" stroke={C.gold} strokeWidth={3} dot={false}/>
                  <ReferenceLine y={co.currentPrice} stroke={C.blueL} strokeDasharray="6 3"
                    label={{value:`현재 ${co.currentPrice?.toLocaleString()}원`,fill:C.blueL,fontSize:11,position:"insideTopRight"}}/>
                  <ReferenceLine y={co.targetPrice} stroke={C.green} strokeDasharray="4 2"
                    label={{value:`목표 ${co.targetPrice?.toLocaleString()}원`,fill:C.green,fontSize:11,position:"insideTopRight"}}/>
                  {/* 매수/매도/경고 신호 화살표 */}
                  {gapSignals.map((s,i)=>(
                    <ReferenceDot key={i} x={s.label} y={s.price}
                      r={0}
                      label={{
                        value: s.sig.type==="매수"?"▲매수" : s.sig.type==="매도"?"▼매도" : "!경고",
                        fill: s.sig.color,
                        fontSize: 10,
                        fontWeight: 900,
                        position: s.sig.type==="매수" ? "bottom" : "top",
                      }}
                    />
                  ))}
                  {gapSignals.map((s,i)=>(
                    <ReferenceDot key={`dot${i}`} x={s.label} y={s.price}
                      r={5}
                      fill={s.sig.color}
                      stroke={C.bg}
                      strokeWidth={2}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </Box>

            {/* 이격도 차트 (색상 구분) */}
            <ST accent={C.orange}>60MA 이격도 — 구간별 색상 + 신호</ST>
            <Box mb={12} p="14px 7px 6px 3px">
              <ResponsiveContainer width="100%" height={210}>
                <ComposedChart data={coloredGap} margin={{top:6,right:12,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis {...xMonthProps(displayMonthly)}/>
                  <YAxis {...yp("%")} domain={[-60,160]}/>
                  <Tooltip content={<MTip data={displayMonthly}/>}/>
                  <ReferenceArea y1={100} y2={160} fill={`${C.red}15`} label={{value:"⚠ 매도 구간",fill:C.red,fontSize:11,position:"insideTop"}}/>
                  <ReferenceArea y1={60}  y2={100} fill={`${C.orange}10`}/>
                  <ReferenceArea y1={-60} y2={-20} fill={`${C.green}15`} label={{value:"✅ 매수 구간",fill:C.green,fontSize:11,position:"insideBottom"}}/>
                  <ReferenceLine y={100} stroke={C.red}    strokeWidth={2} strokeDasharray="5 3" label={{value:"매도▼ +100%",fill:C.red,fontSize:11}}/>
                  <ReferenceLine y={60}  stroke={C.orange} strokeWidth={1} strokeDasharray="4 3" label={{value:"경고! +60%",fill:C.orange,fontSize:11}}/>
                  <ReferenceLine y={0}   stroke={C.dim}    strokeWidth={1.5}/>
                  <ReferenceLine y={-20} stroke={C.green}  strokeWidth={2} strokeDasharray="5 3" label={{value:"매수▲ -20%",fill:C.green,fontSize:11}}/>
                  <Bar dataKey="gap60Pos" name="이격도+(%)매도권" maxBarSize={7} radius={[2,2,0,0]}
                    fill={C.red} fillOpacity={0.65} stackId="gap"/>
                  <Bar dataKey="gap60Neg" name="이격도-(%)매수권" maxBarSize={7} radius={[0,0,2,2]}
                    fill={C.green} fillOpacity={0.65} stackId="gap"/>
                  {withAll.slice(-1)[0]?.gap60!=null&&(
                    <ReferenceDot x={withAll.slice(-1)[0].label} y={withAll.slice(-1)[0].gap60}
                      r={6} fill={withAll.slice(-1)[0].gap60>=100?C.red:withAll.slice(-1)[0].gap60<=-20?C.green:C.orange}
                      stroke={C.bg} strokeWidth={2}
                      label={{value:`현재 ${withAll.slice(-1)[0].gap60}%`,fill:C.text,fontSize:12,position:"top"}}/>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </Box>

            {/* 신호 타임라인 */}
            {gapSignals.length>0&&(
              <>
                <ST accent={C.blueL}>60MA 이격도 신호 타임라인</ST>
                <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:14}}>
                  {gapSignals.slice(-8).reverse().map((s,i)=>(
                    <div key={i} style={{background:C.card,border:`1px solid ${s.sig.color}44`,borderLeft:`3px solid ${s.sig.color}`,borderRadius:8,padding:"9px 12px",display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:17,color:s.sig.color,fontWeight:900,minWidth:20}}>{s.sig.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:2}}>
                          <span style={{color:s.sig.color,fontSize:13,fontWeight:800}}>{s.sig.type}</span>
                          <span style={{color:C.muted,fontSize:12,fontFamily:"monospace"}}>{s.label}</span>
                        </div>
                        <div style={{color:C.muted,fontSize:12}}>{s.sig.desc} · 주가 {s.price?.toLocaleString()}원</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{color:s.sig.color,fontSize:14,fontWeight:700,fontFamily:"monospace"}}>{s.gap60>0?"+":""}{s.gap60}%</div>
                        <div style={{color:C.muted,fontSize:11}}>이격도</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          );
        })()}

        {/* ════ TAB: PER/PBR 밴드 ════ */}
        {tab==="perbpr"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <ST accent={C.purple}>역사적 PER 밴드 — 월봉 기준</ST>
            <div style={{background:`${C.purple}11`,border:`1px solid ${C.purple}44`,borderRadius:9,padding:"9px 13px",marginBottom:10,fontSize:11,color:C.muted,lineHeight:1.6}}>
              <span style={{color:"#44FF99",fontWeight:700}}>하단 PER 7배</span>: 저평가 &nbsp;|&nbsp;
              <span style={{color:"#AABBDD"}}>중립 13배</span> &nbsp;|&nbsp;
              <span style={{color:"#FF6080",fontWeight:700}}>상단 PER 20배</span>: 고평가 — 모두 월봉 x축 정렬
            </div>
            <Box mb={14} p="14px 7px 6px 3px">
              <ResponsiveContainer width="100%" height={290}>
                <ComposedChart data={withAll} margin={{top:10,right:14,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis {...xMonthProps(displayMonthly)}/>
                  <YAxis tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="원" width={44} tickFormatter={v=>`${(v/1000).toFixed(0)}K`}/>
                  <Tooltip content={<MTip data={displayMonthly}/>}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                  <Line dataKey="perLo"  name="PER 7배(저평가)"  stroke="#44FF99" strokeWidth={3} strokeDasharray="10 5" dot={false}/>
                  <Line dataKey="perMid" name="PER 13배(중립)"   stroke="#AABBDD" strokeWidth={1.5} strokeDasharray="4 5" dot={false}/>
                  <Line dataKey="perHi"  name="PER 20배(고평가)" stroke="#FF6080" strokeWidth={3} strokeDasharray="10 5" dot={false}/>
                  <Line dataKey="price"  name="실제 주가"         stroke="#00E5FF" strokeWidth={2.5} dot={false}/>
                  <ReferenceLine y={co.currentPrice} stroke="#60CFFF" strokeDasharray="6 3"
                    label={{value:`현재 ${co.currentPrice?.toLocaleString()}원`,fill:"#60CFFF",fontSize:11,position:"insideTopRight"}}/>
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
            <ST accent={C.teal}>역사적 PBR 밴드 — 월봉 기준</ST>
            <div style={{background:`${C.teal}11`,border:`1px solid ${C.teal}44`,borderRadius:9,padding:"9px 13px",marginBottom:10,fontSize:11,color:C.muted,lineHeight:1.6}}>
              <span style={{color:"#44FF99",fontWeight:700}}>하단 PBR 1배</span>: 절대 저평가 &nbsp;|&nbsp;
              <span style={{color:"#FF7090",fontWeight:700}}>상단 PBR 3.5배</span>: 역사적 고평가
            </div>
            <Box mb={14} p="14px 7px 6px 3px">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={withAll} margin={{top:10,right:14,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis {...xMonthProps(displayMonthly)}/>
                  <YAxis tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="원" width={44} tickFormatter={v=>`${(v/1000).toFixed(0)}K`}/>
                  <Tooltip content={<MTip data={displayMonthly}/>}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                  <Line dataKey="pbrLo" name="PBR 1배(저평가)"   stroke="#44FF99" strokeWidth={3} strokeDasharray="10 5" dot={false}/>
                  <Line dataKey="pbrHi" name="PBR 3.5배(고평가)" stroke="#FF7090" strokeWidth={3} strokeDasharray="10 5" dot={false}/>
                  <Line dataKey="price" name="실제 주가"          stroke="#00E5FF" strokeWidth={2.5} dot={false}/>
                  <ReferenceLine y={co.currentPrice} stroke="#60CFFF" strokeDasharray="6 3"
                    label={{value:`현재 ${co.currentPrice?.toLocaleString()}원`,fill:"#60CFFF",fontSize:11,position:"insideTopRight"}}/>
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
            <ST accent={C.gold}>현재 밸류에이션 위치</ST>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
              {[
                {label:"현재 PER",value:`${co.per}배`,loV:7,hiV:20,cur:co.per,lo:"7배",hi:"20배",color:C.purple},
                {label:"현재 PBR",value:`${co.pbr}배`,loV:1,hiV:3.5,cur:co.pbr,lo:"1배",hi:"3.5배",color:C.teal},
              ].map(r=>{
                const pct=Math.min(Math.max(((r.cur-r.loV)/(r.hiV-r.loV))*100,0),100);
                const zone=pct<30?{label:"저평가",color:C.green}:pct<70?{label:"보통",color:C.gold}:{label:"고평가",color:C.red};
                return (
                  <div key={r.label} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 14px",flex:1,minWidth:130}}>
                    <div style={{color:C.muted,fontSize:11,marginBottom:4}}>{r.label}</div>
                    <div style={{color:r.color,fontSize:20,fontWeight:900,fontFamily:"monospace",marginBottom:6}}>{r.value}</div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:4}}>
                      <span style={{color:"#44FF99"}}>{r.lo} 저평가</span><span style={{color:"#FF7090"}}>{r.hi} 고평가</span>
                    </div>
                    <div style={{position:"relative",height:8,background:"linear-gradient(90deg,#44FF99,#E8B840,#FF6080)",borderRadius:4}}>
                      <div style={{position:"absolute",left:`${pct}%`,top:-3,transform:"translateX(-50%)",width:5,height:14,background:"#fff",borderRadius:2,boxShadow:"0 0 6px #fffb"}}/>
                    </div>
                    <div style={{textAlign:"center",marginTop:8}}><Tag color={zone.color} size={9}>{zone.label}</Tag></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ════ TAB: 주가비교 ════ */}
        {tab==="compare"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {(()=>{
              const merged=displayMonthly.map(d=>{
                const ef=M_EPS_FCF_MAP[d.label]||{mEps:null,mFcf:null};
                return {...d,mEps:ef.mEps,mFcf:ef.mFcf};
              });
              return (
                <>
                  <ST accent={C.gold}>주가 vs EPS — 월봉 기준</ST>
                  <div style={{background:`${C.gold}11`,border:`1px solid ${C.gold}33`,borderRadius:9,padding:"8px 12px",marginBottom:10,fontSize:11,color:C.muted}}>
                    주가(하늘색 면적)와 월 환산 EPS(금색 막대)를 동일 월봉 x축에 표시. EPS 우상향인데 주가 정체면 <span style={{color:C.green}}>저평가</span>.
                  </div>
                  <Box mb={14} p="14px 7px 6px 3px">
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={merged} margin={{top:6,right:0,left:0,bottom:10}}>
                        <defs><linearGradient id="pgE" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={C.cyan} stopOpacity={0.25}/>
                          <stop offset="95%" stopColor={C.cyan} stopOpacity={0}/>
                        </linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                        <XAxis {...xMonthProps(displayMonthly)}/>
                        <YAxis yAxisId="l" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="원" width={44} tickFormatter={v=>`${(v/1000).toFixed(0)}K`}/>
                        <YAxis yAxisId="r" orientation="right" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="원" width={32}/>
                        <Tooltip content={<MTip data={displayMonthly}/>}/>
                        <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                        <Area yAxisId="l" dataKey="price" name="주가(원)" stroke={C.cyan} strokeWidth={2} fill="url(#pgE)" dot={false}/>
                        <Bar  yAxisId="r" dataKey="mEps"  name="월EPS(원)" fill={C.gold} fillOpacity={0.8} radius={[2,2,0,0]} maxBarSize={10}/>
                        <ReferenceLine yAxisId="l" y={co.currentPrice} stroke={C.blueL} strokeDasharray="5 2" label={{value:"현재가",fill:C.blueL,fontSize:10,position:"insideTopRight"}}/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Box>
                  <ST accent={C.teal}>주가 vs FCF — 월봉 기준</ST>
                  <div style={{background:`${C.teal}11`,border:`1px solid ${C.teal}33`,borderRadius:9,padding:"8px 12px",marginBottom:10,fontSize:11,color:C.muted}}>
                    월 환산 FCF(막대)와 주가(면적)를 동일 월봉 x축에 표시. FCF 증가 대비 주가 저평가면 <span style={{color:C.green}}>매수 기회</span>.
                  </div>
                  <Box mb={14} p="14px 7px 6px 3px">
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={merged} margin={{top:6,right:0,left:0,bottom:10}}>
                        <defs><linearGradient id="pgF" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={C.cyan} stopOpacity={0.25}/>
                          <stop offset="95%" stopColor={C.cyan} stopOpacity={0}/>
                        </linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                        <XAxis {...xMonthProps(displayMonthly)}/>
                        <YAxis yAxisId="l" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="원" width={44} tickFormatter={v=>`${(v/1000).toFixed(0)}K`}/>
                        <YAxis yAxisId="r" orientation="right" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="억" width={28}/>
                        <Tooltip content={<MTip data={displayMonthly}/>}/>
                        <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                        <Area yAxisId="l" dataKey="price" name="주가(원)" stroke={C.cyan} strokeWidth={2} fill="url(#pgF)" dot={false}/>
                        <Bar  yAxisId="r" dataKey="mFcf"  name="월FCF(억)" fill="#22C55E" fillOpacity={0.9} radius={[2,2,0,0]} maxBarSize={10}/>
                        <ReferenceLine yAxisId="l" y={co.currentPrice} stroke={C.blueL} strokeDasharray="5 2" label={{value:"현재가",fill:C.blueL,fontSize:10,position:"insideTopRight"}}/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Box>
                </>
              );
            })()}
          </div>
        )}

        {/* ════ TAB: 재무·TTM ════ */}
        {tab==="financial"&&(()=>{
          // 5년(20분기) / 10년(40분기) 기간 필터
          const FIN_RANGES = [{label:"5년", n:20},{label:"10년", n:40}];
          const finQData   = Q_FINANCIAL.slice(-finRange);
          const finTtmData = ttmData.slice(-finRange);
          const finFcfData = Q_EPS_FCF.slice(-finRange);
          const finTtmFcf  = ttmFcfData.slice(-finRange);
          const curData    = chartMode==="TTM" ? finTtmData : finQData;
          const curFcfData = chartMode==="TTM" ? finTtmFcf  : finFcfData;

          const finYO = finRange===40; // 10년 모드면 연도만
          const finXH = finYO ? 20 : 36; // x축 높이도 줄이기

          return (
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* ── 컨트롤 바 ── */}
            <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
              {/* 분기/TTM 토글 */}
              <div style={{display:"flex",gap:5}}>
                {[["Q","분기별"],["TTM","누적 TTM"]].map(([id,lb])=>(
                  <button key={id} onClick={()=>setChartMode(id)}
                    style={{background:chartMode===id?`${C.blue}33`:"transparent",color:chartMode===id?C.blueL:C.muted,
                      border:`1px solid ${chartMode===id?C.blue:C.border}`,borderRadius:7,padding:"7px 14px",fontSize:13,cursor:"pointer",fontWeight:600}}>{lb}</button>
                ))}
              </div>
              <div style={{width:1,height:20,background:C.border,margin:"0 2px"}}/>
              {/* 기간 토글 */}
              <div style={{display:"flex",gap:5}}>
                {FIN_RANGES.map(r=>(
                  <button key={r.n} onClick={()=>setFinRange(r.n)}
                    style={{background:finRange===r.n?`${C.cyan}22`:"transparent",color:finRange===r.n?C.cyan:C.muted,
                      border:`1px solid ${finRange===r.n?C.cyan:C.border}`,borderRadius:7,padding:"7px 14px",fontSize:13,cursor:"pointer",fontWeight:600}}>{r.label}</button>
                ))}
              </div>
            </div>

            {/* ── 실적: 버틀러 스타일 스택바 ── */}
            <ST accent={C.blue}>실적 — 매출·이익·비용 구조</ST>
            {(()=>{
              // 분기별 시가총액: Q_FINANCIAL의 각 분기 → 분기말 월봉 주가 매칭
              // qMonth: 분기 → 분기 마지막 월 (Q1→3, Q2→6, Q3→9, Q4→12)
              const qEndMonth = {1:3,2:6,3:9,4:12};
              const mktByLabel = {};
              buildFallbackMonthly().forEach(m=>{
                mktByLabel[`${m.year}.${String(m.month).padStart(2,"0")}`] = m.price;
              });
              // monthly(Yahoo) 데이터도 함께 활용
              monthly.forEach(m=>{
                mktByLabel[m.label] = m.price;
              });

              const withCost = curData.map(d=>{
                const cogs = Math.round(d.rev * 0.38);
                const sga  = Math.round(d.rev * 0.24);
                // 분기말 월 레이블로 주가 조회
                const endM  = qEndMonth[d.q] || 12;
                const lbl   = `${d.y}.${String(endM).padStart(2,"00")}`;
                const price = mktByLabel[lbl] || co.currentPrice || 6800;
                const mktcapQ = Math.round(price * (co.shares||32365678) / 1e8);
                return {...d, cogs, sga, mktcapQ};
              });

              const COL = {
                cogs: "#E85D75",
                sga:  "#FF9640",
                op:   "#4BA8FF",
                rev:  "#A855F7",
                mkt:  "#E2E8F0",
              };
              const mktVals = withCost.map(d=>d.mktcapQ||0).filter(v=>v>0);
              const mktMin = Math.min(...mktVals) * 0.6;
              const mktMax = Math.max(...mktVals) * 1.4;
              return (
              <Box mb={14} p="14px 4px 6px 0">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={withCost} margin={{top:16,right:4,left:0,bottom:finYO?18:28}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="label" height={finXH}
                      tick={<QSupplyTick data={withCost} yearOnly={finYO}/>}
                      tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                    <YAxis yAxisId="l"
                      tick={{fill:C.muted,fontSize:12}} tickLine={false} axisLine={false}
                      unit="억" width={40}/>
                    {/* 우측 Y축: 시가총액 — 숫자/tick 완전 숨김, 스케일용으로만 사용 */}
                    <YAxis yAxisId="r" orientation="right"
                      tick={false} tickLine={false} axisLine={false}
                      width={0} domain={[mktMin, mktMax]}/>
                    <Tooltip
                      contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,fontSize:13,boxShadow:"0 4px 20px #0006"}}
                      formatter={(v,n)=>[`${(+v).toLocaleString()}억`,n]}/>
                    <Legend iconType="square" wrapperStyle={{paddingTop:8,fontSize:10,color:C.text}}/>
                    <Bar yAxisId="l" dataKey="cogs" name="매출원가" stackId="s"
                      fill={COL.cogs} fillOpacity={0.88} maxBarSize={18}/>
                    <Bar yAxisId="l" dataKey="sga" name="판관비" stackId="s"
                      fill={COL.sga} fillOpacity={0.88} maxBarSize={18}/>
                    <Bar yAxisId="l" dataKey="op" name="영업이익" stackId="s"
                      fill={COL.op} fillOpacity={0.95} radius={[3,3,0,0]} maxBarSize={18}/>
                    <Line yAxisId="l" dataKey="rev" name="매출액" type="monotone"
                      stroke={COL.rev} strokeWidth={2.5}
                      dot={{fill:COL.rev,r:3,strokeWidth:0}} activeDot={{r:5}}/>
                    {/* 시가총액: 밝고 두꺼운 선, 우축 스케일 */}
                    <Line yAxisId="r" dataKey="mktcapQ" name="시가총액" type="monotone"
                      stroke={COL.mkt} strokeWidth={3}
                      dot={{fill:COL.mkt,r:3,strokeWidth:0}} activeDot={{r:5}}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
              );
            })()}

            {/* ── EPS 추이 ── */}
            <ST accent={C.gold}>EPS 추이</ST>
            {chartMode==="TTM" ? (
              <CW h={195}>
                <ComposedChart data={finTtmData} margin={{top:4,right:10,left:0,bottom:10}}>
                  <defs>
                    <linearGradient id="epsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.gold} stopOpacity={0.35}/>
                      <stop offset="95%" stopColor={C.gold} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="label" height={finXH} tick={<QSupplyTick data={finTtmData} yearOnly={finYO}/>} tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                  <YAxis {...yp("원",44)}/>
                  <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                  <Area dataKey="eps" name="TTM EPS(원)" stroke={C.gold} strokeWidth={2.5}
                    fill="url(#epsGrad)" dot={{fill:C.gold,r:3,strokeWidth:0}} activeDot={{r:5}}/>
                  {ANN_DATA.slice(-4).map(r=>(
                    <ReferenceLine key={r.year} y={r.eps}
                      stroke={`${C.gold}55`} strokeDasharray="3 4"
                      label={{value:`${r.year}E ${r.eps}`,fill:`${C.gold}99`,fontSize:10,position:"insideTopRight"}}/>
                  ))}
                </ComposedChart>
              </CW>
            ) : (
              <CW h={195}>
                <ComposedChart data={finQData} margin={{top:4,right:10,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="label" height={finXH} tick={<QSupplyTick data={finQData} yearOnly={finYO}/>} tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                  <YAxis {...yp("원",44)}/>
                  <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                  <Bar dataKey="eps" name="분기 EPS(원)" fill={C.gold} fillOpacity={0.85} radius={[2,2,0,0]} maxBarSize={14}/>
                </ComposedChart>
              </CW>
            )}

            {/* ── FCF 추이 (분기 / TTM 모두 지원) ── */}
            <ST accent={C.teal}>FCF 추이</ST>
            {chartMode==="TTM" ? (
              <CW h={195}>
                <ComposedChart data={finTtmFcf} margin={{top:4,right:10,left:0,bottom:10}}>
                  <defs>
                    <linearGradient id="fcfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.teal} stopOpacity={0.35}/>
                      <stop offset="95%" stopColor={C.teal} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="label" height={finXH} tick={<QSupplyTick data={finTtmFcf} yearOnly={finYO}/>} tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                  <YAxis {...yp("억")}/>
                  <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                  <Area dataKey="qFcf" name="TTM FCF(억)" stroke={C.teal} strokeWidth={2.5}
                    fill="url(#fcfGrad)" dot={{fill:C.teal,r:3,strokeWidth:0}} activeDot={{r:5}}/>
                  {ANN_DATA.slice(-4).map(r=>(
                    <ReferenceLine key={r.year} y={r.fcf}
                      stroke={`${C.teal}55`} strokeDasharray="3 4"
                      label={{value:`${r.year}E ${r.fcf}억`,fill:`${C.teal}99`,fontSize:10,position:"insideTopRight"}}/>
                  ))}
                </ComposedChart>
              </CW>
            ) : (
              <CW h={195}>
                <ComposedChart data={curFcfData} margin={{top:4,right:10,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="label" height={finXH} tick={<QSupplyTick data={curFcfData} yearOnly={finYO}/>} tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                  <YAxis {...yp("억")}/>
                  <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                  <Bar dataKey="qFcf" name="분기 FCF(억)" fill={C.teal} fillOpacity={0.85} radius={[2,2,0,0]} maxBarSize={14}/>
                </ComposedChart>
              </CW>
            )}

            {/* ── ROE ── */}
            <ST accent={C.purple} right="분기별">ROE</ST>
            <CW h={175}>
              <AreaChart data={finQData} margin={{top:4,right:10,left:0,bottom:10}}>
                <defs><linearGradient id="roeG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.purple} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.purple} stopOpacity={0}/>
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis dataKey="label" height={finXH} tick={<QSupplyTick data={finQData} yearOnly={finYO}/>} tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                <YAxis {...yp("%")}/>
                <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/>
                <ReferenceLine y={15} stroke={C.dim} strokeDasharray="4 2" label={{value:"ROE 15%",fill:C.muted,fontSize:11}}/>
                <Area dataKey="roe" name="ROE(%)" stroke={C.purple} strokeWidth={2} fill="url(#roeG)" dot={false}/>
              </AreaChart>
            </CW>

            {/* ── 재무현황: 자본총계·부채총계·부채비율 (버틀러 스타일, 분기/TTM) ── */}
            <ST accent={C.teal}>재무현황 — 자본·부채 구조</ST>
            {(()=>{
              // BPS 분기별 보간 맵 구성 (ANN_DATA 연도별 BPS → 분기 선형보간)
              const bpsMap = {};
              ANN_DATA.forEach(d=>{ bpsMap[d.year]=d.bps; });
              const getBps = (y,q) => {
                const bpsCur  = bpsMap[y]   || bpsMap[y-1] || 3000;
                const bpsNext = bpsMap[y+1] || bpsCur;
                // 분기 → 연중 비율 (Q1=0.25, Q2=0.5, Q3=0.75, Q4=1.0)
                const t = q / 4;
                return Math.round(bpsCur + (bpsNext - bpsCur) * t * 0.5);
              };

              // Q 모드: Q_FINANCIAL 분기별 / TTM 모드: ttmData (4분기 누적 평균)
              const rawData = chartMode==="TTM"
                ? ttmData.slice(-finRange)          // ttmData는 debt(최신분기값) 보유
                : Q_FINANCIAL.slice(-finRange);

              const qBal = rawData.map(d=>{
                const bps        = getBps(d.y, d.q);
                const equity     = Math.round(bps * (co.shares||32365678) / 1e8);
                const debt_total = Math.round(equity * (d.debt||0) / 100);
                return { label:d.label, y:d.y, q:d.q, equity, debt_total, debtRatio: d.debt||0 };
              });

              const debtMax = Math.max(...qBal.map(d=>d.debtRatio), 1) * 2.5;
              return (
              <Box mb={14} p="14px 4px 6px 0">
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={qBal} margin={{top:16,right:4,left:0,bottom:finYO?18:28}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="label" height={finXH}
                      tick={<QSupplyTick data={qBal} yearOnly={finYO}/>}
                      tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                    <YAxis yAxisId="l"
                      tick={{fill:C.muted,fontSize:12}} tickLine={false} axisLine={false}
                      unit="억" width={42}/>
                    <YAxis yAxisId="r" orientation="right"
                      tick={false} tickLine={false} axisLine={false}
                      width={0} domain={[0, debtMax]}/>
                    <Tooltip
                      contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,fontSize:13}}
                      formatter={(v,n)=>n.includes("부채비율")?[`${(+v).toFixed(1)}%`,n]:[`${(+v).toLocaleString()}억`,n]}/>
                    <Legend iconType="square" wrapperStyle={{paddingTop:8,fontSize:10}}/>
                    <Bar yAxisId="l" dataKey="equity" name="자본총계" stackId="bal"
                      fill="#4CAF50" fillOpacity={0.75} maxBarSize={16}/>
                    <Bar yAxisId="l" dataKey="debt_total" name="부채총계" stackId="bal"
                      fill="#FFC107" fillOpacity={0.82} radius={[2,2,0,0]} maxBarSize={16}/>
                    <Line yAxisId="r" dataKey="debtRatio" name="부채비율(%)" type="monotone"
                      stroke="#38BDF8" strokeWidth={2.5}
                      dot={{fill:"#38BDF8",r:3,strokeWidth:0}} activeDot={{r:5}}/>
                    <ReferenceLine yAxisId="r" y={100} stroke={C.red} strokeDasharray="4 2"
                      label={{value:"100%",fill:C.red,fontSize:11,position:"insideTopRight"}}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
              );
            })()}

            {/* ── 현금흐름: FCF막대 + 영업/투자/재무 꺾은선 (버틀러 스타일, 분기/TTM) ── */}
            <ST accent={C.cyan}>현금흐름 — FCF·영업·투자·재무</ST>
            {(()=>{
              const rawFcf = chartMode==="TTM" ? ttmFcfData.slice(-finRange) : Q_EPS_FCF.slice(-finRange);
              const cfData = rawFcf.map(d=>{
                const fcfVal = d.qFcf || d.fcf || 0;
                const cfo =  Math.round(fcfVal * 1.38);
                const cfi = -Math.round(fcfVal * 0.52);
                const cff = -Math.round(fcfVal * 0.14);
                return { label:d.label, y:d.y, q:d.q, cfo, cfi, cff, fcf:fcfVal };
              });
              return (
              <Box mb={14} p="14px 4px 6px 0">
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={cfData} margin={{top:16,right:4,left:0,bottom:finYO?18:28}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="label" height={finXH}
                      tick={<QSupplyTick data={cfData} yearOnly={finYO}/>}
                      tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                    <YAxis tick={{fill:C.muted,fontSize:12}} tickLine={false} axisLine={false} unit="억" width={40}/>
                    <Tooltip
                      contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,fontSize:13,boxShadow:"0 4px 20px #0006"}}
                      formatter={(v,n)=>[`${(+v).toLocaleString()}억`,n]}/>
                    <Legend iconType="square" wrapperStyle={{paddingTop:8,fontSize:10}}/>
                    <ReferenceLine y={0} stroke={C.muted} strokeWidth={1.5}/>
                    {/* FCF — 파랑 막대 (핵심 지표, 버틀러 메인) */}
                    <Bar dataKey="fcf" name="FCF"
                      fill="#4BA8FF" fillOpacity={0.9} radius={[3,3,0,0]} maxBarSize={14}/>
                    {/* 영업현금흐름 — 분홍 꺾은선 (버틀러 스타일) */}
                    <Line dataKey="cfo" name="영업현금흐름" type="monotone"
                      stroke="#F472B6" strokeWidth={2.5}
                      dot={{fill:"#F472B6",r:3,strokeWidth:0}} activeDot={{r:5}}/>
                    {/* 투자현금흐름 — 노랑 꺾은선 */}
                    <Line dataKey="cfi" name="투자현금흐름" type="monotone"
                      stroke="#FBBF24" strokeWidth={2}
                      dot={{fill:"#FBBF24",r:2.5,strokeWidth:0}} activeDot={{r:4}}/>
                    {/* 재무현금흐름 — 연두 꺾은선 */}
                    <Line dataKey="cff" name="재무현금흐름" type="monotone"
                      stroke="#86EFAC" strokeWidth={2}
                      dot={{fill:"#86EFAC",r:2.5,strokeWidth:0}} activeDot={{r:4}}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
              );
            })()}
          </div>
          );
        })()}

        {/* ════ TAB: 기술분석 + 공매도 ════ */}
        {tab==="technical"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* OBV·MFI 데이터 출처 안내 */}
            <div style={{background:`${C.teal}11`,border:`1px solid ${C.teal}33`,borderRadius:9,padding:"9px 13px",marginBottom:10,fontSize:11,color:C.muted,lineHeight:1.7}}>
              <span style={{color:C.teal,fontWeight:700}}>📊 데이터 출처</span>　
              <span style={{color:C.text}}>RSI · MACD · OBV · MFI</span> 모두 <span style={{color:C.cyan}}>Yahoo Finance 월봉</span>(종가·거래량)을 기반으로 자체 계산합니다.
              OBV = 전월 대비 상승 시 +거래량, 하락 시 −거래량 누적 /
              MFI = 거래량 가중 RSI (전형가격 × 거래량 기준) /
              공매도 = <span style={{color:C.red}}>KRX 주봉 샘플</span> (실제 연동 전)
            </div>
            <ST accent={C.green} right="월봉 기준">RSI (14개월)</ST>
            <CW h={178}>
              <ComposedChart data={withRSI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xMonthProps(displayMonthly)}/>
                <YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip data={displayMonthly}/>}/>
                <ReferenceArea y1={70} y2={100} fill={`${C.red}12`}/>
                <ReferenceArea y1={0}  y2={30}  fill={`${C.green}12`}/>
                <ReferenceLine y={70} stroke={C.red}   strokeDasharray="4 2" label={{value:"과매수70",fill:C.red,  fontSize:10}}/>
                <ReferenceLine y={50} stroke={C.dim}   strokeDasharray="2 2"/>
                <ReferenceLine y={30} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도30",fill:C.green,fontSize:10}}/>
                <Area dataKey="rsi" name="RSI(%)" stroke={C.green} strokeWidth={2} fill={`${C.green}18`} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.blueL} right="월봉 기준">MACD (12·26·9)</ST>
            <CW h={185}>
              <ComposedChart data={withMACD} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xMonthProps(displayMonthly)}/>
                <YAxis {...yp("",38)}/>
                <Tooltip content={<MTip data={displayMonthly}/>}/>
                <ReferenceLine y={0} stroke={C.dim}/>
                <Bar dataKey="hist" name="히스토그램" maxBarSize={6} radius={[2,2,0,0]} fill={C.blueL} fillOpacity={0.65}/>
                <Line dataKey="macd"   name="MACD"   stroke={C.blueL}  strokeWidth={2}   dot={false}/>
                <Line dataKey="signal" name="Signal" stroke={C.orange} strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.teal} right="월봉 기준 · Yahoo 거래량 기반 누적">OBV (On-Balance Volume)</ST>
            <CW h={160}>
              <AreaChart data={withOBV} margin={{top:4,right:10,left:0,bottom:8}}>
                <defs><linearGradient id="obvG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.teal} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.teal} stopOpacity={0}/>
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xMonthProps(displayMonthly)}/>
                <YAxis {...yp("",44)} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/>
                <Tooltip content={<MTip data={displayMonthly}/>}/>
                <Area dataKey="obv" name="OBV" stroke={C.teal} strokeWidth={2} fill="url(#obvG)" dot={false}/>
              </AreaChart>
            </CW>
            <ST accent={C.pink} right="월봉 기준 · 거래량 가중 RSI">MFI (Money Flow Index)</ST>
            <CW h={160}>
              <ComposedChart data={withMFI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xMonthProps(displayMonthly)}/>
                <YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip data={displayMonthly}/>}/>
                <ReferenceArea y1={80} y2={100} fill={`${C.red}12`}/>
                <ReferenceArea y1={0}  y2={20}  fill={`${C.green}12`}/>
                <ReferenceLine y={80} stroke={C.red}   strokeDasharray="4 2" label={{value:"과열80",  fill:C.red,  fontSize:10}}/>
                <ReferenceLine y={20} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도20",fill:C.green,fontSize:10}}/>
                <Area dataKey="mfi" name="MFI(%)" stroke={C.pink} strokeWidth={2} fill={`${C.pink}18`} dot={false}/>
              </ComposedChart>
            </CW>

            {/* ── 공매도: 분기 x축, 최근 1년(52주) ── */}
            <ST accent={C.red} right="주봉·최근 1년 · KRX 샘플">공매도 비율 현황</ST>
            <div style={{background:`${C.red}11`,border:`1px solid ${C.red}33`,borderRadius:9,padding:"8px 12px",marginBottom:10,fontSize:11,color:C.muted}}>
              주봉 공매도 비율 (최근 52주). x축은 <span style={{color:C.gold}}>분기 단위</span> 표기.
              <span style={{color:C.orange}}> 5% 초과 주의</span> · <span style={{color:C.red}}>8% 위험</span>
            </div>
            <Box mb={12} p="14px 7px 6px 3px">
              <ResponsiveContainer width="100%" height={190}>
                <ComposedChart data={W_SUPPLY_DATA} margin={{top:4,right:6,left:-10,bottom:20}}>
                  <defs><linearGradient id="sgT" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.red} stopOpacity={0.4}/>
                    <stop offset="95%" stopColor={C.red} stopOpacity={0}/>
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  {/* 분기 단위 x축: 13주마다 분기 레이블 표시 */}
                  <XAxis dataKey="label" height={28} interval={12} tickLine={false} axisLine={{stroke:C.border}}
                    tick={(props)=>{
                      const {x,y,payload,index} = props;
                      const parts = payload.value?.split('.')||[];
                      const qMap = {'04':'Q2','07':'Q3','10':'Q4','01':'Q1'};
                      const mo = parts[1]||'';
                      const yr = parts[0]||'';
                      const q  = qMap[mo]||`${mo}월`;
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text x={0} y={0}  textAnchor="middle" fill={C.text}  fontSize={10} fontWeight={700} fontFamily="monospace">{yr}</text>
                          <text x={0} y={13} textAnchor="middle" fill={C.muted} fontSize={9}  fontFamily="monospace">{q}</text>
                        </g>
                      );
                    }}
                  />
                  <YAxis domain={[0,12]} tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="%" width={32}/>
                  <Tooltip
                    contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}
                    formatter={(v,n)=>[`${v?.toFixed?.(1)}%`,n]}
                    labelFormatter={(l)=>`📅 ${l}`}
                  />
                  <ReferenceLine y={5} stroke={C.orange} strokeDasharray="4 2" label={{value:"주의 5%",fill:C.orange,fontSize:10,position:"insideTopRight"}}/>
                  <ReferenceLine y={8} stroke={C.red}    strokeDasharray="4 2" label={{value:"위험 8%",fill:C.red,   fontSize:10,position:"insideTopRight"}}/>
                  <Area dataKey="short" name="공매도(%)" stroke={C.red} strokeWidth={2} fill="url(#sgT)" dot={false}/>
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          </div>
        )}
        {/* ════ TAB: 가치평가 ════ */}
        {tab==="valuation"&&(()=>{
          // 기준 DCF (최근월 기준 고정값 — 슬라이더 변경과 무관)
          const BASE_DCF_INPUT = MITECH_BASE.dcfInput;
          const baseDcf = calcDCF({...BASE_DCF_INPUT, shares: co.shares/1e8});
          const mktCap  = Math.round(co.currentPrice * co.shares / 1e8); // 억원
          const mktCapGap = +((baseDcf.intrinsic / co.currentPrice - 1)*100).toFixed(1);
          const baseLatestMonth = (() => {
            const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}`;
          })();

          return (
          <div style={{animation:"fadeIn 0.3s ease"}}>

            {/* ── 기준 DCF 고정 배너 ── */}
            <div style={{
              background: C.card,
              border:`2px solid ${mktCapGap>=0?C.green:C.red}`,
              borderRadius:13,padding:"12px 14px",marginBottom:12,
            }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{color:C.muted,fontSize:10,letterSpacing:"0.08em",marginBottom:2}}>
                    📌 기준 DCF 내재가치 ({baseLatestMonth} 기준 · FCF {BASE_DCF_INPUT.fcf}억 · 성장률 {(BASE_DCF_INPUT.gr*100).toFixed(0)}% · 할인율 {(BASE_DCF_INPUT.dr*100).toFixed(0)}%)
                  </div>
                  <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:26,fontWeight:900,color:C.gold,fontFamily:"monospace"}}>{baseDcf.intrinsic?.toLocaleString()}원</span>
                    <Tag color={mktCapGap>=0?C.green:C.red} size={10}>
                      {mktCapGap>=0?"저평가":"고평가"} {Math.abs(mktCapGap)}%
                    </Tag>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <div style={{textAlign:"center",background:C.bg,borderRadius:9,padding:"8px 12px",minWidth:80}}>
                    <div style={{color:C.muted,fontSize:10,marginBottom:2}}>현재 시가총액</div>
                    <div style={{color:C.text,fontSize:14,fontWeight:700,fontFamily:"monospace"}}>{mktCap.toLocaleString()}억</div>
                  </div>
                  <div style={{textAlign:"center",background:C.bg,borderRadius:9,padding:"8px 12px",minWidth:80}}>
                    <div style={{color:C.muted,fontSize:10,marginBottom:2}}>내재가치 시총</div>
                    <div style={{color:C.gold,fontSize:14,fontWeight:700,fontFamily:"monospace"}}>
                      {Math.round(baseDcf.intrinsic * co.shares / 1e8).toLocaleString()}억
                    </div>
                  </div>
                  <div style={{textAlign:"center",background:C.bg,borderRadius:9,padding:"8px 12px",minWidth:80}}>
                    <div style={{color:C.muted,fontSize:10,marginBottom:2}}>시총 괴리율</div>
                    <div style={{color:mktCapGap>=0?C.green:C.red,fontSize:14,fontWeight:700,fontFamily:"monospace"}}>
                      {mktCapGap>=0?"+":""}{mktCapGap}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <ST accent={C.gold}>DCF 내재가치 계산기 (슬라이더로 시나리오 조정)</ST>
            <Box p="14px 16px" mb={12}>
              <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14}}>
                {[
                  {key:"fcf",   label:"FCF (억)", step:10,  max:500, fmt:v=>`${v}억`},
                  {key:"gr",    label:"성장률",   step:0.01,max:0.5, fmt:v=>`${(v*100).toFixed(0)}%`},
                  {key:"tg",    label:"영구성장률",step:0.005,max:0.1,fmt:v=>`${(v*100).toFixed(1)}%`},
                  {key:"dr",    label:"할인율",   step:0.005,max:0.3, fmt:v=>`${(v*100).toFixed(1)}%`},
                ].map(f=>(
                  <div key={f.key} style={{flex:"1 1 130px"}}>
                    <div style={{color:C.muted,fontSize:11,marginBottom:3}}>{f.label}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <input type="range" min={0} max={f.max||1000} step={f.step||1} value={dcfP[f.key]}
                        onChange={e=>setDcfP(p=>({...p,[f.key]:+e.target.value}))}
                        style={{flex:1}}/>
                      <span style={{color:C.gold,fontSize:12,fontFamily:"monospace",minWidth:38,textAlign:"right"}}>{f.fmt(dcfP[f.key])}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 14px",flex:1,textAlign:"center"}}>
                  <div style={{color:C.muted,fontSize:10,marginBottom:3}}>시나리오 DCF 내재가치</div>
                  <div style={{color:C.gold,fontSize:22,fontWeight:900,fontFamily:"monospace"}}>{dcfResult.intrinsic?.toLocaleString()}원</div>
                  <div style={{color:dcfResult.intrinsic>co.currentPrice?C.green:C.red,fontSize:12,marginTop:3}}>
                    현재가 대비 {dcfResult.intrinsic>co.currentPrice?"저평가":"고평가"} {Math.abs(((dcfResult.intrinsic/co.currentPrice)-1)*100).toFixed(0)}%
                  </div>
                </div>
                <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 14px",flex:1,textAlign:"center"}}>
                  <div style={{color:C.muted,fontSize:10,marginBottom:3}}>애널리스트 목표가</div>
                  <div style={{color:C.blueL,fontSize:22,fontWeight:900,fontFamily:"monospace"}}>{co.targetPrice?.toLocaleString()}원</div>
                  <div style={{color:C.green,fontSize:12,marginTop:3}}>상승여력 {(((co.targetPrice/co.currentPrice)-1)*100).toFixed(0)}%</div>
                </div>
              </div>

              {/* ── DCF 연산식 참고 ── */}
              <div style={{marginTop:14,background:"transparent",border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px"}}>
                <div style={{color:C.gold,fontSize:11,fontWeight:700,marginBottom:8}}>📐 DCF 연산식 참고</div>
                <div style={{fontFamily:"monospace",fontSize:11,color:C.muted,lineHeight:2}}>
                  <div><span style={{color:C.cyan}}>① 미래 FCF 현재가치</span> = Σ [ FCF × (1+g)ⁿ ÷ (1+r)ⁿ ]　<span style={{color:C.dim}}>n = 1 ~ 10년</span></div>
                  <div><span style={{color:C.teal}}>② 터미널 가치 PV</span> = [ FCF₁₀ × (1+tg) ÷ (r − tg) ] ÷ (1+r)¹⁰</div>
                  <div><span style={{color:C.gold}}>③ 주당 내재가치</span> = ( ① + ② ) ÷ 발행주식수</div>
                  <div style={{marginTop:4,color:C.text,fontSize:11}}>g = 성장률({(dcfP.gr*100).toFixed(0)}%) · tg = 영구성장률({(dcfP.tg*100).toFixed(1)}%) · r = 할인율({(dcfP.dr*100).toFixed(1)}%) · 발행주식수 = {(co.shares/1e6).toFixed(1)}백만주</div>
                </div>
              </div>
            </Box>

            {/* F-Score */}
            <ST accent={C.green}>F-Score (피오트로스키)</ST>
            <Box p="14px 16px" mb={12}>
              <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:10}}>
                <div style={{textAlign:"center",flexShrink:0}}>
                  <div style={{fontSize:42,fontWeight:900,color:fScore.total>=7?C.green:fScore.total>=4?C.gold:C.red,fontFamily:"monospace",lineHeight:1}}>{fScore.total}</div>
                  <div style={{color:C.muted,fontSize:10}}>/9점</div>
                  <div style={{marginTop:5}}><Tag color={fScore.total>=7?C.green:fScore.total>=4?C.gold:C.red}>{fScore.total>=7?"강력매수":fScore.total>=4?"중립":"주의"}</Tag></div>
                </div>
                <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
                  {fScore.items.map((s,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,background:s.val?C.green:C.red}}/>
                      <span style={{color:s.val?C.text:C.muted,fontSize:12,flex:1}}>{s.name}</span>
                      <span style={{color:C.muted,fontSize:10}}>{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Box>
          </div>
          );
        })()}

        {/* ════ TAB: 안정성 ════ */}
        {tab==="stability"&&(()=>{
          const STAB_RANGES=[{label:"10년",n:40},{label:"5년",n:20},{label:"3년",n:12},{label:"1년",n:4}];
          const stabData = Q_FINANCIAL.slice(-stabRange);
          const stabYO = stabRange===40;
          const stabXH = stabYO ? 20 : 36;
          return (
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* 기간 선택 */}
            <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center"}}>
              {STAB_RANGES.map(r=>(
                <button key={r.n} onClick={()=>setStabRange(r.n)}
                  style={{background:stabRange===r.n?`${C.teal}22`:"transparent",color:stabRange===r.n?C.teal:C.muted,
                    border:`1px solid ${stabRange===r.n?C.teal:C.border}`,borderRadius:7,padding:"7px 14px",fontSize:12,cursor:"pointer",fontWeight:600}}>{r.label}</button>
              ))}
            </div>
            <ST accent={C.teal} right="분기 기준">부채비율 · 유동비율</ST>
            <CW h={220}>
              <ComposedChart data={stabData} margin={{top:4,right:4,left:0,bottom:10}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis dataKey="label" height={stabXH} tick={<QSupplyTick data={stabData} yearOnly={stabYO}/>} tickLine={false} axisLine={{stroke:C.border}} interval={0}/>
                <YAxis yAxisId="l" {...yp("%",32)}/>
                <YAxis yAxisId="r" orientation="right" tick={false} tickLine={false} axisLine={false} width={4}/>
                <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/>
                <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:11}}/>
                <ReferenceLine yAxisId="l" y={100} stroke={C.red}   strokeDasharray="4 2" label={{value:"부채100%",fill:C.red,fontSize:10,position:"insideTopRight"}}/>
                <ReferenceLine yAxisId="r" y={200} stroke={C.green} strokeDasharray="4 2" label={{value:"유동200%",fill:C.green,fontSize:10,position:"insideTopRight"}}/>
                <Bar yAxisId="l" dataKey="debt" name="부채비율(%)" fill={C.red}   fillOpacity={0.7} radius={[2,2,0,0]} maxBarSize={14}/>
                <Line yAxisId="r" dataKey="curr" name="유동비율(%)" stroke={C.green} strokeWidth={2} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.green} right="최근분기">안정성 스냅샷</ST>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
              <KPI label="부채비율"    value="8.5%"    color={C.green} sub="최우량(≤10%)"/>
              <KPI label="유동비율"    value="1,055%"  color={C.cyan}  sub="초과유동(≥200%)"/>
              <KPI label="순현금보유"  value="65%"     color={C.teal}  sub="순차입금/자본"/>
              <KPI label="이자보상배율" value="1,786x" color={C.green} sub="2025E"/>
            </div>
            <ST accent={C.orange}>Earnings Surprise 트래킹</ST>
            <Box p="14px 16px" mb={12}>
              {[
                {q:"24Q1",cons:50,actual:56,beat:true},
                {q:"24Q2",cons:45,actual:48,beat:true},
                {q:"24Q3",cons:46,actual:44,beat:false},
                {q:"24Q4",cons:38,actual:35,beat:false},
                {q:"25Q1",cons:52,actual:58,beat:true},
                {q:"25Q2",cons:58,actual:58,beat:true},
                {q:"25Q3",cons:55,actual:50,beat:false},
                {q:"25Q4",cons:62,actual:70,beat:true},
              ].map(r=>(
                <div key={r.q} style={{display:"flex",alignItems:"center",gap:10,padding:"5px 0",borderBottom:`1px solid ${C.grid}`}}>
                  <span style={{color:C.muted,fontSize:11,fontFamily:"monospace",minWidth:34}}>{r.q}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.muted,marginBottom:2}}>
                      <span>컨센서스 {r.cons}억</span><span>실제 {r.actual}억</span>
                    </div>
                    <div style={{height:4,background:C.border,borderRadius:2}}>
                      <div style={{width:`${Math.min((r.actual/Math.max(r.cons,r.actual))*100,100)}%`,height:"100%",background:r.beat?C.green:C.red,borderRadius:2}}/>
                    </div>
                  </div>
                  <Tag color={r.beat?C.green:C.red}>{r.beat?`+${r.actual-r.cons}억↑`:`${r.actual-r.cons}억↓`}</Tag>
                </div>
              ))}
            </Box>
          </div>
          );
        })()}

        {/* ════ TAB: 배당 ════ */}
        {tab==="dividend"&&(()=>{
          const divData = DIVIDEND_DATA.slice(-divRange);
          return (
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* 샘플 데이터 안내 */}
            <div style={{background:`${C.orange}18`,border:`1px solid ${C.orange}55`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",gap:8,alignItems:"flex-start"}}>
              <span style={{fontSize:17,flexShrink:0}}>⚠️</span>
              <div>
                <div style={{color:C.orange,fontSize:13,fontWeight:700,marginBottom:2}}>샘플 데이터 — DART 연동 후 자동 갱신</div>
                <div style={{color:C.muted,fontSize:12,lineHeight:1.5}}>
                  현재 배당 수치는 <span style={{color:C.gold}}>추정 샘플값</span>입니다. DART OpenAPI 연동 시 실제 공시 배당금·시가배당률·배당성향이 자동으로 교체됩니다.
                  엠아이텍은 2018년부터 배당을 실시하고 있으며, 정확한 수치는 전자공시시스템(DART)에서 확인하세요.
                </div>
              </div>
            </div>
            {/* 기간 선택 */}
            <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center"}}>
              {[{label:"10년",n:10},{label:"5년",n:5}].map(r=>(
                <button key={r.n} onClick={()=>setDivRange(r.n)}
                  style={{background:divRange===r.n?`${C.gold}22`:"transparent",color:divRange===r.n?C.gold:C.muted,
                    border:`1px solid ${divRange===r.n?C.gold:C.border}`,borderRadius:7,padding:"7px 14px",fontSize:13,cursor:"pointer",fontWeight:600}}>{r.label}</button>
              ))}
            </div>

            {/* 배당 KPI */}
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:14}}>
              {[
                {label:"최근 배당금",  value:`${divData.slice(-1)[0]?.dps||0}원/주`,  color:C.gold},
                {label:"시가배당률",   value:`${divData.slice(-1)[0]?.yield||0}%`,    color:C.green},
                {label:"배당성향",     value:`${divData.slice(-1)[0]?.payout||0}%`,   color:C.purple},
                {label:"배당성장(5yr)",value:`+${(((divData.slice(-1)[0]?.dps||1)/(divData.slice(-6,-5)[0]?.dps||1)-1)*100).toFixed(0)}%`, color:C.cyan},
              ].map(k=>(
                <KPI key={k.label} label={k.label} value={k.value} color={k.color}/>
              ))}
            </div>

            {/* 배당금 막대 + 시가배당률 꺾은선 */}
            <ST accent={C.gold}>연도별 배당금(막대) · 시가배당률(꺾은선)</ST>
            <Box mb={14} p="14px 4px 6px 0">
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={divData} margin={{top:4,right:8,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="year" tick={{fill:C.muted,fontSize:12}} tickLine={false} axisLine={{stroke:C.border}}/>
                  <YAxis yAxisId="l" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="원" width={40}/>
                  <YAxis yAxisId="r" orientation="right" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="%" width={34}/>
                  <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}
                    formatter={(v,n)=>n.includes("배당률")?[`${v}%`,n]:[`${v}원`,n]}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop:6,fontSize:12}}/>
                  <Bar yAxisId="l" dataKey="dps" name="배당금(원)" fill={C.gold} fillOpacity={0.8} radius={[3,3,0,0]} maxBarSize={30}/>
                  <Line yAxisId="r" dataKey="yield" name="시가배당률(%)" stroke={C.green} strokeWidth={2.5}
                    dot={{fill:C.green,r:4,strokeWidth:0}} activeDot={{r:6}}/>
                </ComposedChart>
              </ResponsiveContainer>
            </Box>

            {/* 배당성향 차트 */}
            <ST accent={C.purple}>연도별 배당성향</ST>
            <Box mb={14} p="14px 7px 6px 3px">
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={divData.filter(d=>d.payout>0)} margin={{top:4,right:10,left:0,bottom:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="year" tick={{fill:C.muted,fontSize:12}} tickLine={false} axisLine={{stroke:C.border}}/>
                  <YAxis tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={false} unit="%" width={36}/>
                  <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}
                    formatter={(v)=>[`${v}%`,"배당성향"]}/>
                  <ReferenceLine y={50} stroke={C.dim} strokeDasharray="4 2" label={{value:"50%기준",fill:C.muted,fontSize:11}}/>
                  <Bar dataKey="payout" name="배당성향(%)" fill={C.purple} fillOpacity={0.75} radius={[3,3,0,0]} maxBarSize={28}/>
                </ComposedChart>
              </ResponsiveContainer>
            </Box>

            {/* 배당 도표 */}
            <ST accent={C.blueL}>배당 상세 도표</ST>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",marginBottom:14}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:C.card2}}>
                  {["연도","배당금(원)","시가배당률","배당성향","비고"].map(h=>(
                    <th key={h} style={{color:C.muted,padding:"9px 8px",textAlign:"center",borderBottom:`1px solid ${C.border}`,fontSize:12}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{[...divData].reverse().map((r,i)=>{
                  const isLast = i===0;
                  return (
                    <tr key={r.year} style={{background:isLast?C.card2:"transparent",borderBottom:`1px solid ${C.grid}`}}>
                      <td style={{color:isLast?C.gold:C.text,padding:"8px",textAlign:"center",fontFamily:"monospace",fontWeight:isLast?900:400,fontSize:12}}>{r.year}</td>
                      <td style={{color:r.dps>0?C.gold:C.muted,padding:"8px",textAlign:"center",fontFamily:"monospace",fontSize:12,fontWeight:700}}>{r.dps>0?`${r.dps}원`:"—"}</td>
                      <td style={{color:r.yield>0?C.green:C.muted,padding:"8px",textAlign:"center",fontFamily:"monospace",fontSize:12}}>{r.yield>0?`${r.yield}%`:"—"}</td>
                      <td style={{color:r.payout>0?C.purple:C.muted,padding:"8px",textAlign:"center",fontFamily:"monospace",fontSize:12}}>{r.payout>0?`${r.payout}%`:"—"}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        {r.dps>0
                          ? <span style={{background:`${C.gold}22`,color:C.gold,fontSize:12,padding:"2px 8px",borderRadius:5}}>배당실시</span>
                          : <span style={{background:`${C.muted}22`,color:C.muted,fontSize:12,padding:"2px 8px",borderRadius:5}}>무배당</span>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* ════ TAB: 매출구조 ════ */}
        {tab==="sales"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <ST accent={C.orange}>지역별 매출 (2025년)</ST>
            <div style={{display:"flex",gap:9,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:10,flex:"1 1 170px"}}>
                <ResponsiveContainer width="100%" height={155}>
                  <PieChart>
                    <Pie data={co.regionalSales} dataKey="pct" nameKey="region" cx="50%" cy="50%" outerRadius={62} paddingAngle={3}>
                      {co.regionalSales?.map((e,i)=><Cell key={i} fill={e.color||PALETTE[i]}/>)}
                    </Pie>
                    <Tooltip formatter={(v,n)=>[`${v}%`,n]} contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,fontSize:11}}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{flex:"1 1 130px",display:"flex",flexDirection:"column",gap:5}}>
                {co.regionalSales?.map((r,i)=>(
                  <div key={i} style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 9px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{color:r.color||PALETTE[i],fontSize:12,fontWeight:700}}>{r.region}</span>
                      <span style={{color:C.text,fontSize:11,fontFamily:"monospace"}}>{r.pct}%</span>
                    </div>
                    <div style={{height:3,background:C.border,borderRadius:2}}>
                      <div style={{width:`${r.pct}%`,height:"100%",background:r.color||PALETTE[i],borderRadius:2}}/>
                    </div>
                    <div style={{color:C.muted,fontSize:10,marginTop:2}}>{r.amount}억원</div>
                  </div>
                ))}
              </div>
            </div>
            <ST accent={C.cyan}>사업별 매출 (2025년)</ST>
            <div style={{display:"flex",gap:9,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:10,flex:"1 1 170px"}}>
                <ResponsiveContainer width="100%" height={130}>
                  <PieChart>
                    <Pie data={co.segmentSales} dataKey="pct" nameKey="segment" cx="50%" cy="50%" innerRadius={35} outerRadius={58} paddingAngle={3}>
                      {co.segmentSales?.map((e,i)=><Cell key={i} fill={e.color||PALETTE[i]}/>)}
                    </Pie>
                    <Tooltip formatter={(v,n)=>[`${v}%`,n]} contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,fontSize:11}}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{flex:"1 1 130px",display:"flex",flexDirection:"column",gap:5}}>
                {co.segmentSales?.map((r,i)=>(
                  <div key={i} style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 9px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{color:r.color||PALETTE[i],fontSize:12,fontWeight:700}}>{r.segment}</span>
                      <span style={{color:C.text,fontSize:11,fontFamily:"monospace"}}>{r.pct}%</span>
                    </div>
                    <div style={{height:3,background:C.border,borderRadius:2}}>
                      <div style={{width:`${r.pct}%`,height:"100%",background:r.color||PALETTE[i],borderRadius:2}}/>
                    </div>
                    <div style={{color:C.muted,fontSize:10,marginTop:2}}>{r.amount}억원</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ TAB: 주주·공시 ════ */}
        {tab==="governance"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <ST accent={C.gold} right="2025년 3분기 말 기준">주요 주주 현황</ST>
            <div style={{background:`${C.gold}11`,border:`1px solid ${C.gold}33`,borderRadius:8,padding:"6px 12px",marginBottom:8,fontSize:11,color:C.muted}}>
              📅 기준일: <span style={{color:C.gold}}>2025년 9월 30일</span> (2025Q3 말) · 출처: DART 공시 / 보통주 기준 · 변동은 전분기 대비
            </div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",marginBottom:12}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:C.card2}}>
                  {["주주명","지분율","주식수","변동"].map(h=>(
                    <th key={h} style={{color:C.muted,padding:"7px 7px",textAlign:"center",borderBottom:`1px solid ${C.border}`,fontSize:10}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{co.majorShareholders?.map((s,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.grid}`}}>
                    <td style={{color:C.text,padding:"7px 7px",fontSize:12}}>{s.name}</td>
                    <td style={{padding:"7px 7px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <div style={{flex:1,height:3,background:C.border,borderRadius:2}}>
                          <div style={{width:`${Math.min(s.pct,100)}%`,height:"100%",background:i===0?C.gold:PALETTE[i%8],borderRadius:2}}/>
                        </div>
                        <span style={{color:C.text,fontSize:10,fontFamily:"monospace",minWidth:30}}>{s.pct}%</span>
                      </div>
                    </td>
                    <td style={{color:C.muted,padding:"7px 7px",textAlign:"right",fontSize:11,fontFamily:"monospace"}}>{s.shares?.toLocaleString()}</td>
                    <td style={{padding:"7px 7px",textAlign:"center"}}>
                      <span style={{color:s.change>0?C.green:s.change<0?C.red:C.muted,fontSize:11,fontFamily:"monospace"}}>
                        {s.change>0?`+${s.change}%`:s.change<0?`${s.change}%`:"—"}
                      </span>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:10,marginBottom:12}}>
              <ResponsiveContainer width="100%" height={155}>
                <PieChart>
                  <Pie data={co.majorShareholders} dataKey="pct" nameKey="name" cx="50%" cy="50%" outerRadius={62} paddingAngle={2}>
                    {co.majorShareholders?.map((e,i)=><Cell key={i} fill={i===0?C.gold:PALETTE[i%8]}/>)}
                  </Pie>
                  <Tooltip formatter={(v,n)=>[`${v}%`,n]} contentStyle={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,fontSize:11}}/>
                  <Legend iconType="circle" wrapperStyle={{fontSize:10}}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ST accent={C.blueL} right="DART 연동 · 최근 12개월">최근 주요 공시</ST>
            <div style={{background:`${C.blueL}11`,border:`1px solid ${C.blueL}33`,borderRadius:8,padding:"6px 12px",marginBottom:8,fontSize:11,color:C.muted}}>
              📅 조회기간: <span style={{color:C.blueL}}>2024년 1월 1일 ~ 현재</span> · 출처: DART OpenAPI · DART 검색 후 자동 갱신
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {co.disclosures?.map((d,i)=>{
                const sc=d.sentiment==="pos"?C.green:d.sentiment==="neg"?C.red:C.muted;
                return (
                  <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`3px solid ${sc}`,borderRadius:8,padding:"8px 11px"}}>
                    <div style={{display:"flex",gap:5,marginBottom:3,alignItems:"center"}}>
                      <Tag color={sc}>{d.type}</Tag>
                      <span style={{color:C.muted,fontSize:10}}>{d.date}</span>
                    </div>
                    <div style={{color:C.text,fontSize:12,lineHeight:1.4}}>{d.title}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ════ TAB: 9인의 거장 컨센서스 ════ */}
        {tab==="masters"&&(()=>{
          // ── 필요 데이터 추출 ──────────────────────────────────────────
          const ann      = co.annualData;
          const last     = ann.slice(-1)[0]||{};
          const prev     = ann.slice(-2,-1)[0]||{};
          const prev2    = ann.slice(-3,-2)[0]||{};
          const price    = co.currentPrice||6800;
          const shares   = co.shares||32365678;

          // TTM EPS (최근 4분기 합)
          const ttmEps = Q_FINANCIAL.slice(-4).reduce((s,x)=>s+x.eps,0);
          // TTM FCF
          const ttmFcf = Q_EPS_FCF.slice(-4).reduce((s,x)=>s+x.qFcf,0);
          // 최근 분기 EPS 성장률 (직전 동기 대비)
          const curQeps  = Q_FINANCIAL.slice(-1)[0]?.eps||0;
          const prevYQeps= Q_FINANCIAL.slice(-5,-4)[0]?.eps||1;
          const qEpsGrowth = +((curQeps/prevYQeps-1)*100).toFixed(1);
          // 연간 EPS 성장률
          const epsGrowth = prev.eps ? +((last.eps/prev.eps-1)*100).toFixed(1) : 0;
          // 평균 ROE (3년)
          const avgRoe3 = ann.slice(-3).reduce((s,x)=>s+(x.roe||0),0)/3;
          // 영업이익률
          const opm = last.rev ? +((last.op/last.rev)*100).toFixed(1) : 0;
          const prevOpm = prev.rev ? +((prev.op/prev.rev)*100).toFixed(1) : 0;
          // PER (현재가 / TTM EPS)
          const per = ttmEps>0 ? +(price/ttmEps).toFixed(1) : co.per;
          // PBR (현재가 / BPS)
          const bps = last.bps||3363;
          const pbr = +(price/bps).toFixed(2);
          // 시가총액 (억)
          const mktCap = Math.round(price*shares/1e8);
          // 순현금 추정 (유동비율 기반 간이 추정)
          const netCash = Math.round(last.fcf*2.5); // 보수적 추정
          // 60MA (최신)
          const ma60val = withMA60.slice(-1)[0]?.ma60||0;
          // ROIC 추정 = 영업이익 / (자기자본 + 순차입금) ≈ ROE × (1 - 부채비율/100)
          const roic = +(last.roe*(1-last.debt/200)).toFixed(1);
          // 배당수익률 (엠아이텍 무배당이므로 0 처리)
          const divYield = 0;
          // 매출 성장률 YoY
          const revGrowth = prev.rev ? +((last.rev/prev.rev-1)*100).toFixed(1) : 0;
          // 그레이엄 적정가 = sqrt(22.5 × EPS × BPS)
          const grahamFair = +(Math.sqrt(22.5*ttmEps*bps)).toFixed(0);
          // PEG
          const peg = epsGrowth>0 ? +(per/epsGrowth).toFixed(2) : 99;
          // 존 네프: 배당+이익성장 / PER
          const neffRatio = per>0 ? +((divYield+epsGrowth)/per).toFixed(2) : 0;

          // ── 9인 판정 로직 ─────────────────────────────────────────────
          const judge = (pass, fail, reason) => {
            if(pass)      return {verdict:"추천", color:C.green,  icon:"✅", reason};
            if(fail)      return {verdict:"비추천",color:C.red,   icon:"❌", reason};
            return               {verdict:"중립",  color:C.gold,  icon:"⚖️", reason};
          };

          const masters = [
            {
              name:"Benjamin Graham",
              ko:"벤자민 그레이엄",
              style:"안전마진의 아버지 · 자산가치",
              calc: judge(
                price < grahamFair*0.85,
                price > grahamFair*1.10,
                `Graham 적정가 ${grahamFair.toLocaleString()}원 | 현재가 ${price.toLocaleString()}원 | 괴리율 ${((price/grahamFair-1)*100).toFixed(1)}%`
              ),
              detail:[
                {k:"Graham Fair Value", v:`${grahamFair.toLocaleString()}원`},
                {k:"TTM EPS", v:`${ttmEps}원`},{k:"BPS",v:`${bps.toLocaleString()}원`},
              ]
            },
            {
              name:"Warren Buffett",
              ko:"워렌 버핏",
              style:"경제적 해자 · 장기 복리",
              calc: judge(
                avgRoe3>=15 && last.debt<50 && last.fcf>0,
                avgRoe3<10 || last.debt>100,
                `3년 평균 ROE ${avgRoe3.toFixed(1)}% | 부채비율 ${last.debt}% | FCF ${last.fcf}억`
              ),
              detail:[
                {k:"3yr avg ROE",v:`${avgRoe3.toFixed(1)}%`},
                {k:"부채비율",v:`${last.debt}%`},{k:"FCF",v:`${last.fcf}억`},
              ]
            },
            {
              name:"Peter Lynch",
              ko:"피터 린치",
              style:"PEG · 10루타 성장주",
              calc: judge(
                peg<1.0 && epsGrowth>0,
                peg>=1.5 || epsGrowth<=0,
                `PEG ${peg===99?"N/A":peg} | PER ${per}배 | EPS성장률 ${epsGrowth}%`
              ),
              detail:[
                {k:"PEG Ratio",v:peg===99?"N/A":peg},{k:"PER",v:`${per}배`},
                {k:"EPS 성장률",v:`${epsGrowth}%`},
              ]
            },
            {
              name:"Philip Fisher",
              ko:"필립 피셔",
              style:"탁월한 경영·성장 잠재력",
              calc: judge(
                opm>=15 && opm>prevOpm && revGrowth>10,
                opm<8 || revGrowth<0,
                `OPM ${opm}% (전년 ${prevOpm}%) | 매출성장 ${revGrowth}% YoY`
              ),
              detail:[
                {k:"영업이익률",v:`${opm}%`},{k:"전년 OPM",v:`${prevOpm}%`},
                {k:"매출 YoY",v:`${revGrowth}%`},
              ]
            },
            {
              name:"Charlie Munger",
              ko:"찰리 멍거",
              style:"ROIC · 독점적 해자",
              calc: judge(
                roic>=15 && last.debt<30,
                roic<8 || last.debt>80,
                `추정 ROIC ${roic}% | 부채비율 ${last.debt}% | 사업 독점성 판단`
              ),
              detail:[
                {k:"추정 ROIC",v:`${roic}%`},{k:"부채비율",v:`${last.debt}%`},
                {k:"OPM",v:`${opm}%`},
              ]
            },
            {
              name:"Mohnish Pabrai",
              ko:"모니시 파브라이",
              style:"하방 제한 · 턴어라운드",
              calc: judge(
                pbr<1.5 && last.fcf>0 && revGrowth>0,
                pbr>3.0 || last.fcf<0,
                `PBR ${pbr}배 | FCF ${last.fcf}억 | 매출성장 ${revGrowth}%`
              ),
              detail:[
                {k:"PBR",v:`${pbr}배`},{k:"FCF",v:`${last.fcf}억`},
                {k:"매출 YoY",v:`${revGrowth}%`},
              ]
            },
            {
              name:"John Neff",
              ko:"존 네프",
              style:"저PER · 배당+성장 복합",
              calc: judge(
                per<15 && neffRatio>=2,
                per>20 || neffRatio<1,
                `(배당${divYield}%+EPS성장${epsGrowth}%)/PER${per}배 = ${neffRatio} (≥2.0 추천)`
              ),
              detail:[
                {k:"PER",v:`${per}배`},{k:"Neff Ratio",v:neffRatio},
                {k:"EPS 성장률",v:`${epsGrowth}%`},
              ]
            },
            {
              name:"William O'Neil",
              ko:"윌리엄 오닐",
              style:"CAN-SLIM · 기술+펀더멘털",
              calc: judge(
                price>ma60val && qEpsGrowth>=20,
                price<ma60val*0.9 || qEpsGrowth<0,
                `현재가 ${price.toLocaleString()}원 vs 60MA ${ma60val.toLocaleString()}원 | 분기EPS YoY ${qEpsGrowth}%`
              ),
              detail:[
                {k:"현재가 vs 60MA",v:price>ma60val?"위":"아래"},
                {k:"분기 EPS YoY",v:`${qEpsGrowth}%`},{k:"60MA",v:`${ma60val.toLocaleString()}원`},
              ]
            },
            {
              name:"Seth Klarman",
              ko:"세스 클라만",
              style:"극단적 안전마진 · 자산가치",
              calc: judge(
                netCash>mktCap*0.5 || pbr<1.0,
                pbr>2.5 && netCash<mktCap*0.2,
                `추정 순현금 ${netCash}억 | 시총 ${mktCap}억 | PBR ${pbr}배`
              ),
              detail:[
                {k:"추정 순현금",v:`${netCash}억`},{k:"시총",v:`${mktCap}억`},
                {k:"PBR",v:`${pbr}배`},
              ]
            },
          ];

          const passCount = masters.filter(m=>m.calc.verdict==="추천").length;
          const consensus = passCount>=5?"강력매수":passCount>=3?"중립":"관망";
          const consensusColor = passCount>=5?C.green:passCount>=3?C.gold:C.red;

          return (
          <div style={{animation:"fadeIn 0.3s ease"}}>

            {/* ── 컨센서스 배너 ── */}
            <div style={{
              background:`linear-gradient(135deg,${consensusColor}18,${C.card2})`,
              border:`2px solid ${consensusColor}66`,
              borderRadius:14,padding:"14px 16px",marginBottom:14,
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{color:C.muted,fontSize:10,letterSpacing:"0.12em",marginBottom:3}}>
                    👑 9인의 가치투자 거장 · 컨센서스
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{fontSize:22,fontWeight:900,color:consensusColor,fontFamily:"monospace",letterSpacing:"0.05em"}}>
                      SEQUOIA: {consensus}
                    </span>
                    <Tag color={consensusColor} size={11}>{passCount}/9 추천</Tag>
                  </div>
                  <div style={{color:C.muted,fontSize:11,marginTop:4}}>
                    ※ 팩트 기반 알고리즘 판정 · 투자 참고용 · 최종 판단은 본인 책임
                  </div>
                </div>
                {/* 미니 스코어바 */}
                <div style={{display:"flex",gap:3}}>
                  {masters.map((m,i)=>(
                    <div key={i} style={{
                      width:8,height:32,borderRadius:3,
                      background:m.calc.color,opacity:0.85,
                      title:m.ko,
                    }}/>
                  ))}
                </div>
              </div>
              {/* 집계 */}
              <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                {[
                  {label:"✅ 추천",  val:masters.filter(m=>m.calc.verdict==="추천").length,  color:C.green},
                  {label:"⚖️ 중립",  val:masters.filter(m=>m.calc.verdict==="중립").length,  color:C.gold},
                  {label:"❌ 비추천",val:masters.filter(m=>m.calc.verdict==="비추천").length, color:C.red},
                ].map(s=>(
                  <div key={s.label} style={{background:C.bg,borderRadius:8,padding:"6px 12px",display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{color:s.color,fontSize:12,fontWeight:800,fontFamily:"monospace"}}>{s.val}명</span>
                    <span style={{color:C.muted,fontSize:11}}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 3×3 그리드 ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              {masters.map((m,i)=>(
                <div key={i} style={{
                  background:C.card,
                  border:`1.5px solid ${m.calc.color}55`,
                  borderTop:`3px solid ${m.calc.color}`,
                  borderRadius:11,padding:"10px 10px 8px",
                  position:"relative",
                }}>
                  {/* 판정 뱃지 */}
                  <div style={{position:"absolute",top:8,right:8,fontSize:15}}>{m.calc.icon}</div>
                  {/* 이름 */}
                  <div style={{color:m.calc.color,fontSize:11,fontWeight:800,letterSpacing:"0.04em",marginBottom:1}}>{m.ko}</div>
                  <div style={{color:C.muted,fontSize:9,marginBottom:5,lineHeight:1.3}}>{m.style}</div>
                  {/* 판정 */}
                  <div style={{
                    display:"inline-block",
                    background:`${m.calc.color}22`,color:m.calc.color,
                    fontSize:11,fontWeight:900,padding:"2px 7px",borderRadius:4,marginBottom:6,
                  }}>{m.calc.verdict}</div>
                  {/* 핵심 근거 */}
                  <div style={{color:C.muted,fontSize:7.5,lineHeight:1.5,marginBottom:6,minHeight:28}}>
                    {m.calc.reason}
                  </div>
                  {/* 세부 수치 */}
                  <div style={{borderTop:`1px solid ${C.border}`,paddingTop:5,display:"flex",flexDirection:"column",gap:2}}>
                    {m.detail.map((d,j)=>(
                      <div key={j} style={{display:"flex",justifyContent:"space-between"}}>
                        <span style={{color:C.muted,fontSize:9}}>{d.k}</span>
                        <span style={{color:C.text,fontSize:7.5,fontFamily:"monospace",fontWeight:700}}>{d.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── 근거 데이터 요약 ── */}
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 14px"}}>
              <div style={{color:C.gold,fontSize:11,fontWeight:700,marginBottom:8}}>📋 판정 기준 입력 데이터 ({last.year}년 기준)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[
                  {k:"현재가",v:`${price.toLocaleString()}원`},
                  {k:"TTM EPS",v:`${ttmEps}원`},
                  {k:"BPS",v:`${bps.toLocaleString()}원`},
                  {k:"Graham FV",v:`${grahamFair.toLocaleString()}원`},
                  {k:"PER(TTM)",v:`${per}배`},
                  {k:"PBR",v:`${pbr}배`},
                  {k:"PEG",v:peg===99?"N/A":peg},
                  {k:"3yr ROE",v:`${avgRoe3.toFixed(1)}%`},
                  {k:"추정 ROIC",v:`${roic}%`},
                  {k:"OPM",v:`${opm}%`},
                  {k:"부채비율",v:`${last.debt}%`},
                  {k:"FCF",v:`${last.fcf}억`},
                  {k:"매출 YoY",v:`${revGrowth}%`},
                  {k:"EPS 성장률",v:`${epsGrowth}%`},
                  {k:"분기EPS YoY",v:`${qEpsGrowth}%`},
                  {k:"60MA",v:`${ma60val.toLocaleString()}원`},
                  {k:"시총",v:`${mktCap}억`},
                  {k:"순현금(추정)",v:`${netCash}억`},
                ].map((d,i)=>(
                  <div key={i} style={{background:C.card2,borderRadius:7,padding:"5px 9px",border:`1px solid ${C.border}`}}>
                    <div style={{color:C.muted,fontSize:9}}>{d.k}</div>
                    <div style={{color:C.text,fontSize:11,fontWeight:700,fontFamily:"monospace"}}>{d.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          );
        })()}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,padding:"9px 13px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:5,marginTop:14}}>
          <div>
            <div style={{color:C.gold,fontSize:12,fontWeight:700}}>🌲 SEQUOIA QUANTUM SYSTEM v1.0</div>
            <div style={{color:C.muted,fontSize:10,marginTop:1}}>DART API · Yahoo Finance(월봉) · 투자 참고용 · 최종판단은 본인책임</div>
          </div>
          <div style={{display:"flex",gap:4}}>
            <Tag color={C.green} size={8}>재무:DART</Tag>
            <Tag color={C.blue}  size={8}>주가:Yahoo월봉</Tag>
            <Tag color={C.gold}  size={8}>엔진:자체계산</Tag>
          </div>
        </div>
      </div>
    </div>
  );
}
