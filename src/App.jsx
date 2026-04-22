import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  ComposedChart, AreaChart, Area, BarChart, Bar, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, ReferenceArea,
} from "recharts";

// ══════════════════════════════════════════════════════════════
// 0. 색상 테마
// ══════════════════════════════════════════════════════════════
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
let C = DARK;

// ══════════════════════════════════════════════════════════════
// 1. 엔진 — 기술적 지표 계산
// ══════════════════════════════════════════════════════════════
const PROXY = "https://api.allorigins.win/raw?url=";

const fetchYahoo = async (ticker, market = "KQ") => {
  try {
    const suffix = market === "KS" ? ".KS" : ".KQ";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}${suffix}?interval=1mo&range=10y`;
    const r = await fetch(PROXY + encodeURIComponent(url));
    const d = await r.json();
    const chart = d?.chart?.result?.[0];
    if (!chart) return null;
    const ts     = chart.timestamp || [];
    const q      = chart.indicators.quote[0];
    const closes = q.close || [];
    const opens  = q.open  || [];
    const highs  = q.high  || [];
    const lows   = q.low   || [];
    const vols   = q.volume|| [];
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
    const currentPrice = Math.round(chart.meta?.regularMarketPrice || closes[closes.length-1] || 0);
    const prevClose    = Math.round(chart.meta?.chartPreviousClose || 0);
    const change       = currentPrice - prevClose;
    const changePct    = prevClose ? +((change/prevClose)*100).toFixed(2) : 0;
    return { monthly, currentPrice, prevClose, change, changePct };
  } catch { return null; }
};

const ema = (arr, n) => {
  const k = 2/(n+1); let e = arr[0];
  return arr.map((v,i) => { if(i===0) return e; e = v*k+e*(1-k); return +e.toFixed(0); });
};

const calcMA60 = (monthly) => {
  const N = 60;
  return monthly.map((d, i) => {
    if (i < N-1) return { ...d, ma60: null, gap60: null };
    const avg = monthly.slice(i-N+1, i+1).reduce((s,x)=>s+x.price,0)/N;
    const gap = +((d.price/avg-1)*100).toFixed(2);
    return { ...d, ma60: +avg.toFixed(0), gap60: gap };
  });
};

const calcMA = (monthly, n) =>
  monthly.map((d,i) => {
    if (i < n-1) return { ...d, [`ma${n}`]: null };
    const avg = monthly.slice(i-n+1,i+1).reduce((s,x)=>s+x.price,0)/n;
    return { ...d, [`ma${n}`]: +avg.toFixed(0) };
  });

const calcRSI = (monthly, n=14) =>
  monthly.map((d,i) => {
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

const calcMACD = (monthly) => {
  const cl  = monthly.map(d=>d.price);
  const e12 = ema(cl,12), e26 = ema(cl,26);
  const macd = cl.map((_,i)=>+(e12[i]-e26[i]));
  const sig  = ema(macd,9);
  const hist = macd.map((m,i)=>+(m-sig[i]));
  return monthly.map((d,i)=>({...d, macd:macd[i], signal:sig[i], hist:hist[i]}));
};

const calcOBV = (monthly) => {
  let obv = 0;
  return monthly.map((d,i) => {
    if(i===0) return {...d, obv:0};
    obv += d.price>monthly[i-1].price ? d.volume
         : d.price<monthly[i-1].price ? -d.volume : 0;
    return { ...d, obv };
  });
};

const calcMFI = (monthly, n=14) =>
  monthly.map((d,i) => {
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

// G1~G4 (무릎·허벅지·어깨·상투) 계산
const calcGBands = (monthly) => {
  const N200 = 200, N60 = 60, N20 = 20;
  return monthly.map((d, i) => {
    // G1 (무릎): 200일 MA → 월봉으로 약 9개월
    const g1 = i >= 8
      ? monthly.slice(Math.max(0,i-8), i+1).reduce((s,x)=>s+x.price,0)/Math.min(9,i+1)
      : null;
    // G2 (허벅지): 60MA 기반 엔벨로프 하단 +10%
    const g2 = i >= 59
      ? monthly.slice(i-59,i+1).reduce((s,x)=>s+x.price,0)/60 * 1.10
      : null;
    // G3 (어깨): 60MA 엔벨로프 상단 +25%
    const g3 = i >= 59
      ? monthly.slice(i-59,i+1).reduce((s,x)=>s+x.price,0)/60 * 1.25
      : null;
    // G4 (상투): 20MA 볼린저 상단 (2σ)
    let g4 = null;
    if(i >= 19){
      const sl   = monthly.slice(i-19,i+1);
      const mean = sl.reduce((s,x)=>s+x.price,0)/20;
      const std  = Math.sqrt(sl.reduce((s,x)=>s+(x.price-mean)**2,0)/20);
      g4 = mean + 2*std;
    }
    return {
      ...d,
      g1: g1 ? Math.round(g1) : null,
      g2: g2 ? Math.round(g2) : null,
      g3: g3 ? Math.round(g3) : null,
      g4: g4 ? Math.round(g4) : null,
    };
  });
};

const buildBands = (monthly, annData) => {
  if(!annData?.length) return monthly;
  const epsMap={}, bpsMap={};
  annData.forEach(r => { epsMap[r.year]=r.eps; bpsMap[r.year]=r.bps; });
  const interp = (year, month, map) => {
    const ys = Object.keys(map).map(Number).sort((a,b)=>a-b);
    let y0=ys.filter(y=>y<=year).slice(-1)[0], y1=ys.filter(y=>y>year)[0];
    if(!y0) y0=ys[0];
    if(!y1) return map[y0]||0;
    const v0=map[y0], v1=map[y1];
    const t=((year-y0)*12+(month-1))/((y1-y0)*12);
    return v0+(v1-v0)*t;
  };
  return monthly.map(d => {
    const eps = interp(d.year,d.month,epsMap);
    const bps = interp(d.year,d.month,bpsMap);
    return {
      ...d,
      perLo:  Math.round(eps*7),
      perHi:  Math.round(eps*20),
      perMid: Math.round(eps*13),
      pbrLo:  Math.round(bps*1.0),
      pbrHi:  Math.round(bps*3.5),
    };
  });
};

const calcDCF = ({fcf,gr,tg,dr,shares}) => {
  let pv=0, cf=fcf;
  for(let y=1;y<=10;y++){ cf*=(1+gr); pv+=cf/Math.pow(1+dr,y); }
  const tvPV=(cf*(1+tg)/(dr-tg))/Math.pow(1+dr,10);
  return { intrinsic: +((pv+tvPV)/shares).toFixed(0) };
};

const calcFScore = (annData) => {
  if(!annData||annData.length<2) return {items:[],total:0};
  const cur=annData[annData.length-1], prv=annData[annData.length-2];
  const items=[
    {name:"ROA > 0",       val:cur.roa>0?1:0,                    desc:"수익성"},
    {name:"ΔROA > 0",      val:(cur.roa-prv.roa)>0?1:0,          desc:"수익 개선"},
    {name:"CFO > 0",       val:cur.cfo>0?1:0,                    desc:"영업현금"},
    {name:"발생액 < 0",    val:(cur.net/cur.assets-cur.cfo/cur.assets)<0?1:0, desc:"이익 질"},
    {name:"레버리지 감소", val:(cur.debt<prv.debt)?1:0,          desc:"재무안정"},
    {name:"유동성 개선",   val:1,                                 desc:"유동성"},
    {name:"주식 미발행",   val:(cur.shares<=prv.shares)?1:0,     desc:"희석 없음"},
    {name:"매출총이익률 ↑",val:(cur.opm>prv.opm)?1:0,            desc:"경쟁력"},
    {name:"자산회전율 ↑",  val:(cur.rev/cur.assets>prv.rev/prv.assets)?1:0, desc:"효율성"},
  ];
  return {items, total:items.reduce((s,x)=>s+x.val,0)};
};

// ══════════════════════════════════════════════════════════════
// 2. 엑셀 파서 — 네이버 복붙 형식 읽기
// ══════════════════════════════════════════════════════════════
const NAVER_FIELD_MAP = {
  "매출액":"rev", "영업이익":"op", "당기순이익":"net",
  "영업이익률":"opm", "순이익률":"npm",
  "자산총계":"assets", "부채총계":"liab", "자본총계":"equity",
  "부채비율":"debt", "자본유보율":"retained",
  "영업활동현금흐름":"cfo", "투자활동현금흐름":"cfi",
  "재무활동현금흐름":"cff", "FCF":"fcf",
  "ROE(%)":"roe", "ROA(%)":"roa",
  "EPS(원)":"eps", "BPS(원)":"bps",
  "PER(배)":"per", "PBR(배)":"pbr",
  "발행주식수(보통주)":"shares",
  // 배당
  "현금DPS(원)":"dps",
  "현금배당수익률":"divYield",
  "현금배당성향(%)":"divPayout",
};

const parseNaverSheet = (sheet) => {
  const rows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:""});
  if(!rows.length) return [];

  // 헤더 행 자동 탐지 — 연도 패턴(2020~2030) 또는 분기 패턴이 있는 행 찾기
  const isYearCell = (v) => {
    const s = String(v||"").trim();
    // "2022/12", "2024/03", "2022년", "22년" 등 다양한 형식
    return /^20[0-9]{2}/.test(s) || /^[0-9]{2}[\/년]/.test(s);
  };

  let headerRowIdx = -1;
  for(let i = 0; i < Math.min(rows.length, 8); i++){
    const row = rows[i];
    const yearCells = row.slice(1).filter(isYearCell);
    if(yearCells.length >= 1){
      headerRowIdx = i;
      break;
    }
  }
  if(headerRowIdx === -1) return [];

  const headerRow = rows[headerRowIdx];
  // A열(index 0)이 항목명 헤더, B열~가 연도/분기
  const periods = headerRow.slice(1)
    .map(h => String(h||"").replace(/\n/g," ").trim())
    .filter(Boolean);
  if(!periods.length) return [];

  // 기간별 객체 초기화
  const result = periods.map(p => ({ period: p }));

  // 헤더 다음 행부터 데이터 읽기
  rows.slice(headerRowIdx + 1).forEach(row => {
    const label = String(row[0]||"").trim();
    const field = NAVER_FIELD_MAP[label];
    if(!field) return;
    periods.forEach((p, i) => {
      const raw = String(row[i+1]||"").replace(/,/g,"").trim();
      const val = raw === "" || raw === "-" || raw === "N/A" ? null : parseFloat(raw);
      result[i][field] = val;
    });
  });

  return result;
};

// 기간 문자열에서 연도 추출 — 다양한 형식 지원
// "2024/12", "2024/12\n(IFRS별도)", "2024년", "24년" 등
const extractYear = (period) => {
  const s = String(period||"").trim();
  // "2024/12..." 형식
  const m1 = s.match(/^(20[0-9]{2})/);
  if(m1) return parseInt(m1[1]);
  // "24년" 형식
  const m2 = s.match(/^([0-9]{2})[년\/]/);
  if(m2) return 2000 + parseInt(m2[1]);
  return 0;
};

// 기간 문자열에서 월 추출
const extractMonth = (period) => {
  const s = String(period||"").trim();
  const m = s.match(/[\/\.\-]([0-9]{1,2})/) ;
  return m ? parseInt(m[1]) : 12;
};

const parseAnnual = (sheet) => {
  const rows = parseNaverSheet(sheet);
  return rows.map(r => {
    const year = extractYear(r.period);
    return { ...r, year };
  }).filter(r => r.year > 0);
};

const parseQuarter = (sheet) => {
  const rows = parseNaverSheet(sheet);
  return rows.map(r => {
    const year    = extractYear(r.period);
    const month   = extractMonth(r.period);
    const quarter = Math.ceil(month/3);
    return { ...r, year, month, quarter, label:`${year}Q${quarter}` };
  }).filter(r => r.year > 0);
};

const parseDividend = (sheet) => {
  const rows = parseNaverSheet(sheet);
  return rows.map(r => {
    const year = extractYear(r.period);
    return { ...r, year };
  }).filter(r => r.year > 0 && r.dps != null);
};

const parseExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, {type:"binary"});
        // 시트명으로 구분
        const findSheet = (keywords) =>
          wb.SheetNames.find(n => keywords.some(k => n.includes(k)));

        const annSheet  = findSheet(["연간","①"]);
        const qtrSheet  = findSheet(["분기","②"]);
        const divSheet  = findSheet(["배당","③"]);

        const annData = annSheet  ? parseAnnual(wb.Sheets[annSheet])    : [];
        const qtrData = qtrSheet  ? parseQuarter(wb.Sheets[qtrSheet])   : [];
        const divData = divSheet  ? parseDividend(wb.Sheets[divSheet])  : [];

        // 파일명에서 종목코드·종목명 추출
        const fname = file.name.replace(".xlsx","").replace(".xls","");
        const match = fname.match(/^(\d{6})_(.+)$/);
        const ticker = match?.[1] || "";
        const name   = match?.[2] || fname;

        resolve({ ticker, name, annData, qtrData, divData });
      } catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
};

// ══════════════════════════════════════════════════════════════
// 3. 공통 UI 컴포넌트
// ══════════════════════════════════════════════════════════════
const Box = ({children, p="12px 14px", mb=12, style={}}) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,
    borderRadius:11,padding:p,marginBottom:mb,...style}}>
    {children}
  </div>
);

const ST = ({children, accent, right}) => (
  <div style={{display:"flex",justifyContent:"space-between",
    alignItems:"center",marginBottom:8,marginTop:4}}>
    <div style={{color:accent,fontSize:12,fontWeight:700,
      letterSpacing:"0.05em",borderLeft:`3px solid ${accent}`,paddingLeft:8}}>
      {children}
    </div>
    {right&&<div style={{color:C.muted,fontSize:10}}>{right}</div>}
  </div>
);

const Tag = ({children,color,size=10}) => (
  <span style={{background:`${color}22`,color,border:`1px solid ${color}44`,
    borderRadius:4,padding:"2px 6px",fontSize:size,fontWeight:700}}>
    {children}
  </span>
);

const CW = ({children, h=200}) => (
  <div style={{marginBottom:16}}>
    <ResponsiveContainer width="100%" height={h}>
      {children}
    </ResponsiveContainer>
  </div>
);

const MonthXTick = ({x,y,payload,data,yearOnly}) => {
  const d = data?.find(m=>m.label===payload.value);
  if(!d) return null;
  if(yearOnly) return (
    <g transform={`translate(${x},${y+4})`}>
      <text textAnchor="middle" fill={C.muted} fontSize={10} fontFamily="monospace">
        {d.year}
      </text>
    </g>
  );
  const isJan = d.month===1;
  return (
    <g transform={`translate(${x},${y+2})`}>
      {isJan&&<text y={0} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={700} fontFamily="monospace">{d.year}</text>}
      <text y={isJan?13:0} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">
        {String(d.month).padStart(2,"0")}
      </text>
    </g>
  );
};

const MTip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,
      borderRadius:8,padding:"8px 11px",fontSize:11,minWidth:130}}>
      <div style={{color:C.gold,fontWeight:700,marginBottom:5,fontFamily:"monospace"}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}>
          <span style={{color:C.muted}}>{p.name}</span>
          <span style={{color:p.color,fontFamily:"monospace",fontWeight:700}}>
            {typeof p.value==="number"?p.value.toLocaleString():p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// 4. 메인 앱
// ══════════════════════════════════════════════════════════════
const LS_KEY = "sequoia_stocks_v2";

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  C = darkMode ? DARK : LIGHT;

  // 종목 목록 (localStorage)
  const [stocks, setStocks]       = useState([]); // [{ticker,name,annData,qtrData,divData}]
  const [activeIdx, setActiveIdx] = useState(0);
  const [tab, setTab]             = useState("overview");
  const [rangeIdx, setRangeIdx]   = useState(0);
  const [monthly, setMonthly]     = useState([]);
  const [priceInfo, setPriceInfo] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dcfP, setDcfP]           = useState({fcf:100,gr:0.10,tg:0.03,dr:0.10});
  const fileRef = useRef();

  const RANGES = [{label:"10년",months:120},{label:"5년",months:60},{label:"3년",months:36},{label:"1년",months:12}];

  // localStorage 복원
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if(saved) {
        const parsed = JSON.parse(saved);
        if(parsed?.length) { setStocks(parsed); setActiveIdx(0); }
      }
    } catch {}
  }, []);

  // localStorage 저장
  useEffect(() => {
    if(stocks.length) localStorage.setItem(LS_KEY, JSON.stringify(stocks));
  }, [stocks]);

  const co = stocks[activeIdx] || null;

  // 종목 변경 시 Yahoo 로드
  useEffect(() => {
    if(!co?.ticker) return;
    setPriceLoading(true);
    setMonthly([]);
    setPriceInfo(null);
    // KOSPI/KOSDAQ 자동 판별 (6자리 코드 기준)
    const market = ["005930","000660","035420","005380","051910"].includes(co.ticker) ? "KS" : "KQ";
    fetchYahoo(co.ticker, market).then(res => {
      if(res?.monthly?.length) {
        setMonthly(res.monthly);
        setPriceInfo(res);
        // DCF 초기값: 연간 FCF 마지막값 사용
        const lastAnn = co.annData?.slice(-1)?.[0];
        if(lastAnn?.fcf) setDcfP(p=>({...p, fcf:lastAnn.fcf}));
      }
      setPriceLoading(false);
    });
  }, [activeIdx, co?.ticker]);

  // 현재 표시 기간 필터
  const latestLabel = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}`;
  }, []);

  const displayMonthly = useMemo(() => {
    return monthly.slice(-RANGES[rangeIdx].months).filter(d=>d.label<=latestLabel);
  }, [monthly, rangeIdx, latestLabel]);

  // 지표 계산
  const withMA60  = useMemo(()=>calcMA60(displayMonthly),[displayMonthly]);
  const withBands = useMemo(()=>buildBands(withMA60, co?.annData),[withMA60, co?.annData]);
  const withG     = useMemo(()=>calcGBands(displayMonthly),[displayMonthly]);
  const withMA5   = useMemo(()=>calcMA(displayMonthly,5),[displayMonthly]);
  const withMA20  = useMemo(()=>calcMA(displayMonthly,20),[displayMonthly]);
  const withRSI   = useMemo(()=>calcRSI(displayMonthly),[displayMonthly]);
  const withMACD  = useMemo(()=>calcMACD(displayMonthly),[displayMonthly]);
  const withOBV   = useMemo(()=>calcOBV(displayMonthly),[displayMonthly]);
  const withMFI   = useMemo(()=>calcMFI(displayMonthly),[displayMonthly]);

  const lastGap   = withMA60.slice(-1)[0]?.gap60 ?? null;
  const fScore    = useMemo(()=>calcFScore(co?.annData),[co?.annData]);
  const dcfShares = co?.annData?.slice(-1)?.[0]?.shares;
  const dcfResult = useMemo(()=>
    dcfShares ? calcDCF({...dcfP, shares:dcfShares/1e8}) : {intrinsic:0}
  ,[dcfP, dcfShares]);

  // 연간+분기 통합 재무 시계열
  const finTimeline = useMemo(() => {
    if(!co) return [];
    const ann = (co.annData||[]).map(r=>({...r, isQuarter:false,
      label:`${r.year}`, period:`${r.year}년`}));
    const qtr = (co.qtrData||[]).map(r=>({...r, isQuarter:true,
      period:`${r.year}Q${r.quarter}`}));
    // 분기 데이터가 있는 연도의 연간 데이터는 제외 (중복 방지)
    const qtrYears = new Set(qtr.map(r=>r.year));
    const filteredAnn = ann.filter(r=>!qtrYears.has(r.year));
    return [...filteredAnn, ...qtr].sort((a,b)=>
      (a.year*10+(a.quarter||0)) - (b.year*10+(b.quarter||0))
    );
  }, [co?.annData, co?.qtrData]);

  // 스코어
  const lastAnn = co?.annData?.slice(-1)?.[0] || {};
  const scores = useMemo(()=>({
    fin:   Math.min(100,Math.max(0,Math.round(95-(lastAnn.debt||0)*1.5))),
    growth:Math.min(100,Math.max(0,Math.round(65+(lastAnn.roe||0)))),
    stable:Math.min(100,Math.max(0,Math.round(95-(lastAnn.debt||0)*2))),
    value: Math.min(100,Math.max(0,Math.round(100-((priceInfo?.currentPrice||0)/(dcfResult.intrinsic||1)-1)*80))),
    mom:   Math.min(100,Math.max(0,Math.round(50+(lastGap||0)/4))),
    supply:65,
  }),[lastAnn, priceInfo, dcfResult, lastGap]);

  // 엑셀 업로드
  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if(!files.length) return;
    setUploading(true);
    try {
      const results = await Promise.all(files.map(parseExcel));
      setStocks(prev => {
        const merged = [...prev];
        results.forEach(res => {
          const idx = merged.findIndex(s=>s.ticker===res.ticker);
          if(idx>=0) merged[idx] = res;
          else merged.push(res);
        });
        return merged;
      });
      // 새로 추가된 첫 종목 선택
      if(!stocks.length) setActiveIdx(0);
    } catch(err) {
      alert("엑셀 파일 읽기 실패: " + err.message);
    }
    setUploading(false);
    e.target.value = "";
  };

  const removeStock = (idx) => {
    setStocks(prev => prev.filter((_,i)=>i!==idx));
    setActiveIdx(0);
    if(stocks.length <= 1) localStorage.removeItem(LS_KEY);
  };

  const xp = (data, forceYearOnly=false) => ({
    dataKey:"label", height: (forceYearOnly||rangeIdx===0) ? 20 : 32,
    tick:<MonthXTick data={data} yearOnly={forceYearOnly||rangeIdx===0}/>,
    tickLine:false, axisLine:{stroke:C.border}, interval:0,
  });
  const yp = (unit="",w=44) => ({
    tick:{fill:C.muted,fontSize:11}, tickLine:false,
    axisLine:false, unit, width:w,
  });

  const TABS = [
    {id:"overview",   label:"📊 종합"},
    {id:"price60",    label:"📈 주가·60MA"},
    {id:"perbpr",     label:"💹 PER/PBR"},
    {id:"financial",  label:"💰 재무"},
    {id:"technical",  label:"🧮 기술분석"},
    {id:"valuation",  label:"💎 가치평가"},
    {id:"stability",  label:"🛡 안정성"},
    {id:"dividend",   label:"💸 배당"},
    {id:"masters",    label:"👑 9인의 거장"},
  ];

  const price   = priceInfo?.currentPrice || 0;
  const change  = priceInfo?.change || 0;
  const chgPct  = priceInfo?.changePct || 0;
  const ma60val = withMA60.slice(-1)[0]?.ma60 || 0;
  const per     = lastAnn.per || (lastAnn.eps ? Math.round(price/lastAnn.eps*10)/10 : 0);
  const pbr     = lastAnn.pbr || (lastAnn.bps ? Math.round(price/lastAnn.bps*100)/100 : 0);

  // ── 9인의 거장 판정
  const masterJudge = useMemo(()=>{
    if(!co||!price) return [];
    const last = co.annData?.slice(-1)?.[0]||{};
    const prev = co.annData?.slice(-2,-1)?.[0]||{};
    const opm  = last.opm||0, prevOpm=prev.opm||0;
    const roe  = last.roe||0;
    const rev  = last.rev||0, prevRev=prev.rev||0;
    const revGrowth = prevRev ? Math.round((rev-prevRev)/prevRev*100) : 0;
    const eps  = last.eps||0, prevEps=prev.eps||0;
    const epsGrowth = prevEps ? Math.round((eps-prevEps)/prevEps*100) : 0;
    const bps  = last.bps||0;
    const fcf  = last.fcf||0;
    const debt = last.debt||0;
    const mktCap = price*(last.shares||0)/1e8;
    const netCash= Math.round((last.assets||0)-(last.liab||0));
    const roic = Math.round(opm*(rev/last.assets||0));
    const avgRoe3 = (co.annData?.slice(-3)||[]).reduce((s,r)=>s+(r.roe||0),0)/3;
    const grahamFair = Math.round(Math.sqrt(22.5*eps*bps));
    const ttmEps = (co.qtrData?.slice(-4)||[]).reduce((s,r)=>s+(r.eps||0),0) || eps;
    const ttmPer = ttmEps ? Math.round(price/ttmEps*10)/10 : per;
    const peg = epsGrowth>0 ? Math.round(ttmPer/epsGrowth*10)/10 : 99;
    const divYield = co.divData?.slice(-1)?.[0]?.divYield||0;
    const neffRatio = ttmPer>0 ? Math.round((divYield+epsGrowth)/ttmPer*10)/10 : 0;
    const qtrEps = co.qtrData?.slice(-1)?.[0]?.eps||0;
    const prevQtrEps = co.qtrData?.slice(-5,-4)?.[0]?.eps||0;
    const qEpsGrowth = prevQtrEps ? Math.round((qtrEps-prevQtrEps)/Math.abs(prevQtrEps)*100) : 0;

    const judge = (good,bad,reason) => ({
      verdict: good?"추천":bad?"비추천":"중립",
      color:   good?C.green:bad?C.red:C.gold,
      icon:    good?"✅":bad?"❌":"⚖️",
      reason,
    });

    return [
      { name:"Benjamin Graham", ko:"벤저민 그레이엄", style:"안전마진·자산가치",
        calc:judge(pbr<1.5&&ttmPer<15&&debt<50,pbr>2.5||ttmPer>25,
          `PBR ${pbr}배 | TTM PER ${ttmPer}배 | 부채비율 ${debt}%`),
        detail:[{k:"PBR",v:`${pbr}배`},{k:"PER(TTM)",v:`${ttmPer}배`},{k:"부채비율",v:`${debt}%`}]},
      { name:"Warren Buffett", ko:"워런 버핏", style:"ROE·경제적 해자",
        calc:judge(avgRoe3>=15&&debt<50&&opm>=15,avgRoe3<10||opm<5,
          `3년평균ROE ${avgRoe3.toFixed(1)}% | OPM ${opm}% | 부채비율 ${debt}%`),
        detail:[{k:"3년평균ROE",v:`${avgRoe3.toFixed(1)}%`},{k:"OPM",v:`${opm}%`},{k:"부채비율",v:`${debt}%`}]},
      { name:"Peter Lynch", ko:"피터 린치", style:"PEG·성장가치",
        calc:judge(peg!==99&&peg<1.5,peg>2.5||epsGrowth<0,
          `PEG ${peg===99?"N/A":peg} | PER ${ttmPer}배 | EPS성장 ${epsGrowth}%`),
        detail:[{k:"PEG",v:peg===99?"N/A":peg},{k:"PER",v:`${ttmPer}배`},{k:"EPS성장",v:`${epsGrowth}%`}]},
      { name:"Philip Fisher", ko:"필립 피셔", style:"탁월한 경영·성장",
        calc:judge(opm>=15&&opm>prevOpm&&revGrowth>10,opm<8||revGrowth<0,
          `OPM ${opm}% (전년 ${prevOpm}%) | 매출성장 ${revGrowth}%`),
        detail:[{k:"OPM",v:`${opm}%`},{k:"전년OPM",v:`${prevOpm}%`},{k:"매출YoY",v:`${revGrowth}%`}]},
      { name:"Charlie Munger", ko:"찰리 멍거", style:"ROIC·독점적 해자",
        calc:judge(roic>=15&&debt<30,roic<8||debt>80,
          `추정ROIC ${roic}% | 부채비율 ${debt}%`),
        detail:[{k:"추정ROIC",v:`${roic}%`},{k:"부채비율",v:`${debt}%`},{k:"OPM",v:`${opm}%`}]},
      { name:"Mohnish Pabrai", ko:"모니시 파브라이", style:"하방제한·턴어라운드",
        calc:judge(pbr<1.5&&fcf>0&&revGrowth>0,pbr>3.0||fcf<0,
          `PBR ${pbr}배 | FCF ${fcf}억 | 매출성장 ${revGrowth}%`),
        detail:[{k:"PBR",v:`${pbr}배`},{k:"FCF",v:`${fcf}억`},{k:"매출YoY",v:`${revGrowth}%`}]},
      { name:"John Neff", ko:"존 네프", style:"저PER·배당+성장",
        calc:judge(ttmPer<15&&neffRatio>=2,ttmPer>20||neffRatio<1,
          `(배당${divYield}%+EPS성장${epsGrowth}%)/PER${ttmPer}배 = ${neffRatio}`),
        detail:[{k:"PER",v:`${ttmPer}배`},{k:"Neff Ratio",v:neffRatio},{k:"EPS성장",v:`${epsGrowth}%`}]},
      { name:"William O'Neil", ko:"윌리엄 오닐", style:"CAN-SLIM·기술+펀더멘털",
        calc:judge(price>ma60val&&qEpsGrowth>=20,price<ma60val*0.9||qEpsGrowth<0,
          `현재가 vs 60MA ${price>ma60val?"위":"아래"} | 분기EPS YoY ${qEpsGrowth}%`),
        detail:[{k:"현재가vs60MA",v:price>ma60val?"위":"아래"},{k:"분기EPSYoY",v:`${qEpsGrowth}%`}]},
      { name:"Seth Klarman", ko:"세스 클라만", style:"극단적 안전마진·자산",
        calc:judge(netCash>mktCap*0.5||pbr<1.0,pbr>2.5&&netCash<mktCap*0.2,
          `추정순현금 ${netCash}억 | 시총 ${Math.round(mktCap)}억 | PBR ${pbr}배`),
        detail:[{k:"추정순현금",v:`${netCash}억`},{k:"시총",v:`${Math.round(mktCap)}억`},{k:"PBR",v:`${pbr}배`}]},
    ];
  },[co, price, per, pbr, ma60val, lastAnn, priceInfo]);

  // ── 빈 상태
  if(!stocks.length) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",gap:24,padding:24}}>
      <div style={{color:C.gold,fontSize:28,fontWeight:900,letterSpacing:"0.05em",fontFamily:"monospace"}}>
        🌲 SEQUOIA QUANTUM™
      </div>
      <div style={{color:C.muted,fontSize:14,textAlign:"center",lineHeight:1.8}}>
        엑셀 서식에 네이버 재무제표를 붙여넣고 업로드하면<br/>
        종목이 자동으로 추가됩니다.
      </div>
      <button onClick={()=>fileRef.current?.click()} style={{
        background:`linear-gradient(135deg,${C.blue},${C.blueL})`,
        color:"#fff",border:"none",borderRadius:12,
        padding:"14px 32px",fontSize:15,fontWeight:700,cursor:"pointer",
        boxShadow:`0 4px 20px ${C.blue}44`,
      }}>
        📂 엑셀 파일 업로드
      </button>
      <div style={{color:C.muted,fontSize:11}}>
        파일명 형식: 179290_엠아이텍.xlsx
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple
        style={{display:"none"}} onChange={handleUpload}/>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,
      fontSize:13,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>

      {/* ── 헤더 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
        padding:"10px 16px",display:"flex",alignItems:"center",
        gap:10,position:"sticky",top:0,zIndex:100}}>

        {/* 로고 */}
        <div style={{color:C.gold,fontSize:16,fontWeight:900,
          letterSpacing:"0.05em",fontFamily:"monospace",flexShrink:0}}>
          🌲 SEQUOIA
        </div>

        {/* 종목 드롭다운 */}
        <div style={{position:"relative",flex:1,maxWidth:320}}>
          <select
            value={activeIdx}
            onChange={e=>{setActiveIdx(+e.target.value);setTab("overview");}}
            style={{
              width:"100%",
              background:C.card2,
              color:C.text,
              border:`1px solid ${C.blue}`,
              borderRadius:8,
              padding:"7px 32px 7px 12px",
              fontSize:13,
              fontWeight:700,
              fontFamily:"monospace",
              cursor:"pointer",
              appearance:"none",
              WebkitAppearance:"none",
              outline:"none",
            }}>
            {stocks.map((s,i)=>(
              <option key={i} value={i}>
                {s.name}　{s.ticker}
              </option>
            ))}
          </select>
          {/* 드롭다운 화살표 */}
          <div style={{position:"absolute",right:10,top:"50%",
            transform:"translateY(-50%)",pointerEvents:"none",
            color:C.blue,fontSize:12}}>▼</div>
        </div>

        {/* 종목 수 배지 */}
        <div style={{background:`${C.blue}22`,color:C.blue,
          border:`1px solid ${C.blue}44`,borderRadius:6,
          padding:"4px 8px",fontSize:11,fontFamily:"monospace",
          flexShrink:0,whiteSpace:"nowrap"}}>
          {stocks.length}종목
        </div>

        {/* 우측 버튼들 */}
        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0,marginLeft:"auto"}}>
          <button onClick={()=>fileRef.current?.click()} disabled={uploading}
            style={{background:C.blue,color:"#fff",border:"none",
              borderRadius:7,padding:"7px 14px",fontSize:12,
              cursor:"pointer",fontWeight:700,whiteSpace:"nowrap"}}>
            {uploading?"처리중...":"📂 종목 추가"}
          </button>
          <button onClick={()=>setDarkMode(d=>!d)}
            style={{background:"transparent",color:C.muted,
              border:`1px solid ${C.border}`,borderRadius:7,
              padding:"7px 10px",fontSize:14,cursor:"pointer"}}>
            {darkMode?"☀️":"🌙"}
          </button>
          <button onClick={()=>removeStock(activeIdx)}
            title="현재 종목 삭제"
            style={{background:"transparent",color:C.red,
              border:`1px solid ${C.red}44`,borderRadius:7,
              padding:"7px 10px",fontSize:12,cursor:"pointer"}}>
            🗑
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple
          style={{display:"none"}} onChange={handleUpload}/>
      </div>

      {/* ── 종목 헤더 */}
      <div style={{background:`linear-gradient(135deg,${C.card2},${C.card})`,
        borderBottom:`1px solid ${C.border}`,padding:"12px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:18,fontWeight:900,color:C.text}}>{co?.name}</div>
            <div style={{color:C.muted,fontSize:11,marginTop:2}}>
              {co?.ticker} · 월봉 15~20분 지연
            </div>
          </div>
          {priceLoading ? (
            <div style={{color:C.muted,fontSize:12}}>주가 로딩 중...</div>
          ) : price>0 ? (
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <div style={{fontSize:26,fontWeight:900,color:C.text,fontFamily:"monospace"}}>
                {price.toLocaleString()}원
              </div>
              <div style={{fontSize:13,color:change>=0?C.green:C.red,fontWeight:700}}>
                {change>=0?"+":""}{change.toLocaleString()} ({chgPct>=0?"+":""}{chgPct}%)
              </div>
            </div>
          ) : (
            <div style={{color:C.muted,fontSize:12}}>주가 로드 실패</div>
          )}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginLeft:"auto"}}>
            {[
              {label:"PER",  value:per?`${per}배`:"—",  color:C.gold},
              {label:"PBR",  value:pbr?`${pbr}배`:"—",  color:C.gold},
              {label:"60MA 이격도", value:lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"—",
                color:lastGap>20?C.red:lastGap<-20?C.green:C.muted},
              {label:"DCF",  value:dcfResult.intrinsic?`${dcfResult.intrinsic.toLocaleString()}원`:"—", color:C.blueL},
            ].map(k=>(
              <div key={k.label} style={{textAlign:"center",background:C.bg,
                borderRadius:8,padding:"6px 10px",minWidth:60}}>
                <div style={{color:C.muted,fontSize:9,marginBottom:2}}>{k.label}</div>
                <div style={{color:k.color,fontSize:13,fontWeight:700,fontFamily:"monospace"}}>
                  {k.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 탭 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
        padding:"8px 16px",display:"flex",gap:4,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{background:tab===t.id?C.blue:"transparent",
              color:tab===t.id?"#fff":C.muted,
              border:`1px solid ${tab===t.id?C.blue:C.border}`,
              borderRadius:7,padding:"6px 12px",fontSize:12,
              cursor:"pointer",whiteSpace:"nowrap",fontWeight:tab===t.id?700:400}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 기간 선택 (주가 탭용) */}
      {["price60","perbpr","technical"].includes(tab)&&(
        <div style={{background:C.card2,borderBottom:`1px solid ${C.border}`,
          padding:"6px 16px",display:"flex",gap:4}}>
          {RANGES.map((r,i)=>(
            <button key={i} onClick={()=>setRangeIdx(i)}
              style={{background:i===rangeIdx?`${C.blue}22`:"transparent",
                color:i===rangeIdx?C.blue:C.muted,
                border:`1px solid ${i===rangeIdx?C.blue:C.border}`,
                borderRadius:5,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* ── 콘텐츠 */}
      <div style={{padding:"14px 16px",maxWidth:900,margin:"0 auto"}}>

        {/* ════ TAB: 종합 ════ */}
        {tab==="overview"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* 레이더 스코어 */}
            <Box>
              <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{width:130,height:130,flexShrink:0}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={[
                      {s:"재무건전성",v:scores.fin},{s:"성장성",v:scores.growth},
                      {s:"안정성",v:scores.stable},{s:"밸류",v:scores.value},
                      {s:"모멘텀",v:scores.mom},{s:"수급",v:scores.supply},
                    ]}>
                      <PolarGrid stroke={C.border}/>
                      <PolarAngleAxis dataKey="s" tick={{fill:C.muted,fontSize:9}}/>
                      <Radar dataKey="v" stroke={C.gold} fill={C.gold} fillOpacity={0.2} strokeWidth={2}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{flex:1}}>
                  <div style={{color:C.muted,fontSize:10,marginBottom:2}}>종합 투자 스코어</div>
                  <div style={{fontSize:36,fontWeight:900,color:C.gold,fontFamily:"monospace"}}>
                    {Math.round(Object.values(scores).reduce((s,v)=>s+v,0)/6)}
                  </div>
                  <div style={{color:C.muted,fontSize:10}}>/100점</div>
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:3}}>
                    {Object.entries({
                      "재무건전성":scores.fin,"성장성":scores.growth,
                      "안정성":scores.stable,"밸류":scores.value,
                      "모멘텀":scores.mom,"수급":scores.supply,
                    }).map(([k,v])=>(
                      <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                        <div style={{width:54,fontSize:10,color:C.muted,flexShrink:0}}>{k}</div>
                        <div style={{flex:1,height:3,background:C.border,borderRadius:2}}>
                          <div style={{width:`${v}%`,height:"100%",
                            background:v>=80?C.green:v>=60?C.gold:C.red,borderRadius:2}}/>
                        </div>
                        <div style={{width:24,fontSize:10,color:C.text,
                          textAlign:"right",fontFamily:"monospace"}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Box>

            {/* 재무 요약 */}
            {lastAnn.rev&&(
              <Box>
                <ST accent={C.gold}>최근 연간 재무 요약 ({lastAnn.year}년)</ST>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8}}>
                  {[
                    {k:"매출액",v:`${lastAnn.rev}억`,c:C.text},
                    {k:"영업이익",v:`${lastAnn.op}억`,c:C.green},
                    {k:"당기순이익",v:`${lastAnn.net}억`,c:C.green},
                    {k:"영업이익률",v:`${lastAnn.opm}%`,c:C.gold},
                    {k:"ROE",v:`${lastAnn.roe}%`,c:C.blueL},
                    {k:"부채비율",v:`${lastAnn.debt}%`,c:lastAnn.debt>100?C.red:C.teal},
                    {k:"FCF",v:`${lastAnn.fcf}억`,c:C.cyan},
                    {k:"EPS",v:`${(lastAnn.eps||0).toLocaleString()}원`,c:C.purple},
                  ].map(item=>(
                    <div key={item.k} style={{background:C.card2,borderRadius:9,
                      padding:"10px 12px",border:`1px solid ${C.border}`}}>
                      <div style={{color:C.muted,fontSize:10,marginBottom:3}}>{item.k}</div>
                      <div style={{color:item.c,fontSize:14,fontWeight:700,fontFamily:"monospace"}}>
                        {item.v}
                      </div>
                    </div>
                  ))}
                </div>
              </Box>
            )}

            {/* 데이터 없을 때 */}
            {!lastAnn.rev&&(
              <Box>
                <div style={{color:C.muted,textAlign:"center",padding:"20px 0",fontSize:13}}>
                  📂 엑셀 파일을 업로드하면 재무 데이터가 표시됩니다.<br/>
                  <span style={{fontSize:11,marginTop:6,display:"block"}}>
                    주가 데이터(Yahoo Finance)는 자동으로 로드됩니다.
                  </span>
                </div>
              </Box>
            )}
          </div>
        )}

        {/* ════ TAB: 주가·60MA ════ */}
        {tab==="price60"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <ST accent={C.blue} right="Yahoo Finance 월봉">주가 & 60월 이동평균선</ST>
            <CW h={320}>
              <ComposedChart data={withMA60} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(displayMonthly)}/>
                <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>}/>
                <Legend wrapperStyle={{fontSize:11,color:C.muted}}/>
                <Area dataKey="price" name="주가" stroke={C.blue} strokeWidth={2}
                  fill={`${C.blue}18`} dot={false}/>
                <Line dataKey="ma60" name="60MA" stroke={C.gold} strokeWidth={2}
                  dot={false} strokeDasharray="5 3"/>
                {lastGap!==null&&(
                  <ReferenceLine y={ma60val} stroke={C.gold} strokeDasharray="3 3"
                    label={{value:`60MA ${ma60val.toLocaleString()}원`,
                      fill:C.gold,fontSize:10,position:"insideTopRight"}}/>
                )}
              </ComposedChart>
            </CW>
            <ST accent={C.teal} right="60MA 대비 이격도">이격도 (%)</ST>
            <CW h={180}>
              <ComposedChart data={withMA60} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(displayMonthly)}/>
                <YAxis {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={20} y2={100} fill={`${C.red}08`}/>
                <ReferenceArea y1={-100} y2={-20} fill={`${C.green}08`}/>
                <ReferenceLine y={20}  stroke={C.red}   strokeDasharray="4 2" label={{value:"과열+20%",fill:C.red,  fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={0}   stroke={C.dim}   strokeDasharray="2 2"/>
                <ReferenceLine y={-20} stroke={C.green} strokeDasharray="4 2" label={{value:"저평가-20%",fill:C.green,fontSize:9,position:"insideTopRight"}}/>
                <Bar dataKey="gap60" name="이격도(%)" maxBarSize={8}
                  fill={C.teal} radius={[2,2,0,0]}
                  label={false}/>
              </ComposedChart>
            </CW>
          </div>
        )}

        {/* ════ TAB: PER/PBR ════ */}
        {tab==="perbpr"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {co?.annData?.length ? (
              <>
                <ST accent={C.purple} right="연간 EPS 보간 기반 밴드">PER 밴드 (7배~20배)</ST>
                <CW h={290}>
                  <ComposedChart data={withBands} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(displayMonthly)}/>
                    <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>}/>
                    <Area dataKey="perHi"  name="PER 20배" stroke={C.red}    fill={`${C.red}10`}    strokeWidth={1} dot={false}/>
                    <Area dataKey="perMid" name="PER 13배" stroke={C.gold}   fill={`${C.gold}08`}   strokeWidth={1} dot={false}/>
                    <Area dataKey="perLo"  name="PER 7배"  stroke={C.green}  fill={`${C.green}10`}  strokeWidth={1} dot={false}/>
                    <Line dataKey="price"  name="주가"     stroke={C.blueL}  strokeWidth={2.5}      dot={false}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.cyan} right="연간 BPS 보간 기반 밴드">PBR 밴드 (1배~3.5배)</ST>
                <CW h={260}>
                  <ComposedChart data={withBands} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(displayMonthly)}/>
                    <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>}/>
                    <Area dataKey="pbrHi" name="PBR 3.5배" stroke={C.red}   fill={`${C.red}10`}   strokeWidth={1} dot={false}/>
                    <Area dataKey="pbrLo" name="PBR 1배"   stroke={C.green} fill={`${C.green}10`} strokeWidth={1} dot={false}/>
                    <Line dataKey="price" name="주가"       stroke={C.blueL} strokeWidth={2.5}    dot={false}/>
                  </ComposedChart>
                </CW>
              </>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>
                재무 데이터(EPS/BPS)를 엑셀로 업로드하면 밴드 차트가 표시됩니다.
              </div></Box>
            )}
          </div>
        )}

        {/* ════ TAB: 재무 ════ */}
        {tab==="financial"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {finTimeline.length ? (
              <>
                <ST accent={C.green} right="연간+분기 통합 (분기 우선)">매출·영업이익·순이익 (억원)</ST>
                <CW h={260}>
                  <ComposedChart data={finTimeline} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="period" tick={{fill:C.muted,fontSize:9}} tickLine={false}
                      axisLine={{stroke:C.border}} interval={0} height={28}/>
                    <YAxis {...yp("억")} />
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="rev" name="매출액"   fill={C.blue}   opacity={0.7} maxBarSize={20}/>
                    <Bar dataKey="op"  name="영업이익" fill={C.green}  opacity={0.8} maxBarSize={20}/>
                    <Bar dataKey="net" name="순이익"   fill={C.purple} opacity={0.7} maxBarSize={20}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.gold} right="%">영업이익률 · ROE · ROA</ST>
                <CW h={220}>
                  <ComposedChart data={finTimeline} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="period" tick={{fill:C.muted,fontSize:9}} tickLine={false}
                      axisLine={{stroke:C.border}} interval={0} height={28}/>
                    <YAxis {...yp("%")}/>
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Line dataKey="opm" name="영업이익률%" stroke={C.gold}   strokeWidth={2} dot={{r:3}}/>
                    <Line dataKey="roe" name="ROE%"       stroke={C.green}  strokeWidth={2} dot={{r:3}}/>
                    <Line dataKey="roa" name="ROA%"       stroke={C.blueL}  strokeWidth={2} dot={{r:3}}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.cyan} right="억원">현금흐름 (영업·투자·FCF)</ST>
                <CW h={220}>
                  <ComposedChart data={finTimeline} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="period" tick={{fill:C.muted,fontSize:9}} tickLine={false}
                      axisLine={{stroke:C.border}} interval={0} height={28}/>
                    <YAxis {...yp("억")}/>
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="cfo" name="영업CF"  fill={C.teal}   opacity={0.8} maxBarSize={20}/>
                    <Bar dataKey="cfi" name="투자CF"  fill={C.red}    opacity={0.6} maxBarSize={20}/>
                    <Line dataKey="fcf" name="FCF"    stroke={C.gold} strokeWidth={2.5} dot={{r:3}}/>
                  </ComposedChart>
                </CW>
              </>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>
                엑셀 파일을 업로드하면 재무 차트가 표시됩니다.
              </div></Box>
            )}
          </div>
        )}

        {/* ════ TAB: 기술분석 ════ */}
        {tab==="technical"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* G1~G4 */}
            <div style={{background:`${C.teal}11`,border:`1px solid ${C.teal}33`,
              borderRadius:9,padding:"9px 13px",marginBottom:10,fontSize:11,color:C.muted,lineHeight:1.7}}>
              <span style={{color:C.teal,fontWeight:700}}>📊 G-Band 설명</span>　
              <span style={{color:C.green,fontWeight:700}}>G1 무릎</span> 200일 MA (월봉 9개월) /
              <span style={{color:C.blueL,fontWeight:700}}> G2 허벅지</span> 60MA+10% 엔벨로프 /
              <span style={{color:C.orange,fontWeight:700}}> G3 어깨</span> 60MA+25% 엔벨로프 /
              <span style={{color:C.red,fontWeight:700}}> G4 상투</span> 20MA 볼린저 상단(2σ)
            </div>
            <ST accent={C.gold} right="월봉 기준">G1·G2·G3·G4 밴드</ST>
            <CW h={300}>
              <ComposedChart data={withG} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(displayMonthly)}/>
                <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>}/>
                <Legend wrapperStyle={{fontSize:10,color:C.muted}}/>
                <Line dataKey="price" name="주가"   stroke={C.blue}   strokeWidth={2.5} dot={false}/>
                <Line dataKey="g1"    name="G1 무릎" stroke={C.green}  strokeWidth={1.5} dot={false} strokeDasharray="4 2"/>
                <Line dataKey="g2"    name="G2 허벅지" stroke={C.blueL} strokeWidth={1.5} dot={false} strokeDasharray="3 2"/>
                <Line dataKey="g3"    name="G3 어깨" stroke={C.orange} strokeWidth={1.5} dot={false} strokeDasharray="3 2"/>
                <Line dataKey="g4"    name="G4 상투" stroke={C.red}    strokeWidth={1.5} dot={false} strokeDasharray="2 2"/>
              </ComposedChart>
            </CW>

            <ST accent={C.green} right="월봉 기준">RSI (14개월)</ST>
            <CW h={180}>
              <ComposedChart data={withRSI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(displayMonthly)}/>
                <YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={70} y2={100} fill={`${C.red}12`}/>
                <ReferenceArea y1={0}  y2={30}  fill={`${C.green}12`}/>
                <ReferenceLine y={70} stroke={C.red}   strokeDasharray="4 2" label={{value:"과매수70",fill:C.red,  fontSize:10}}/>
                <ReferenceLine y={30} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도30",fill:C.green,fontSize:10}}/>
                <Area dataKey="rsi" name="RSI(%)" stroke={C.green} strokeWidth={2}
                  fill={`${C.green}18`} dot={false}/>
              </ComposedChart>
            </CW>

            <ST accent={C.blueL} right="월봉 기준">MACD (12·26·9)</ST>
            <CW h={185}>
              <ComposedChart data={withMACD} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(displayMonthly)}/>
                <YAxis {...yp("",38)}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceLine y={0} stroke={C.dim}/>
                <Bar dataKey="hist" name="히스토그램" maxBarSize={6} radius={[2,2,0,0]}
                  fill={C.blueL} fillOpacity={0.65}/>
                <Line dataKey="macd"   name="MACD"   stroke={C.blueL}  strokeWidth={2}   dot={false}/>
                <Line dataKey="signal" name="Signal" stroke={C.orange} strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </CW>

            <ST accent={C.teal} right="Yahoo 거래량 기반 누적">OBV</ST>
            <CW h={160}>
              <AreaChart data={withOBV} margin={{top:4,right:10,left:0,bottom:8}}>
                <defs><linearGradient id="obvG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.teal} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.teal} stopOpacity={0}/>
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(displayMonthly)}/>
                <YAxis {...yp("",44)} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/>
                <Tooltip content={<MTip/>}/>
                <Area dataKey="obv" name="OBV" stroke={C.teal} strokeWidth={2}
                  fill="url(#obvG)" dot={false}/>
              </AreaChart>
            </CW>

            <ST accent={C.pink} right="거래량 가중 RSI">MFI</ST>
            <CW h={160}>
              <ComposedChart data={withMFI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(displayMonthly)}/>
                <YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={80} y2={100} fill={`${C.red}12`}/>
                <ReferenceArea y1={0}  y2={20}  fill={`${C.green}12`}/>
                <ReferenceLine y={80} stroke={C.red}   strokeDasharray="4 2" label={{value:"과열80",  fill:C.red,  fontSize:10}}/>
                <ReferenceLine y={20} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도20",fill:C.green,fontSize:10}}/>
                <Area dataKey="mfi" name="MFI(%)" stroke={C.pink} strokeWidth={2}
                  fill={`${C.pink}18`} dot={false}/>
              </ComposedChart>
            </CW>
          </div>
        )}

        {/* ════ TAB: 가치평가 ════ */}
        {tab==="valuation"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <Box style={{border:`2px solid ${dcfResult.intrinsic>price?C.green:C.red}44`}}>
              <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
                <div>
                  <div style={{color:C.muted,fontSize:10,marginBottom:4}}>
                    DCF 내재가치 · FCF {dcfP.fcf}억 · 성장률 {(dcfP.gr*100).toFixed(0)}% · 할인율 {(dcfP.dr*100).toFixed(0)}%
                  </div>
                  <div style={{fontSize:28,fontWeight:900,color:C.gold,fontFamily:"monospace"}}>
                    {dcfResult.intrinsic?.toLocaleString()}원
                  </div>
                  <Tag color={dcfResult.intrinsic>price?C.green:C.red} size={11}>
                    {dcfResult.intrinsic>price?"저평가":"고평가"} {price?Math.abs(Math.round((dcfResult.intrinsic/price-1)*100)):0}%
                  </Tag>
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[
                    {k:"현재 시가총액",v:`${Math.round(price*(lastAnn.shares||0)/1e8).toLocaleString()}억`,c:C.text},
                    {k:"내재가치 시총",v:`${Math.round(dcfResult.intrinsic*(lastAnn.shares||0)/1e8).toLocaleString()}억`,c:C.gold},
                  ].map(item=>(
                    <div key={item.k} style={{background:C.bg,borderRadius:9,padding:"8px 12px",minWidth:80,textAlign:"center"}}>
                      <div style={{color:C.muted,fontSize:10,marginBottom:2}}>{item.k}</div>
                      <div style={{color:item.c,fontSize:14,fontWeight:700,fontFamily:"monospace"}}>{item.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Box>

            <Box>
              <ST accent={C.gold}>DCF 시나리오 계산기</ST>
              <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14}}>
                {[
                  {key:"fcf",label:"FCF (억)",step:10,max:2000,fmt:v=>`${v}억`},
                  {key:"gr", label:"성장률",  step:0.01,max:0.5,fmt:v=>`${(v*100).toFixed(0)}%`},
                  {key:"tg", label:"영구성장률",step:0.005,max:0.1,fmt:v=>`${(v*100).toFixed(1)}%`},
                  {key:"dr", label:"할인율",  step:0.005,max:0.3,fmt:v=>`${(v*100).toFixed(1)}%`},
                ].map(f=>(
                  <div key={f.key} style={{flex:"1 1 140px"}}>
                    <div style={{color:C.muted,fontSize:11,marginBottom:3}}>{f.label}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <input type="range" min={0} max={f.max} step={f.step} value={dcfP[f.key]}
                        onChange={e=>setDcfP(p=>({...p,[f.key]:+e.target.value}))}
                        style={{flex:1}}/>
                      <span style={{color:C.gold,fontSize:12,fontFamily:"monospace",minWidth:40,textAlign:"right"}}>
                        {f.fmt(dcfP[f.key])}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{color:C.gold,fontSize:22,fontWeight:900,fontFamily:"monospace",textAlign:"center"}}>
                {dcfResult.intrinsic?.toLocaleString()}원
              </div>
            </Box>

            {/* F-Score */}
            <Box>
              <ST accent={C.green}>F-Score (피오트로스키)</ST>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <div style={{textAlign:"center",flexShrink:0}}>
                  <div style={{fontSize:44,fontWeight:900,fontFamily:"monospace",lineHeight:1,
                    color:fScore.total>=7?C.green:fScore.total>=4?C.gold:C.red}}>
                    {fScore.total}
                  </div>
                  <div style={{color:C.muted,fontSize:10}}>/9점</div>
                  <Tag color={fScore.total>=7?C.green:fScore.total>=4?C.gold:C.red}>
                    {fScore.total>=7?"강력매수":fScore.total>=4?"중립":"주의"}
                  </Tag>
                </div>
                {fScore.items.length ? (
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
                    {fScore.items.map((s,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
                        <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,
                          background:s.val?C.green:C.red}}/>
                        <span style={{color:s.val?C.text:C.muted,fontSize:12,flex:1}}>{s.name}</span>
                        <span style={{color:C.muted,fontSize:10}}>{s.desc}</span>
                      </div>
                    ))}
                  </div>
                ):(
                  <div style={{color:C.muted,fontSize:12}}>재무 데이터가 2년치 이상 필요합니다.</div>
                )}
              </div>
            </Box>
          </div>
        )}

        {/* ════ TAB: 안정성 ════ */}
        {tab==="stability"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {finTimeline.length ? (
              <>
                <ST accent={C.teal}>부채비율 · 자본유보율 추이</ST>
                <CW h={230}>
                  <ComposedChart data={finTimeline} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="period" tick={{fill:C.muted,fontSize:9}} tickLine={false}
                      axisLine={{stroke:C.border}} interval={0} height={28}/>
                    <YAxis {...yp("%")}/>
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <ReferenceLine y={100} stroke={C.orange} strokeDasharray="4 2"
                      label={{value:"부채비율 100%",fill:C.orange,fontSize:9}}/>
                    <Bar dataKey="debt"     name="부채비율%"   fill={C.red}   opacity={0.7} maxBarSize={20}/>
                    <Line dataKey="retained" name="자본유보율%" stroke={C.teal} strokeWidth={2} dot={{r:3}}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.green}>자산·부채·자본 (억원)</ST>
                <CW h={230}>
                  <ComposedChart data={finTimeline} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="period" tick={{fill:C.muted,fontSize:9}} tickLine={false}
                      axisLine={{stroke:C.border}} interval={0} height={28}/>
                    <YAxis {...yp("억")}/>
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="assets" name="자산총계" fill={C.blue}   opacity={0.6} maxBarSize={20}/>
                    <Bar dataKey="liab"   name="부채총계" fill={C.red}    opacity={0.6} maxBarSize={20}/>
                    <Bar dataKey="equity" name="자본총계" fill={C.green}  opacity={0.7} maxBarSize={20}/>
                  </ComposedChart>
                </CW>
              </>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>
                엑셀 파일을 업로드하면 안정성 차트가 표시됩니다.
              </div></Box>
            )}
          </div>
        )}

        {/* ════ TAB: 배당 ════ */}
        {tab==="dividend"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {co?.divData?.length ? (
              <>
                <ST accent={C.gold}>배당금 (DPS) 추이</ST>
                <CW h={220}>
                  <ComposedChart data={co.divData} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false}
                      axisLine={{stroke:C.border}}/>
                    <YAxis {...yp("원")}/>
                    <Tooltip content={<MTip/>}/>
                    <Bar dataKey="dps" name="DPS(원)" fill={C.gold} opacity={0.8}
                      maxBarSize={40} radius={[4,4,0,0]}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.green}>배당수익률 · 배당성향</ST>
                <CW h={200}>
                  <ComposedChart data={co.divData} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false}
                      axisLine={{stroke:C.border}}/>
                    <YAxis {...yp("%")}/>
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Line dataKey="divYield"  name="배당수익률%" stroke={C.green}  strokeWidth={2} dot={{r:4}}/>
                    <Line dataKey="divPayout" name="배당성향%"   stroke={C.purple} strokeWidth={2} dot={{r:4}}/>
                  </ComposedChart>
                </CW>
                {/* 배당 요약 */}
                <Box>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    {[
                      {k:"최근 DPS",        v:`${co.divData.slice(-1)[0]?.dps||0}원/주`},
                      {k:"최근 배당수익률", v:`${co.divData.slice(-1)[0]?.divYield||0}%`},
                      {k:"최근 배당성향",   v:`${co.divData.slice(-1)[0]?.divPayout||0}%`},
                      {k:"배당 데이터",     v:`${co.divData.length}년치`},
                    ].map(item=>(
                      <div key={item.k} style={{background:C.card2,borderRadius:9,
                        padding:"10px 14px",flex:"1 1 100px",textAlign:"center",
                        border:`1px solid ${C.border}`}}>
                        <div style={{color:C.muted,fontSize:10,marginBottom:3}}>{item.k}</div>
                        <div style={{color:C.gold,fontSize:14,fontWeight:700,fontFamily:"monospace"}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                </Box>
              </>
            ):(
              <Box>
                <div style={{color:C.muted,textAlign:"center",padding:20,lineHeight:1.8}}>
                  💸 배당 데이터가 없습니다.<br/>
                  <span style={{fontSize:11}}>
                    엑셀 서식 ③배당 시트에 네이버 배당 탭을 붙여넣고 업로드하세요.
                  </span>
                </div>
              </Box>
            )}
          </div>
        )}

        {/* ════ TAB: 9인의 거장 ════ */}
        {tab==="masters"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {masterJudge.length ? (()=>{
              const passCount = masterJudge.filter(m=>m.calc.verdict==="추천").length;
              const consensus = passCount>=6?"강력매수":passCount>=4?"중립":"관망";
              const cc        = passCount>=6?C.green:passCount>=4?C.gold:C.red;
              return (
                <>
                  <div style={{background:`linear-gradient(135deg,${cc}18,${C.card2})`,
                    border:`2px solid ${cc}55`,borderRadius:14,padding:"14px 16px",marginBottom:14}}>
                    <div style={{display:"flex",alignItems:"center",
                      justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                      <div>
                        <div style={{color:C.muted,fontSize:10,letterSpacing:"0.1em",marginBottom:3}}>
                          👑 9인의 가치투자 거장 컨센서스
                        </div>
                        <div style={{fontSize:22,fontWeight:900,color:cc,fontFamily:"monospace",letterSpacing:"0.05em"}}>
                          SEQUOIA: {consensus}
                        </div>
                        <div style={{color:C.muted,fontSize:11,marginTop:4}}>
                          ※ 알고리즘 판정 · 투자 참고용 · 최종 판단은 본인 책임
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {[{l:"✅ 추천",v:"추천",c:C.green},{l:"⚖️ 중립",v:"중립",c:C.gold},{l:"❌ 비추천",v:"비추천",c:C.red}]
                          .map(s=>(
                          <div key={s.l} style={{background:C.bg,borderRadius:8,padding:"6px 12px"}}>
                            <span style={{color:s.c,fontSize:13,fontWeight:800,fontFamily:"monospace"}}>
                              {masterJudge.filter(m=>m.calc.verdict===s.v).length}명
                            </span>
                            <span style={{color:C.muted,fontSize:11,marginLeft:5}}>{s.l}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:3,marginTop:10}}>
                      {masterJudge.map((m,i)=>(
                        <div key={i} style={{flex:1,height:28,borderRadius:3,background:m.calc.color,opacity:0.8}}/>
                      ))}
                    </div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                    {masterJudge.map((m,i)=>(
                      <div key={i} style={{background:C.card,
                        border:`1.5px solid ${m.calc.color}44`,
                        borderTop:`3px solid ${m.calc.color}`,
                        borderRadius:11,padding:"10px 10px 8px",position:"relative"}}>
                        <div style={{position:"absolute",top:8,right:8,fontSize:14}}>{m.calc.icon}</div>
                        <div style={{color:m.calc.color,fontSize:11,fontWeight:800,marginBottom:1}}>{m.ko}</div>
                        <div style={{color:C.muted,fontSize:9,marginBottom:5,lineHeight:1.3}}>{m.style}</div>
                        <div style={{display:"inline-block",background:`${m.calc.color}22`,
                          color:m.calc.color,fontSize:11,fontWeight:900,
                          padding:"2px 7px",borderRadius:4,marginBottom:6}}>
                          {m.calc.verdict}
                        </div>
                        <div style={{color:C.muted,fontSize:8,lineHeight:1.5,marginBottom:6,minHeight:28}}>
                          {m.calc.reason}
                        </div>
                        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:5}}>
                          {m.detail.map((d,j)=>(
                            <div key={j} style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                              <span style={{color:C.muted,fontSize:9}}>{d.k}</span>
                              <span style={{color:C.text,fontSize:9,fontFamily:"monospace",fontWeight:700}}>{d.v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })() : (
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>
                재무 데이터를 업로드하면 9인의 거장 판정이 표시됩니다.
              </div></Box>
            )}
          </div>
        )}

        {/* 푸터 */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,
          padding:"9px 13px",display:"flex",justifyContent:"space-between",
          alignItems:"center",flexWrap:"wrap",gap:5,marginTop:14}}>
          <div>
            <div style={{color:C.gold,fontSize:12,fontWeight:700}}>🌲 SEQUOIA QUANTUM SYSTEM v2.0</div>
            <div style={{color:C.muted,fontSize:10,marginTop:1}}>
              Yahoo Finance(월봉 15~20분지연) · 재무: 네이버금융 직접 입력 · 투자 참고용
            </div>
          </div>
          <div style={{display:"flex",gap:4}}>
            <Tag color={C.blue}  size={8}>주가:Yahoo월봉</Tag>
            <Tag color={C.green} size={8}>재무:엑셀입력</Tag>
            <Tag color={C.gold}  size={8}>엔진:자체계산</Tag>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        input[type=range] { accent-color: ${C.blue}; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:4px; }
      `}</style>
    </div>
  );
}
