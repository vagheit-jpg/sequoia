import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  ComposedChart, AreaChart, Area, Bar, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, ReferenceArea, ReferenceDot,
} from "recharts";

// ══════════════════════════════════════════════════════════════
// 0. 색상
// ══════════════════════════════════════════════════════════════
const DARK={
  bg:"#040710",card:"#080D1C",card2:"#0C1228",border:"#141E35",
  grid:"#0A1020",text:"#DCE8F8",muted:"#8AA8C8",dim:"#1A2840",
  gold:"#C8962A",goldL:"#E8B840",blue:"#1E72F0",blueL:"#5BA0FF",
  green:"#00C878",red:"#FF3D5A",orange:"#FF7830",
  purple:"#8855FF",cyan:"#00CCE8",teal:"#10A898",pink:"#E040A8",
};
const LIGHT={
  bg:"#F2F4F8",card:"#FFFFFF",card2:"#EBF0F8",border:"#D0DAE8",
  grid:"#E4EAF4",text:"#0D1B2E",muted:"#5A7090",dim:"#C8D4E4",
  gold:"#A67C00",goldL:"#C89A00",blue:"#1558CC",blueL:"#2474EE",
  green:"#007A48",red:"#CC1830",orange:"#CC5500",
  purple:"#6633CC",cyan:"#0099BB",teal:"#007766",pink:"#AA2288",
};
let C=DARK;

// ══════════════════════════════════════════════════════════════
// 1. Supabase
// ══════════════════════════════════════════════════════════════
const SB_URL="https://ozbosdkdwechddpdajgy.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Ym9zZGtkd2VjaGRkcGRhamd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NDUxOTIsImV4cCI6MjA5MjQyMTE5Mn0.ZtlROqDAeDOMdkj7nXMB9wsJz_m2fe-PLhB8BL-yByk";
const sbFetch=async(path,opts={})=>{
  const r=await fetch(`${SB_URL}/rest/v1/${path}`,{
    headers:{"apikey":SB_KEY,"Authorization":`Bearer ${SB_KEY}`,"Content-Type":"application/json","Prefer":"return=representation",...opts.headers},
    ...opts,
  });
  const txt=await r.text();
  return txt?JSON.parse(txt):null;
};
const sbGetStocks=()=>sbFetch("stocks?select=*&order=name");
const sbUpsertStock=(s)=>sbFetch("stocks",{method:"POST",
  headers:{"Prefer":"resolution=merge-duplicates,return=representation"},
  body:JSON.stringify({ticker:s.ticker,name:s.name,ann_data:s.annData||[],qtr_data:s.qtrData||[],div_data:s.divData||[],updated_at:new Date().toISOString()}),
});
const sbDeleteStock=(ticker)=>sbFetch(`stocks?ticker=eq.${ticker}`,{method:"DELETE"});
const rowToStock=(r)=>({ticker:r.ticker,name:r.name,annData:r.ann_data||[],qtrData:r.qtr_data||[],divData:r.div_data||[]});

// ══════════════════════════════════════════════════════════════
// 2. 주가: 키움 REST API 서버리스 중계 + localStorage 캐시
// ══════════════════════════════════════════════════════════════
const PRICE_CACHE_TTL=60*60*1000;

const fetchKiwoom=async(ticker)=>{
  try{
    const raw=localStorage.getItem(`sq_price_${ticker}`);
    if(raw){
      const{data,ts}=JSON.parse(raw);
      if(Date.now()-ts<PRICE_CACHE_TTL&&data?.monthly?.length)return data;
    }
  }catch{}
  try{
    const res=await fetch(`/api/price?ticker=${ticker}`);
    if(!res.ok)throw new Error(`price API ${res.status}`);
    const data=await res.json();
    if(!data?.monthly?.length)return null;
    try{localStorage.setItem(`sq_price_${ticker}`,JSON.stringify({data,ts:Date.now()}));}catch{}
    return data;
  }catch(e){
    console.warn("[fetchKiwoom] 실패:",e.message);
    return null;
  }
};

// ══════════════════════════════════════════════════════════════
// 3. 기술적 지표
// ══════════════════════════════════════════════════════════════
const ema=(arr,n)=>{const k=2/(n+1);let e=arr[0];return arr.map((v,i)=>{if(i===0)return e;e=v*k+e*(1-k);return+e.toFixed(2);});};

const calcMA60=(monthly)=>{
  const N=60;
  return monthly.map((d,i)=>{
    if(i<N-1)return{...d,ma60:null,gap60:null};
    const avg=monthly.slice(i-N+1,i+1).reduce((s,x)=>s+x.price,0)/N;
    return{...d,ma60:+avg.toFixed(0),gap60:+((d.price/avg-1)*100).toFixed(2)};
  });
};
const calcRSI=(monthly,n=14)=>monthly.map((d,i)=>{
  if(i<n)return{...d,rsi:null};
  const sl=monthly.slice(i-n+1,i+1);let g=0,l=0;
  for(let j=1;j<sl.length;j++){const df=sl[j].price-sl[j-1].price;if(df>0)g+=df;else l-=df;}
  return{...d,rsi:+(l===0?100:100-(100/(1+g/l/n*(n)))).toFixed(1)};
});
const calcMACD=(monthly)=>{
  const cl=monthly.map(d=>d.price),e12=ema(cl,12),e26=ema(cl,26);
  const macd=cl.map((_,i)=>+(e12[i]-e26[i])),sig=ema(macd,9);
  return monthly.map((d,i)=>({...d,macd:macd[i],signal:sig[i],hist:+(macd[i]-sig[i])}));
};
const calcOBV=(monthly)=>{let obv=0;return monthly.map((d,i)=>{
  if(i===0)return{...d,obv:0};
  obv+=d.price>monthly[i-1].price?d.volume:d.price<monthly[i-1].price?-d.volume:0;
  return{...d,obv};
});};
const calcMFI=(monthly,n=14)=>monthly.map((d,i)=>{
  if(i<n)return{...d,mfi:null};
  const sl=monthly.slice(i-n+1,i+1);let pos=0,neg=0;
  sl.forEach((s,j)=>{if(j===0)return;const mfr=s.price*s.volume;if(s.price>sl[j-1].price)pos+=mfr;else neg+=mfr;});
  return{...d,mfi:+(neg===0?100:100-(100/(1+pos/neg))).toFixed(1)};
});
const calcGBands=(monthly)=>monthly.map((d,i)=>{
  const g1=i>=8?Math.round(monthly.slice(Math.max(0,i-8),i+1).reduce((s,x)=>s+x.price,0)/Math.min(9,i+1)):null;
  const b60=i>=59?monthly.slice(i-59,i+1).reduce((s,x)=>s+x.price,0)/60:null;
  const g2=b60?Math.round(b60*1.10):null,g3=b60?Math.round(b60*1.25):null;
  let g4=null;
  if(i>=19){const sl=monthly.slice(i-19,i+1),mean=sl.reduce((s,x)=>s+x.price,0)/20;
    g4=Math.round(mean+2*Math.sqrt(sl.reduce((s,x)=>s+(x.price-mean)**2,0)/20));}
  return{...d,g1,g2,g3,g4};
});

const buildBandsFromQtr=(monthly,qtrData,annData)=>{
  if(!monthly.length)return monthly;
  const epsMap={},bpsMap={};
  (annData||[]).forEach(r=>{epsMap[`${r.year}.12`]=r.eps;bpsMap[`${r.year}.12`]=r.bps;});
  (qtrData||[]).forEach(r=>{
    if(r.eps){const mo=String(r.month||((r.quarter||1)*3)).padStart(2,"0");epsMap[`${r.year}.${mo}`]=r.eps;}
    if(r.bps){const mo=String(r.month||((r.quarter||1)*3)).padStart(2,"0");bpsMap[`${r.year}.${mo}`]=r.bps;}
  });
  const interp=(label,map)=>{
    const keys=Object.keys(map).sort();if(!keys.length)return 0;
    const [yr,mo]=label.split(".").map(Number),val=yr*12+(mo||6);
    let k0=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)<=val;}).slice(-1)[0];
    let k1=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)>val;})[0];
    if(!k0)k0=keys[0];if(!k1)return map[k0]||0;
    const[y0,m0]=k0.split(".").map(Number),[y1,m1]=k1.split(".").map(Number);
    const t=(val-(y0*12+(m0||6)))/((y1*12+(m1||6))-(y0*12+(m0||6)));
    return (map[k0]||0)+((map[k1]||0)-(map[k0]||0))*t;
  };
  return monthly.map(d=>({...d,
    perLo:Math.round(interp(d.label,epsMap)*7),perHi:Math.round(interp(d.label,epsMap)*20),
    perMid:Math.round(interp(d.label,epsMap)*13),pbrLo:Math.round(interp(d.label,bpsMap)*1.0),
    pbrHi:Math.round(interp(d.label,bpsMap)*3.5),
  }));
};

// 수정 5: 매수/매도 화살표 — 위아래 모두 표시
const calcSignalPoints=(data)=>{
  const pts=[];
  data.forEach((d,i)=>{
    if(d.gap60===null||d.ma60===null)return;
    const prev=i>0?data[i-1]:null;
    if(!prev||prev.gap60===null)return;
    if(prev.gap60>-20&&d.gap60<=-20) pts.push({label:d.label,price:d.price,type:"적극매수",color:"#00C878",arrow:"▲",pos:"bottom"});
    else if(prev.gap60>0&&d.gap60<=0) pts.push({label:d.label,price:d.price,type:"매수",color:"#10A898",arrow:"▲",pos:"bottom"});
    else if(prev.gap60<200&&d.gap60>=200) pts.push({label:d.label,price:d.price,type:"매도",color:"#FF7830",arrow:"▼",pos:"top"});
    else if(prev.gap60<300&&d.gap60>=300) pts.push({label:d.label,price:d.price,type:"적극매도",color:"#FF3D5A",arrow:"▼",pos:"top"});
  });
  return pts;
};

// ══════════════════════════════════════════════════════════════
// 4. DCF 3가지
// ══════════════════════════════════════════════════════════════
const calcDCF_rate=({fcf,gr,dr,shares})=>{
  if(!fcf||!shares||shares<=0)return 0;
  let pv=0,cf=fcf;
  for(let y=1;y<=10;y++){cf*=(1+gr);pv+=cf/Math.pow(1+dr,y);}
  const tv=(cf*(1+0.03)/(dr-0.03))/Math.pow(1+dr,10);
  return Math.round((pv+tv)/shares);
};
const calcDCF_graham=({eps,gr,bondYield})=>{
  if(!eps||bondYield<=0)return 0;
  return Math.round(eps*(8.5+2*gr*100)*(4.4/bondYield));
};
// 수정 4: ROE 멀티플 — 적정PER=ROE, 적정주가=ROE×EPS
const calcDCF_roe=({roe,eps})=>{
  if(!roe||!eps||roe<=0)return 0;
  return Math.round(roe*eps);
};
const buildDCFHistory=(annData,gr,dr)=>{
  if(!annData?.length)return[];
  return annData.filter(r=>r.fcf&&r.shares&&r.year).map(r=>({
    year:r.year,fcf:r.fcf,intrinsic:calcDCF_rate({fcf:r.fcf,gr,dr,shares:r.shares/1e8}),
  }));
};

// ══════════════════════════════════════════════════════════════
// 5. 엑셀 파서
// ══════════════════════════════════════════════════════════════
const FIELD_MAP={
  "매출액":"rev","영업이익":"op","당기순이익":"net","영업이익률":"opm","순이익률":"npm",
  "자산총계":"assets","부채총계":"liab","자본총계":"equity","부채비율":"debt","자본유보율":"retained",
  "영업활동현금흐름":"cfo","투자활동현금흐름":"cfi","재무활동현금흐름":"cff","FCF":"fcf",
  "ROE(%)":"roe","ROA(%)":"roa","EPS(원)":"eps","BPS(원)":"bps",
  "PER(배)":"per","PBR(배)":"pbr","발행주식수(보통주)":"shares",
  "현금DPS(원)":"dps","현금배당수익률":"divYield","현금배당성향(%)":"divPayout",
};
const parseSheet=(sheet)=>{
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:""});
  if(!rows.length)return[];
  const isYear=v=>/^20[0-9]{2}/.test(String(v||"").trim());
  let hIdx=-1;
  for(let i=0;i<Math.min(rows.length,8);i++){if(rows[i].slice(1).filter(isYear).length>=1){hIdx=i;break;}}
  if(hIdx===-1)return[];
  const periods=rows[hIdx].slice(1).map(h=>String(h||"").replace(/\n/g," ").trim()).filter(Boolean);
  if(!periods.length)return[];
  const result=periods.map(p=>({period:p}));
  rows.slice(hIdx+1).forEach(row=>{
    const label=String(row[0]||"").trim(),field=FIELD_MAP[label];
    if(!field)return;
    periods.forEach((p,i)=>{
      const raw=String(row[i+1]||"").replace(/,/g,"").trim();
      result[i][field]=raw===""||raw==="-"||raw==="N/A"?null:parseFloat(raw);
    });
  });
  return result;
};
const exYear=p=>{const m=String(p||"").match(/^(20[0-9]{2})/);return m?parseInt(m[1]):0;};
const exMonth=p=>{const m=String(p||"").match(/[\/\.]([0-9]{1,2})/);return m?parseInt(m[1]):12;};
const parseAnn=sheet=>parseSheet(sheet).map(r=>({...r,year:exYear(r.period)})).filter(r=>r.year>0);
const parseQtr=sheet=>parseSheet(sheet).map(r=>{
  const year=exYear(r.period),month=exMonth(r.period),quarter=Math.ceil(month/3);
  return{...r,year,month,quarter,label:`${year}Q${quarter}`};
}).filter(r=>r.year>0);
const parseDiv=sheet=>parseSheet(sheet).map(r=>({...r,year:exYear(r.period)})).filter(r=>r.year>0&&r.dps!=null);
const parseExcel=(file)=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:"binary"});
      const find=kws=>wb.SheetNames.find(n=>kws.some(k=>n.includes(k)));
      resolve({
        ticker:file.name.match(/^(\d{6})/)?.[1]||"",
        name:file.name.replace(/\.xlsx?$/,"").replace(/^\d{6}_/,""),
        annData:parseAnn(wb.Sheets[find(["연간","①"])]||{}),
        qtrData:parseQtr(wb.Sheets[find(["분기","②"])]||{}),
        divData:parseDiv(wb.Sheets[find(["배당","③"])]||{}),
      });
    }catch(err){reject(err);}
  };
  reader.onerror=reject;
  reader.readAsBinaryString(file);
});

// ══════════════════════════════════════════════════════════════
// 6. 종목 목록
// ══════════════════════════════════════════════════════════════
// 폴백용 기본 목록 (/api/corplist 실패 시)
const FALLBACK_STOCKS = [
  {name:"삼성전자",ticker:"005930",market:"KS"},{name:"SK하이닉스",ticker:"000660",market:"KS"},
  {name:"LG에너지솔루션",ticker:"373220",market:"KS"},{name:"삼성바이오로직스",ticker:"207940",market:"KS"},
  {name:"현대차",ticker:"005380",market:"KS"},{name:"기아",ticker:"000270",market:"KS"},
  {name:"POSCO홀딩스",ticker:"005490",market:"KS"},{name:"LG화학",ticker:"051910",market:"KS"},
  {name:"셀트리온",ticker:"068270",market:"KS"},{name:"KB금융",ticker:"105560",market:"KS"},
  {name:"신한지주",ticker:"055550",market:"KS"},{name:"하나금융지주",ticker:"086790",market:"KS"},
  {name:"카카오",ticker:"035720",market:"KS"},{name:"NAVER",ticker:"035420",market:"KS"},
  {name:"삼성SDI",ticker:"006400",market:"KS"},{name:"현대모비스",ticker:"012330",market:"KS"},
  {name:"LG전자",ticker:"066570",market:"KS"},{name:"SK텔레콤",ticker:"017670",market:"KS"},
  {name:"한국전력",ticker:"015760",market:"KS"},{name:"크래프톤",ticker:"259960",market:"KS"},
  {name:"삼성물산",ticker:"028260",market:"KS"},{name:"현대건설",ticker:"000720",market:"KS"},
  {name:"삼성생명",ticker:"032830",market:"KS"},{name:"SK이노베이션",ticker:"096770",market:"KS"},
  {name:"한화솔루션",ticker:"009830",market:"KS"},{name:"두산에너빌리티",ticker:"034020",market:"KS"},
  {name:"카카오뱅크",ticker:"323410",market:"KS"},{name:"현대중공업",ticker:"329180",market:"KS"},
  {name:"HD현대",ticker:"267250",market:"KS"},{name:"한국조선해양",ticker:"009540",market:"KS"},
  {name:"대한항공",ticker:"003490",market:"KS"},{name:"CJ제일제당",ticker:"097950",market:"KS"},
  {name:"오리온",ticker:"271560",market:"KS"},{name:"GS건설",ticker:"006360",market:"KS"},
  {name:"롯데쇼핑",ticker:"023530",market:"KS"},{name:"이마트",ticker:"139480",market:"KS"},
  {name:"호텔신라",ticker:"008770",market:"KS"},{name:"강원랜드",ticker:"035250",market:"KS"},
  {name:"한국가스공사",ticker:"036460",market:"KS"},{name:"SK가스",ticker:"018670",market:"KS"},
  {name:"엔씨소프트",ticker:"036570",market:"KS"},{name:"넷마블",ticker:"251270",market:"KS"},
  {name:"코웨이",ticker:"021240",market:"KS"},{name:"고려아연",ticker:"010130",market:"KS"},
  {name:"현대글로비스",ticker:"086280",market:"KS"},{name:"KT",ticker:"030200",market:"KS"},
  {name:"LG유플러스",ticker:"032640",market:"KS"},{name:"우리금융지주",ticker:"316140",market:"KS"},
  {name:"메리츠금융지주",ticker:"138040",market:"KS"},{name:"DB손해보험",ticker:"005830",market:"KS"},
  {name:"한국금융지주",ticker:"071050",market:"KS"},{name:"삼성화재",ticker:"000810",market:"KS"},
  {name:"현대해상",ticker:"001450",market:"KS"},{name:"미래에셋증권",ticker:"006800",market:"KS"},
  {name:"키움증권",ticker:"039490",market:"KS"},{name:"NH투자증권",ticker:"005940",market:"KS"},
  // KOSDAQ
  {name:"엠아이텍",ticker:"179290",market:"KQ"},{name:"고려신용정보",ticker:"049720",market:"KQ"},
  {name:"한국기업평가",ticker:"034950",market:"KQ"},{name:"에코프로비엠",ticker:"247540",market:"KQ"},
  {name:"에코프로",ticker:"086520",market:"KQ"},{name:"카카오게임즈",ticker:"293490",market:"KQ"},
  {name:"펄어비스",ticker:"263750",market:"KQ"},{name:"HLB",ticker:"028300",market:"KQ"},
  {name:"알테오젠",ticker:"196170",market:"KQ"},{name:"리가켐바이오",ticker:"141080",market:"KQ"},
  {name:"포스코DX",ticker:"022100",market:"KQ"},{name:"레인보우로보틱스",ticker:"277810",market:"KQ"},
  {name:"비트로셀",ticker:"396270",market:"KQ"},{name:"퍼스텍",ticker:"010820",market:"KQ"},
  {name:"셀트리온헬스케어",ticker:"091990",market:"KQ"},{name:"실리콘투",ticker:"257720",market:"KQ"},
  {name:"클래시스",ticker:"214150",market:"KQ"},{name:"휴젤",ticker:"145020",market:"KQ"},
  {name:"파마리서치",ticker:"214450",market:"KQ"},{name:"오스코텍",ticker:"039200",market:"KQ"},
  {name:"메디톡스",ticker:"086900",market:"KQ"},{name:"바디텍메드",ticker:"206640",market:"KQ"},
  {name:"루닛",ticker:"328130",market:"KQ"},{name:"뷰노",ticker:"338220",market:"KQ"},
  {name:"씨젠",ticker:"096530",market:"KQ"},{name:"피씨엘",ticker:"241820",market:"KQ"},
  {name:"솔브레인",ticker:"357780",market:"KQ"},{name:"원익IPS",ticker:"240810",market:"KQ"},
  {name:"리노공업",ticker:"058470",market:"KQ"},{name:"HPSP",ticker:"403870",market:"KQ"},
  {name:"이오테크닉스",ticker:"039030",market:"KQ"},{name:"테크윙",ticker:"089030",market:"KQ"},
  {name:"피엔티",ticker:"137400",market:"KQ"},{name:"코스메카코리아",ticker:"241710",market:"KQ"},
  {name:"한국콜마",ticker:"024720",market:"KQ"},{name:"코스맥스",ticker:"044820",market:"KQ"},
  {name:"F&F",ticker:"383220",market:"KQ"},{name:"크리스에프앤씨",ticker:"110790",market:"KQ"},
  {name:"오리온홀딩스",ticker:"001800",market:"KQ"},{name:"매일유업",ticker:"267980",market:"KQ"},
  {name:"삼양식품",ticker:"003230",market:"KQ"},{name:"농심",ticker:"004370",market:"KQ"},
  {name:"NHN",ticker:"181710",market:"KQ"},{name:"더블유게임즈",ticker:"192080",market:"KQ"},
  {name:"컴투스",ticker:"078340",market:"KQ"},{name:"게임빌",ticker:"063080",market:"KQ"},
  {name:"에스엠",ticker:"041510",market:"KQ"},{name:"와이지엔터테인먼트",ticker:"122870",market:"KQ"},
  {name:"JYP Ent",ticker:"035900",market:"KQ"},{name:"하이브",ticker:"352820",market:"KS"},
  {name:"카카오엔터테인먼트",ticker:"352820",market:"KQ"},{name:"위메이드",ticker:"112040",market:"KQ"},
];

// ══════════════════════════════════════════════════════════════
// 7. 공통 UI
// ══════════════════════════════════════════════════════════════
const Box=({children,p="12px 14px",mb=12,style={}})=>(
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,padding:p,marginBottom:mb,...style}}>{children}</div>
);
const ST=({children,accent,right})=>(
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,marginTop:4}}>
    <div style={{color:accent,fontSize:12,fontWeight:700,letterSpacing:"0.05em",borderLeft:`3px solid ${accent}`,paddingLeft:8}}>{children}</div>
    {right&&<div style={{color:C.muted,fontSize:10}}>{right}</div>}
  </div>
);
const Tag=({children,color,size=10})=>(
  <span style={{background:`${color}22`,color,border:`1px solid ${color}44`,borderRadius:4,padding:"2px 6px",fontSize:size,fontWeight:700}}>{children}</span>
);
const CW=({children,h=200})=>(
  <div style={{marginBottom:16}}><ResponsiveContainer width="100%" height={h}>{children}</ResponsiveContainer></div>
);
const QTick=({x,y,payload,yearOnly})=>{
  if(!payload?.value)return null;
  const parts=payload.value.split(".");
  const yr=parseInt(parts[0]),mo=parseInt(parts[1]||"1");
  const qMap={1:"Q1",4:"Q2",7:"Q3",10:"Q4"};const q=qMap[mo];
  if(yearOnly){if(mo!==1)return null;return(<g transform={`translate(${x},${y+4})`}><text textAnchor="middle" fill={C.muted} fontSize={10} fontFamily="monospace">{yr}</text></g>);}
  if(!q)return null;const isQ1=mo===1;
  return(<g transform={`translate(${x},${y+2})`}>
    {isQ1&&<text y={0} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={700} fontFamily="monospace">{yr}</text>}
    <text y={isQ1?14:0} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">{q}</text>
  </g>);
};
const FinTick=({x,y,payload})=>(<g transform={`translate(${x},${y+4})`}><text textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">{payload?.value}</text></g>);
const MTip=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return(<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 11px",fontSize:11,minWidth:120}}>
    <div style={{color:C.gold,fontWeight:700,marginBottom:4,fontFamily:"monospace"}}>{label}</div>
    {payload.map((p,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,marginBottom:2}}>
      <span style={{color:C.muted}}>{p.name}</span>
      <span style={{color:p.color||C.text,fontFamily:"monospace",fontWeight:700}}>{typeof p.value==="number"?p.value.toLocaleString():p.value}</span>
    </div>))}
  </div>);
};
const ViewToggle=({view,setView})=>(
  <div style={{display:"flex",gap:4,marginBottom:10}}>
    {["연간","분기"].map(v=>(<button key={v} onClick={()=>setView(v)}
      style={{background:view===v?`${C.blue}22`:"transparent",color:view===v?C.blue:C.muted,
        border:`1px solid ${view===v?C.blue:C.border}`,borderRadius:6,padding:"4px 14px",fontSize:11,cursor:"pointer",fontWeight:view===v?700:400}}>{v}</button>))}
  </div>
);

// ══════════════════════════════════════════════════════════════
// 8. 메인 앱
// ══════════════════════════════════════════════════════════════
export default function App(){
  const [darkMode,setDarkMode]=useState(true);
  C=darkMode?DARK:LIGHT;

  const [stocks,setStocks]=useState([]);
  const [activeIdx,setActiveIdx]=useState(0);
  const [dbLoading,setDbLoading]=useState(true);
  const [monthly,setMonthly]=useState([]);
  const [priceInfo,setPriceInfo]=useState(null);
  const [priceLoading,setPriceLoading]=useState(false);
  const [tab,setTab]=useState("overview");
  const [rangeIdx,setRangeIdx]=useState(0);
  const [finView,setFinView]=useState("연간");
  const [stabView,setStabView]=useState("연간");
  const [uploading,setUploading]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const [showSearch,setShowSearch]=useState(false);
  const [dcfDraft,setDcfDraft]=useState({bondYield:3.5,riskPrem:2.0,gr:8.0,reqReturn:10.0});
  const [dcfApplied,setDcfApplied]=useState({bondYield:3.5,riskPrem:2.0,gr:8.0,reqReturn:10.0});
  // 전체 종목 목록 (KRX 동적 로드)
  const [stockList,setStockList]=useState(FALLBACK_STOCKS);
  const fileRef=useRef();
  const searchRef=useRef();
  const RANGES=[{label:"10년",months:120},{label:"5년",months:60},{label:"3년",months:36},{label:"1년",months:12}];

  // Supabase 로드 + localStorage 이중 보장
  useEffect(()=>{
    setDbLoading(true);
    const loadFromLocal=()=>{
      try{const s=localStorage.getItem("sequoia_v3");if(s){const p=JSON.parse(s);if(p?.length){setStocks(p);return true;}}}catch{}
      return false;
    };
    sbGetStocks().then(rows=>{
      if(rows?.length){
        const mapped=rows.map(rowToStock);
        setStocks(mapped);
        try{localStorage.setItem("sequoia_v3",JSON.stringify(mapped));}catch{}
      }else{loadFromLocal();}
    }).catch(()=>{loadFromLocal();}).finally(()=>setDbLoading(false));
  },[]);

  // 종목 목록 로드: localStorage 캐시 → /api/corplist → FALLBACK
  useEffect(()=>{
    try{
      const raw=localStorage.getItem("sq_corplist");
      if(raw){const{data,ts}=JSON.parse(raw);if(Date.now()-ts<86400000&&data?.length>100){setStockList(data);return;}}
    }catch{}
    fetch("/api/corplist").then(r=>r.json()).then(data=>{
      if(data?.length>100){
        setStockList(data);
        try{localStorage.setItem("sq_corplist",JSON.stringify({data,ts:Date.now()}));}catch{}
      }
    }).catch(()=>{});
  },[]);

  const co=stocks[activeIdx]||null;

  // 종목 주가 로드 (키움 REST API)
  useEffect(()=>{
    if(!co?.ticker)return;
    setPriceLoading(true);setMonthly([]);setPriceInfo(null);
    fetchKiwoom(co.ticker).then(res=>{
      if(res?.monthly?.length){setMonthly(res.monthly);setPriceInfo(res);}
      setPriceLoading(false);
    });
  },[activeIdx,co?.ticker]);

  // 검색
  useEffect(()=>{
    if(!searchQuery.trim()){setSearchResults([]);return;}
    const q=searchQuery.trim().toLowerCase();
    setSearchResults(stockList.filter(s=>s.name.toLowerCase().includes(q)||s.ticker.includes(q)).slice(0,10));
  },[searchQuery]);

  // 수정 1: 검색 결과 선택 — 엑셀 없어도 주가 조회 가능
  const selectSearchResult=useCallback(async(s)=>{
    setShowSearch(false);setSearchQuery("");
    const idx=stocks.findIndex(st=>st.ticker===s.ticker);
    if(idx>=0){setActiveIdx(idx);setTab("price60");return;}
    // 미등록 종목 — market 정보 stockList에서 가져옴
    const info=stockList.find(x=>x.ticker===s.ticker)||s;
    const tmp={ticker:info.ticker,name:info.name,annData:[],qtrData:[],divData:[]};
    setStocks(prev=>[...prev,tmp]);
    setActiveIdx(stocks.length);
    setTab("price60");
  },[stocks,stockList]);

  const latestLabel=useMemo(()=>{
    const now=new Date(),d=new Date(now.getFullYear(),now.getMonth()-1,1);
    return`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}`;
  },[]);

  const displayMonthly=useMemo(()=>monthly.slice(-RANGES[rangeIdx].months).filter(d=>d.label<=latestLabel),[monthly,rangeIdx,latestLabel]);

  const withMA60  =useMemo(()=>calcMA60(displayMonthly),[displayMonthly]);
  const withBands =useMemo(()=>buildBandsFromQtr(withMA60,co?.qtrData,co?.annData),[withMA60,co?.qtrData,co?.annData]);
  const withG     =useMemo(()=>calcGBands(displayMonthly),[displayMonthly]);
  const withRSI   =useMemo(()=>calcRSI(displayMonthly),[displayMonthly]);
  const withMACD  =useMemo(()=>calcMACD(displayMonthly),[displayMonthly]);
  const withOBV   =useMemo(()=>calcOBV(displayMonthly),[displayMonthly]);
  const withMFI   =useMemo(()=>calcMFI(displayMonthly),[displayMonthly]);
  const signalPts =useMemo(()=>calcSignalPoints(withMA60),[withMA60]);
  const lastGap   =withMA60.slice(-1)[0]?.gap60??null;
  const lastAnn   =co?.annData?.slice(-1)?.[0]||{};

  const dcfResults=useMemo(()=>{
    const dr=(dcfApplied.bondYield+dcfApplied.riskPrem)/100,gr=dcfApplied.gr/100;
    const shares=lastAnn.shares?lastAnn.shares/1e8:null;
    const a=shares?calcDCF_rate({fcf:lastAnn.fcf,gr,dr,shares}):0;
    const b=calcDCF_graham({eps:lastAnn.eps,gr,bondYield:dcfApplied.bondYield});
    const c=calcDCF_roe({roe:lastAnn.roe,eps:lastAnn.eps});
    const valid=[a,b,c].filter(v=>v>0);
    const avg=valid.length?Math.round(valid.reduce((s,v)=>s+v,0)/valid.length):0;
    return{a,b,c,avg};
  },[lastAnn,dcfApplied]);

  const dcfHistory=useMemo(()=>buildDCFHistory(co?.annData,dcfApplied.gr/100,(dcfApplied.bondYield+dcfApplied.riskPrem)/100),[co?.annData,dcfApplied]);

  const annTimeline=useMemo(()=>(co?.annData||[]).map(r=>({...r,period:`${r.year}년`})),[co?.annData]);
  const qtrTimeline=useMemo(()=>(co?.qtrData||[]).map(r=>({...r,period:r.label})),[co?.qtrData]);

  // 수정 3: EPS·FCF·주가 동행 — 분기 선택 시 분기 데이터 사용
  const epsPriceData=useMemo(()=>{
    if(finView==="분기"){
      if(!co?.qtrData?.length||!monthly.length)return[];
      return co.qtrData.filter(r=>r.eps||r.fcf).map(r=>{
        const mo=String(r.month||((r.quarter||1)*3)).padStart(2,"0");
        const match=monthly.find(m=>m.label===`${r.year}.${mo}`);
        return{year:r.year,period:r.label,eps:r.eps||null,fcf:r.fcf||null,price:match?.price||null};
      }).filter(r=>r.price);
    }
    if(!co?.annData?.length||!monthly.length)return[];
    return co.annData.filter(r=>r.eps||r.fcf).map(r=>{
      const dec=monthly.filter(m=>m.year===r.year&&m.month===12);
      const avg=monthly.filter(m=>m.year===r.year);
      const p=dec.length?dec[dec.length-1].price:avg.length?Math.round(avg.reduce((s,m)=>s+m.price,0)/avg.length):null;
      return{year:r.year,period:`${r.year}년`,eps:r.eps||null,fcf:r.fcf||null,price:p};
    });
  },[co?.annData,co?.qtrData,monthly,finView]);

  const growthData=useMemo(()=>{
    const data=finView==="연간"?annTimeline:qtrTimeline;
    return data.map((r,i)=>{
      if(i===0)return{...r,revGrowth:null,opGrowth:null};
      const prev=data[i-1];
      return{...r,
        revGrowth:prev.rev&&r.rev?+((r.rev-prev.rev)/Math.abs(prev.rev)*100).toFixed(1):null,
        opGrowth:prev.op&&r.op?+((r.op-prev.op)/Math.abs(prev.op)*100).toFixed(1):null,
      };
    });
  },[annTimeline,qtrTimeline,finView]);

  const gapSig=(gap)=>{
    if(gap===null)return{label:"—",color:C.muted};
    if(gap<=-20)return{label:"적극매수",color:C.green};
    if(gap<0)return{label:"매수",color:C.teal};
    if(gap<100)return{label:"관망",color:C.gold};
    if(gap<200)return{label:"과열",color:C.orange};
    if(gap<300)return{label:"매도",color:"#FF6B00"};
    return{label:"적극매도",color:C.red};
  };
  const gs=gapSig(lastGap);
  const price=priceInfo?.currentPrice||0;
  const priceDateStr=priceInfo?.priceDateStr||"";
  const ma60val=withMA60.slice(-1)[0]?.ma60||0;
  const per=lastAnn.per||(lastAnn.eps&&price?Math.round(price/lastAnn.eps*10)/10:0);
  const pbr=lastAnn.pbr||(lastAnn.bps&&price?Math.round(price/lastAnn.bps*100)/100:0);

  const scores=useMemo(()=>({
    fin:  Math.min(100,Math.max(0,Math.round(95-(lastAnn.debt||0)*1.5))),
    growth:Math.min(100,Math.max(0,Math.round(65+(lastAnn.roe||0)))),
    stable:Math.min(100,Math.max(0,Math.round(95-(lastAnn.debt||0)*2))),
    value: Math.min(100,Math.max(0,Math.round(100-(price/(dcfResults.avg||1)-1)*80))),
    mom:   Math.min(100,Math.max(0,Math.round(50+(lastGap||0)/4))),
    supply:65,
  }),[lastAnn,price,dcfResults,lastGap]);

  const xp=(yearOnly=false)=>({dataKey:"label",height:yearOnly?20:40,tick:<QTick yearOnly={yearOnly}/>,tickLine:false,axisLine:{stroke:C.border},interval:0});
  const yp=(unit="",w=44)=>({tick:{fill:C.muted,fontSize:11},tickLine:false,axisLine:false,unit,width:w});

  const handleUpload=async(e)=>{
    const files=Array.from(e.target.files);if(!files.length)return;
    setUploading(true);
    try{
      const results=await Promise.all(files.map(parseExcel));
      await Promise.allSettled(results.map(res=>sbUpsertStock(res)));
      const rows=await sbGetStocks().catch(()=>null);
      let next;
      if(rows?.length){next=rows.map(rowToStock);}
      else{next=[...stocks];results.forEach(res=>{const i=next.findIndex(s=>s.ticker===res.ticker);if(i>=0)next[i]=res;else next.push(res);});}
      setStocks(next);
      try{localStorage.setItem("sequoia_v3",JSON.stringify(next));}catch{}
    }catch(err){alert("업로드 실패: "+err.message);}
    setUploading(false);e.target.value="";
  };

  const removeStock=async(idx)=>{
    const s=stocks[idx];
    if(s?.ticker)await sbDeleteStock(s.ticker).catch(()=>{});
    const next=stocks.filter((_,i)=>i!==idx);
    setStocks(next);
    try{localStorage.setItem("sequoia_v3",JSON.stringify(next));}catch{}
    setActiveIdx(0);
  };

  const masterJudge=useMemo(()=>{
    if(!co||!price)return[];
    const last=co.annData?.slice(-1)?.[0]||{},prev=co.annData?.slice(-2,-1)?.[0]||{};
    const opm=last.opm||0,prevOpm=prev.opm||0,rev=last.rev||0,prevRev=prev.rev||0;
    const revGrowth=prevRev?Math.round((rev-prevRev)/prevRev*100):0;
    const eps=last.eps||0,prevEps=prev.eps||0,epsGrowth=prevEps?Math.round((eps-prevEps)/prevEps*100):0;
    const bps=last.bps||0,fcf=last.fcf||0,debt=last.debt||0;
    const mktCap=price*(last.shares||0)/1e8,netCash=Math.round((last.assets||0)-(last.liab||0));
    const roic=Math.round(opm*(rev/(last.assets||1)));
    const avgRoe3=(co.annData?.slice(-3)||[]).reduce((s,r)=>s+(r.roe||0),0)/3;
    const ttmEps=(co.qtrData?.slice(-4)||[]).reduce((s,r)=>s+(r.eps||0),0)||eps;
    const ttmPer=ttmEps?Math.round(price/ttmEps*10)/10:per;
    const peg=epsGrowth>0?Math.round(ttmPer/epsGrowth*10)/10:99;
    const divYield=co.divData?.slice(-1)?.[0]?.divYield||0;
    const neffRatio=ttmPer>0?Math.round((divYield+epsGrowth)/ttmPer*10)/10:0;
    const j=(good,bad,reason)=>({verdict:good?"추천":bad?"비추천":"중립",color:good?C.green:bad?C.red:C.gold,icon:good?"✅":bad?"❌":"⚖️",reason});
    return[
      {ko:"벤저민 그레이엄",style:"안전마진·자산가치",calc:j(pbr<1.5&&ttmPer<15&&debt<50,pbr>2.5||ttmPer>25,`PBR ${pbr}배 | PER ${ttmPer}배 | 부채 ${debt}%`),detail:[{k:"PBR",v:`${pbr}배`},{k:"PER",v:`${ttmPer}배`},{k:"부채",v:`${debt}%`}]},
      {ko:"워런 버핏",style:"ROE·경제적 해자",calc:j(avgRoe3>=15&&debt<50&&opm>=15,avgRoe3<10||opm<5,`3년ROE ${avgRoe3.toFixed(1)}% | OPM ${opm}%`),detail:[{k:"3년ROE",v:`${avgRoe3.toFixed(1)}%`},{k:"OPM",v:`${opm}%`},{k:"부채",v:`${debt}%`}]},
      {ko:"피터 린치",style:"PEG·성장가치",calc:j(peg!==99&&peg<1.5,peg>2.5||epsGrowth<0,`PEG ${peg===99?"N/A":peg} | EPS성장 ${epsGrowth}%`),detail:[{k:"PEG",v:peg===99?"N/A":peg},{k:"PER",v:`${ttmPer}배`},{k:"EPS성장",v:`${epsGrowth}%`}]},
      {ko:"필립 피셔",style:"탁월한 경영·성장",calc:j(opm>=15&&opm>prevOpm&&revGrowth>10,opm<8||revGrowth<0,`OPM ${opm}% | 매출성장 ${revGrowth}%`),detail:[{k:"OPM",v:`${opm}%`},{k:"전년OPM",v:`${prevOpm}%`},{k:"매출YoY",v:`${revGrowth}%`}]},
      {ko:"찰리 멍거",style:"ROIC·독점적 해자",calc:j(roic>=15&&debt<30,roic<8||debt>80,`ROIC ${roic}% | 부채 ${debt}%`),detail:[{k:"추정ROIC",v:`${roic}%`},{k:"부채비율",v:`${debt}%`},{k:"OPM",v:`${opm}%`}]},
      {ko:"모니시 파브라이",style:"하방제한·턴어라운드",calc:j(pbr<1.5&&fcf>0&&revGrowth>0,pbr>3.0||fcf<0,`PBR ${pbr}배 | FCF ${fcf}억`),detail:[{k:"PBR",v:`${pbr}배`},{k:"FCF",v:`${fcf}억`},{k:"매출YoY",v:`${revGrowth}%`}]},
      {ko:"존 네프",style:"저PER·배당+성장",calc:j(ttmPer<15&&neffRatio>=2,ttmPer>20||neffRatio<1,`Neff ${neffRatio} | PER ${ttmPer}배`),detail:[{k:"PER",v:`${ttmPer}배`},{k:"Neff Ratio",v:neffRatio},{k:"EPS성장",v:`${epsGrowth}%`}]},
      {ko:"세스 클라만",style:"극단적 안전마진",calc:j(netCash>mktCap*0.5||pbr<1.0,pbr>2.5&&netCash<mktCap*0.2,`순현금 ${netCash}억 | PBR ${pbr}배`),detail:[{k:"추정순현금",v:`${netCash}억`},{k:"시총",v:`${Math.round(mktCap)}억`},{k:"PBR",v:`${pbr}배`}]},
    ];
  },[co,price,per,pbr,ma60val,lastAnn,priceInfo]);

  const TABS=[
    {id:"overview",label:"📊 종합"},{id:"price60",label:"📈 주가"},
    {id:"perbpr",label:"💹 PER/PBR"},{id:"financial",label:"💰 재무"},
    {id:"technical",label:"🧮 기술분석"},{id:"valuation",label:"💎 가치평가"},
    {id:"stability",label:"🛡 안정성"},{id:"dividend",label:"💸 배당"},
    {id:"masters",label:"👑 8거장"},
  ];

  if(dbLoading)return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:C.gold,fontSize:16,fontFamily:"monospace"}}>🌲 SEQUOIA 로딩 중...</div>
    </div>
  );


  const hasFinData=!!(co?.annData?.length||co?.qtrData?.length);

  // 수정 1: 종목 없어도 메인 화면 진입 가능
  // 검색으로 종목 추가하거나 엑셀 업로드로 추가
  const showMainApp=stocks.length>0;

  // ── 빈 화면 (종목 없을 때) — 수정 1: 검색창 포함, 분석화면 바로 접근
  if(!showMainApp)return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"12px 16px",display:"flex",alignItems:"center",gap:8}}>
        <div style={{color:C.gold,fontSize:16,fontWeight:900,fontFamily:"monospace"}}>🌲 SEQUOIA</div>
        <button onClick={()=>setDarkMode(d=>!d)}
          style={{marginLeft:"auto",background:"transparent",color:C.muted,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 8px",fontSize:13,cursor:"pointer"}}>
          {darkMode?"☀️":"🌙"}
        </button>
      </div>
      <div style={{maxWidth:440,margin:"60px auto",padding:24,textAlign:"center"}}>
        <div style={{color:C.gold,fontSize:24,fontWeight:900,letterSpacing:"0.06em",fontFamily:"monospace",marginBottom:8}}>🌲 SEQUOIA</div>
        <div style={{color:C.muted,fontSize:13,lineHeight:1.8,marginBottom:28}}>
          종목코드 또는 종목명으로 바로 검색하거나<br/>엑셀 파일을 업로드하세요.
        </div>
        {/* 검색창 */}
        <div style={{position:"relative",marginBottom:16}}>
          <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
            placeholder="종목명 또는 코드 입력 (예: 삼성전자, 005930)"
            style={{width:"100%",background:C.card,color:C.text,border:`1px solid ${C.blue}`,
              borderRadius:10,padding:"12px 16px",fontSize:13,outline:"none",
              boxSizing:"border-box"}}/>
          {searchResults.length>0&&(
            <div style={{position:"absolute",top:"110%",left:0,right:0,background:C.card,
              border:`1px solid ${C.border}`,borderRadius:10,zIndex:100,
              boxShadow:`0 8px 24px rgba(0,0,0,0.3)`}}>
              {searchResults.map((s,i)=>(
                <div key={i} onClick={()=>selectSearchResult(s)}
                  style={{padding:"10px 16px",cursor:"pointer",display:"flex",
                    justifyContent:"space-between",alignItems:"center",
                    borderBottom:`1px solid ${C.border}44`}}>
                  <span style={{color:C.text,fontSize:13,fontWeight:600}}>{s.name}</span>
                  <span style={{color:C.muted,fontSize:11,fontFamily:"monospace"}}>{s.ticker} {s.market}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{color:C.muted,fontSize:11,marginBottom:24}}>— 또는 —</div>
        <button onClick={()=>fileRef.current?.click()} style={{
          background:`linear-gradient(135deg,${C.blue},${C.blueL})`,
          color:"#fff",border:"none",borderRadius:12,padding:"13px 28px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
          📂 엑셀 파일 업로드
        </button>
        <div style={{color:C.muted,fontSize:10,marginTop:10}}>파일명: 179290_엠아이텍.xlsx</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{display:"none"}} onChange={handleUpload}/>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontSize:13,
      fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>

      {/* ── 헤더 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
        padding:"8px 12px",display:"flex",alignItems:"center",gap:8,position:"sticky",top:0,zIndex:100}}>
        <div style={{color:C.gold,fontSize:15,fontWeight:900,fontFamily:"monospace",flexShrink:0}}>🌲</div>
        <div style={{position:"relative",flex:1,minWidth:0}}>
          <select value={activeIdx} onChange={e=>{setActiveIdx(+e.target.value);setTab("overview");}}
            style={{width:"100%",background:C.card2,color:C.text,border:`1px solid ${C.blue}`,
              borderRadius:8,padding:"6px 26px 6px 10px",fontSize:13,fontWeight:700,
              fontFamily:"monospace",cursor:"pointer",appearance:"none",WebkitAppearance:"none",outline:"none"}}>
            {stocks.map((s,i)=><option key={i} value={i}>{s.name}　{s.ticker}</option>)}
          </select>
          <div style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",color:C.blue,fontSize:11}}>▼</div>
        </div>
        {/* 검색 */}
        <div style={{position:"relative",flexShrink:0}}>
          <button onClick={()=>{setShowSearch(s=>!s);setTimeout(()=>searchRef.current?.focus(),100);}}
            style={{background:C.card2,color:C.muted,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 10px",fontSize:12,cursor:"pointer"}}>🔍</button>
          {showSearch&&(
            <div style={{position:"absolute",right:0,top:"110%",background:C.card,
              border:`1px solid ${C.border}`,borderRadius:10,padding:8,zIndex:200,width:240,
              boxShadow:`0 8px 24px rgba(0,0,0,0.3)`}}>
              <input ref={searchRef} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                placeholder="종목명 또는 코드..."
                style={{width:"100%",background:C.card2,color:C.text,border:`1px solid ${C.border}`,
                  borderRadius:6,padding:"6px 10px",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
              {searchResults.map((s,i)=>(
                <div key={i} onClick={()=>selectSearchResult(s)}
                  style={{padding:"8px 10px",cursor:"pointer",borderRadius:6,marginTop:4,
                    display:"flex",justifyContent:"space-between",alignItems:"center",background:C.card2}}>
                  <span style={{color:C.text,fontSize:12,fontWeight:600}}>{s.name}</span>
                  <span style={{color:C.muted,fontSize:10,fontFamily:"monospace"}}>{s.ticker}</span>
                </div>
              ))}
              {searchQuery&&!searchResults.length&&(
                <div style={{color:C.muted,fontSize:11,padding:"8px 10px",textAlign:"center"}}>검색 결과 없음</div>
              )}
            </div>
          )}
        </div>
        <button onClick={()=>fileRef.current?.click()} disabled={uploading}
          style={{background:C.blue,color:"#fff",border:"none",borderRadius:7,padding:"6px 10px",fontSize:11,cursor:"pointer",fontWeight:700,flexShrink:0}}>
          {uploading?"…":"📂"}
        </button>
        <button onClick={()=>setDarkMode(d=>!d)}
          style={{background:"transparent",color:C.muted,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 8px",fontSize:13,cursor:"pointer",flexShrink:0}}>
          {darkMode?"☀️":"🌙"}
        </button>
        <button onClick={()=>removeStock(activeIdx)}
          style={{background:"transparent",color:C.red,border:`1px solid ${C.red}44`,borderRadius:7,padding:"6px 8px",fontSize:11,cursor:"pointer",flexShrink:0}}>🗑</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{display:"none"}} onChange={handleUpload}/>
      </div>

      {/* ── 종목 헤더 */}
      <div style={{background:`linear-gradient(135deg,${C.card2},${C.card})`,borderBottom:`1px solid ${C.border}`,padding:"10px 12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:16,fontWeight:900,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{co?.name}</div>
            <div style={{color:C.muted,fontSize:10,marginTop:1}}>{co?.ticker}</div>
          </div>
          {priceLoading?<div style={{color:C.muted,fontSize:11}}>주가 로딩 중...</div>:price>0?(
            <div style={{flexShrink:0}}>
              <div style={{fontSize:20,fontWeight:900,color:C.text,fontFamily:"monospace"}}>{price.toLocaleString()}원</div>
              <div style={{color:C.muted,fontSize:10,marginTop:2}}>{priceDateStr}</div>
            </div>
          ):null}
        </div>
        <div style={{display:"flex",gap:6,marginTop:8,overflowX:"auto",paddingBottom:2}}>
          {[
            {k:"PER",v:per?`${per}배`:"—",c:C.gold},
            {k:"PBR",v:pbr?`${pbr}배`:"—",c:C.gold},
            {k:"이격도",v:lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"—",c:gs.color},
            {k:"신호",v:gs.label,c:gs.color},
            {k:"DCF평균",v:dcfResults.avg?`${dcfResults.avg.toLocaleString()}원`:"—",c:C.blueL},
          ].map(k=>(
            <div key={k.k} style={{textAlign:"center",background:C.bg,borderRadius:7,padding:"5px 8px",flexShrink:0}}>
              <div style={{color:C.muted,fontSize:9}}>{k.k}</div>
              <div style={{color:k.c,fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 탭 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"6px 12px",display:"flex",gap:4,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{background:tab===t.id?C.blue:"transparent",color:tab===t.id?"#fff":C.muted,
              border:`1px solid ${tab===t.id?C.blue:C.border}`,borderRadius:7,padding:"5px 10px",
              fontSize:11,cursor:"pointer",whiteSpace:"nowrap",fontWeight:tab===t.id?700:400}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 기간 선택 */}
      {["price60","perbpr","technical"].includes(tab)&&(
        <div style={{background:C.card2,borderBottom:`1px solid ${C.border}`,padding:"5px 12px",display:"flex",gap:4}}>
          {RANGES.map((r,i)=>(
            <button key={i} onClick={()=>setRangeIdx(i)}
              style={{background:i===rangeIdx?`${C.blue}22`:"transparent",color:i===rangeIdx?C.blue:C.muted,
                border:`1px solid ${i===rangeIdx?C.blue:C.border}`,borderRadius:5,padding:"3px 9px",fontSize:11,cursor:"pointer"}}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div style={{padding:"12px",maxWidth:900,margin:"0 auto"}}>

        {/* ════ 종합 ════ */}
        {tab==="overview"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <Box>
              <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{width:120,height:120,flexShrink:0}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={[{s:"재무",v:scores.fin},{s:"성장",v:scores.growth},{s:"안정",v:scores.stable},{s:"밸류",v:scores.value},{s:"모멘텀",v:scores.mom},{s:"수급",v:scores.supply}]}>
                      <PolarGrid stroke={C.border}/><PolarAngleAxis dataKey="s" tick={{fill:C.muted,fontSize:9}}/>
                      <Radar dataKey="v" stroke={C.gold} fill={C.gold} fillOpacity={0.2} strokeWidth={2}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{flex:1,minWidth:120}}>
                  <div style={{color:C.muted,fontSize:10,marginBottom:2}}>종합 투자 스코어</div>
                  <div style={{fontSize:32,fontWeight:900,color:C.gold,fontFamily:"monospace"}}>{Math.round(Object.values(scores).reduce((s,v)=>s+v,0)/6)}</div>
                  <div style={{color:C.muted,fontSize:9,marginBottom:6}}>/100점</div>
                  {[["재무건전성",scores.fin],["성장성",scores.growth],["안정성",scores.stable],["밸류",scores.value],["모멘텀",scores.mom],["수급",scores.supply]].map(([k,v])=>(
                    <div key={k} style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
                      <div style={{width:48,fontSize:9,color:C.muted,flexShrink:0}}>{k}</div>
                      <div style={{flex:1,height:3,background:C.border,borderRadius:2}}>
                        <div style={{width:`${v}%`,height:"100%",background:v>=80?C.green:v>=60?C.gold:C.red,borderRadius:2}}/>
                      </div>
                      <div style={{width:22,fontSize:9,color:C.text,textAlign:"right",fontFamily:"monospace"}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Box>
            {hasFinData?(
              <Box>
                <ST accent={C.gold}>최근 연간 재무 요약 ({lastAnn.year}년)</ST>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))",gap:6}}>
                  {[{k:"매출액",v:`${lastAnn.rev}억`,c:C.text},{k:"영업이익",v:`${lastAnn.op}억`,c:C.green},
                    {k:"순이익",v:`${lastAnn.net}억`,c:C.green},{k:"OPM",v:`${lastAnn.opm}%`,c:C.gold},
                    {k:"ROE",v:`${lastAnn.roe}%`,c:C.blueL},{k:"부채비율",v:`${lastAnn.debt}%`,c:(lastAnn.debt||0)>100?C.red:C.teal},
                    {k:"FCF",v:`${lastAnn.fcf}억`,c:C.cyan},{k:"EPS",v:`${(lastAnn.eps||0).toLocaleString()}원`,c:C.purple},
                  ].map(item=>(
                    <div key={item.k} style={{background:C.card2,borderRadius:8,padding:"8px 10px",border:`1px solid ${C.border}`}}>
                      <div style={{color:C.muted,fontSize:9,marginBottom:2}}>{item.k}</div>
                      <div style={{color:item.c,fontSize:13,fontWeight:700,fontFamily:"monospace"}}>{item.v}</div>
                    </div>
                  ))}
                </div>
              </Box>
            ):(
              <Box>
                <div style={{color:C.muted,textAlign:"center",padding:"20px 0",fontSize:12,lineHeight:1.8}}>
                  📂 엑셀 파일을 업로드하면 재무 데이터가 표시됩니다.<br/>
                  <span style={{fontSize:11}}>주가·기술분석은 현재 상태에서도 이용 가능합니다.</span>
                </div>
              </Box>
            )}
          </div>
        )}

        {/* ════ 주가·60MA ════ */}
        {tab==="price60"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {lastGap!==null&&(
              <div style={{background:`${gs.color}15`,border:`1px solid ${gs.color}44`,borderRadius:9,
                padding:"8px 13px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                <div style={{color:gs.color,fontWeight:700,fontSize:12}}>60MA 이격도: {lastGap>0?"+":""}{lastGap}%</div>
                <Tag color={gs.color} size={11}>{gs.label}</Tag>
                <div style={{color:C.muted,fontSize:9}}>≤-20%:적극매수 / +100%:과열 / +200%:매도 / +300%:적극매도</div>
              </div>
            )}
            <ST accent={C.blue} right="▲매수 ▼매도">주가 & 60MA</ST>
            <CW h={300}>
              <ComposedChart data={withMA60} margin={{top:20,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                <Area dataKey="price" name="주가" stroke={C.blue} strokeWidth={2} fill={`${C.blue}18`} dot={false}/>
                <Line dataKey="ma60" name="60MA" stroke={C.gold} strokeWidth={2} dot={false} strokeDasharray="5 3"/>
                {/* 수정 5: 매수▲ 하단, 매도▼ 상단 모두 표시 */}
                {signalPts.map((pt,i)=>(
                  <ReferenceDot key={i} x={pt.label} y={pt.price} r={0}
                    label={{value:pt.arrow,position:pt.pos==="bottom"?"bottom":"top",fill:pt.color,fontSize:18,fontWeight:900}}/>
                ))}
              </ComposedChart>
            </CW>
            <ST accent={C.teal}>60MA 이격도 (%)</ST>
            <CW h={180}>
              <ComposedChart data={withMA60} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={-100} y2={-20} fill={`${C.green}10`}/>
                <ReferenceArea y1={200} y2={500} fill={`${C.red}08`}/>
                <ReferenceLine y={0}   stroke={C.dim}   strokeDasharray="2 2"/>
                <ReferenceLine y={-20} stroke={C.green} strokeDasharray="4 2" label={{value:"적극매수-20%",fill:C.green,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={100} stroke={C.gold}  strokeDasharray="4 2" label={{value:"과열+100%",fill:C.gold,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={200} stroke={C.orange} strokeDasharray="4 2" label={{value:"매도+200%",fill:C.orange,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={300} stroke={C.red}   strokeDasharray="4 2" label={{value:"적극매도+300%",fill:C.red,fontSize:9,position:"insideTopRight"}}/>
                <Bar dataKey="gap60" name="이격도(%)" maxBarSize={8} radius={[2,2,0,0]} fill={C.teal}/>
              </ComposedChart>
            </CW>
          </div>
        )}

        {/* ════ PER/PBR ════ */}
        {tab==="perbpr"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {co?.annData?.length||co?.qtrData?.length?(
              <>
                <ST accent={C.purple}>PER 밴드 (7배·13배·20배)</ST>
                <CW h={270}>
                  <ComposedChart data={withBands} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>}/>
                    <Area dataKey="perHi" name="PER 20배" stroke={C.red}   fill={`${C.red}10`}   strokeWidth={1} dot={false}/>
                    <Area dataKey="perMid" name="PER 13배" stroke={C.gold}  fill={`${C.gold}08`}  strokeWidth={1} dot={false}/>
                    <Area dataKey="perLo" name="PER 7배"  stroke={C.green} fill={`${C.green}10`} strokeWidth={1} dot={false}/>
                    <Line dataKey="price" name="주가"     stroke={C.blueL} strokeWidth={2.5}     dot={false}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.cyan}>PBR 밴드 (1배·3.5배)</ST>
                <CW h={240}>
                  <ComposedChart data={withBands} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>}/>
                    <Area dataKey="pbrHi" name="PBR 3.5배" stroke={C.red}   fill={`${C.red}10`}   strokeWidth={1} dot={false}/>
                    <Area dataKey="pbrLo" name="PBR 1배"   stroke={C.green} fill={`${C.green}10`} strokeWidth={1} dot={false}/>
                    <Line dataKey="price" name="주가"       stroke={C.blueL} strokeWidth={2.5}    dot={false}/>
                  </ComposedChart>
                </CW>
              </>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>📂 엑셀 업로드 후 표시됩니다.</div></Box>
            )}
          </div>
        )}

        {/* ════ 재무 ════ */}
        {tab==="financial"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {hasFinData?(()=>{
              const data=finView==="연간"?annTimeline:qtrTimeline;
              return(
                <>
                  <ViewToggle view={finView} setView={setFinView}/>
                  <ST accent={C.green} right="억원">매출·영업이익·순이익</ST>
                  <CW h={240}>
                    <ComposedChart data={data} margin={{top:4,right:10,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp("억")}/>
                      <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="rev" name="매출액"   fill={C.blue}   opacity={0.7} maxBarSize={24}/>
                      <Bar dataKey="op"  name="영업이익" fill={C.green}  opacity={0.8} maxBarSize={24}/>
                      <Bar dataKey="net" name="순이익"   fill={C.purple} opacity={0.7} maxBarSize={24}/>
                    </ComposedChart>
                  </CW>
                  {/* 수정 3: 성장률 YoY */}
                  <ST accent={C.gold} right="YoY %">매출·영업이익 성장률</ST>
                  <CW h={190}>
                    <ComposedChart data={growthData} margin={{top:4,right:10,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp("%")}/>
                      <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                      {/* 수정 3: 0선 점선 추가 */}
                      <ReferenceLine y={0} stroke={C.muted} strokeDasharray="4 3"/>
                      <Line dataKey="revGrowth" name="매출 YoY%" stroke={C.blue}  strokeWidth={2} dot={{r:4}}/>
                      <Line dataKey="opGrowth"  name="영업이익 YoY%" stroke={C.green} strokeWidth={2} dot={{r:4}}/>
                    </ComposedChart>
                  </CW>
                  <ST accent={C.gold} right="%">OPM · ROE · ROA</ST>
                  <CW h={190}>
                    <ComposedChart data={data} margin={{top:4,right:10,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp("%")}/>
                      <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                      <Line dataKey="opm" name="OPM%" stroke={C.gold}  strokeWidth={2} dot={{r:3}}/>
                      <Line dataKey="roe" name="ROE%" stroke={C.green} strokeWidth={2} dot={{r:3}}/>
                      <Line dataKey="roa" name="ROA%" stroke={C.blueL} strokeWidth={2} dot={{r:3}}/>
                    </ComposedChart>
                  </CW>
                  {/* 수정 3: 현금흐름 — 막대 4개 + 0선 점선 */}
                  <ST accent={C.cyan} right="억원">현금흐름 (0선 기준)</ST>
                  <CW h={210}>
                    <ComposedChart data={data} margin={{top:4,right:10,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp("억")}/>
                      <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                      <ReferenceLine y={0} stroke={C.muted} strokeDasharray="4 3"/>
                      <Bar dataKey="cfo" name="영업CF" fill={C.teal}   opacity={0.85} maxBarSize={18}/>
                      <Bar dataKey="cfi" name="투자CF" fill={C.red}    opacity={0.7}  maxBarSize={18}/>
                      <Bar dataKey="cff" name="재무CF" fill={C.purple} opacity={0.65} maxBarSize={18}/>
                      <Bar dataKey="fcf" name="FCF"    fill={C.gold}   opacity={0.9}  maxBarSize={18} radius={[3,3,0,0]}/>
                    </ComposedChart>
                  </CW>
                  {/* EPS · FCF · 주가 동행 */}
                  {epsPriceData.length>=2&&(
                    <>
                      <ST accent={C.purple} right="EPS/FCF 좌축 · 주가 우축">EPS · FCF · 주가 동행 추이</ST>
                      <CW h={240}>
                        <ComposedChart data={epsPriceData} margin={{top:4,right:44,left:0,bottom:8}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                          <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                          <YAxis yAxisId="left"  {...yp("",44)}/>
                          <YAxis yAxisId="right" orientation="right" {...yp("원",52)} tickFormatter={v=>v.toLocaleString()}/>
                          <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                          <Bar  yAxisId="left"  dataKey="eps" name="EPS(원)" fill={C.purple} opacity={0.7} maxBarSize={20}/>
                          <Bar  yAxisId="left"  dataKey="fcf" name="FCF(억)" fill={C.teal}   opacity={0.6} maxBarSize={20}/>
                          <Line yAxisId="right" dataKey="price" name="주가(원)" stroke={C.gold} strokeWidth={2.5} dot={{r:4,fill:C.gold}}/>
                        </ComposedChart>
                      </CW>
                    </>
                  )}
                </>
              );
            })():(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>📂 엑셀 업로드 후 표시됩니다.</div></Box>
            )}
          </div>
        )}

        {/* ════ 기술분석 ════ */}
        {tab==="technical"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <div style={{background:`${C.teal}11`,border:`1px solid ${C.teal}33`,borderRadius:9,padding:"8px 12px",marginBottom:10,fontSize:10,color:C.muted}}>
              <span style={{color:C.green}}>G1 무릎</span> 200일MA / <span style={{color:C.blueL}}>G2 허벅지</span> 60MA+10% / <span style={{color:C.orange}}>G3 어깨</span> 60MA+25% / <span style={{color:C.red}}>G4 상투</span> 볼린저(2σ)
            </div>
            <ST accent={C.gold}>G1·G2·G3·G4 밴드</ST>
            <CW h={270}>
              <ComposedChart data={withG} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                <Line dataKey="price" name="주가"    stroke={C.blue}   strokeWidth={2.5} dot={false}/>
                <Line dataKey="g1" name="G1 무릎"   stroke={C.green}  strokeWidth={1.5} dot={false} strokeDasharray="4 2"/>
                <Line dataKey="g2" name="G2 허벅지" stroke={C.blueL}  strokeWidth={1.5} dot={false} strokeDasharray="3 2"/>
                <Line dataKey="g3" name="G3 어깨"   stroke={C.orange} strokeWidth={1.5} dot={false} strokeDasharray="3 2"/>
                <Line dataKey="g4" name="G4 상투"   stroke={C.red}    strokeWidth={1.5} dot={false} strokeDasharray="2 2"/>
              </ComposedChart>
            </CW>
            <ST accent={C.blue}>주가 & 60MA</ST>
            <CW h={240}>
              <ComposedChart data={withMA60} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                <Area dataKey="price" name="주가" stroke={C.blue} strokeWidth={2} fill={`${C.blue}18`} dot={false}/>
                <Line dataKey="ma60" name="60MA" stroke={C.gold} strokeWidth={2} dot={false} strokeDasharray="5 3"/>
              </ComposedChart>
            </CW>
            <ST accent={C.green}>RSI (14개월)</ST>
            <CW h={148}>
              <ComposedChart data={withRSI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={70} y2={100} fill={`${C.red}12`}/><ReferenceArea y1={0} y2={30} fill={`${C.green}12`}/>
                <ReferenceLine y={70} stroke={C.red}   strokeDasharray="4 2" label={{value:"과매수70",fill:C.red,  fontSize:9}}/>
                <ReferenceLine y={30} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도30",fill:C.green,fontSize:9}}/>
                <Area dataKey="rsi" name="RSI(%)" stroke={C.green} strokeWidth={2} fill={`${C.green}18`} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.blueL}>MACD</ST>
            <CW h={148}>
              <ComposedChart data={withMACD} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("",38)}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceLine y={0} stroke={C.dim}/>
                <Bar dataKey="hist" name="히스토그램" maxBarSize={6} radius={[2,2,0,0]} fill={C.blueL} fillOpacity={0.65}/>
                <Line dataKey="macd"   name="MACD"   stroke={C.blueL}  strokeWidth={2}   dot={false}/>
                <Line dataKey="signal" name="Signal" stroke={C.orange} strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.teal}>OBV</ST>
            <CW h={128}>
              <AreaChart data={withOBV} margin={{top:4,right:10,left:0,bottom:8}}>
                <defs><linearGradient id="obvG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.teal} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.teal} stopOpacity={0}/>
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("",44)} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/>
                <Tooltip content={<MTip/>}/>
                <Area dataKey="obv" name="OBV" stroke={C.teal} strokeWidth={2} fill="url(#obvG)" dot={false}/>
              </AreaChart>
            </CW>
            <ST accent={C.pink}>MFI</ST>
            <CW h={128}>
              <ComposedChart data={withMFI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={80} y2={100} fill={`${C.red}12`}/><ReferenceArea y1={0} y2={20} fill={`${C.green}12`}/>
                <ReferenceLine y={80} stroke={C.red}   strokeDasharray="4 2" label={{value:"과열80",  fill:C.red,  fontSize:9}}/>
                <ReferenceLine y={20} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도20",fill:C.green,fontSize:9}}/>
                <Area dataKey="mfi" name="MFI(%)" stroke={C.pink} strokeWidth={2} fill={`${C.pink}18`} dot={false}/>
              </ComposedChart>
            </CW>
          </div>
        )}

        {/* ════ 가치평가 ════ */}
        {tab==="valuation"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <Box>
              <ST accent={C.gold}>📐 DCF 파라미터 설정</ST>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:12}}>
                {[
                  {key:"bondYield",label:"국고채 금리(%)",min:0,max:10,step:0.1},
                  {key:"riskPrem", label:"리스크 프리미엄(%)",min:0,max:10,step:0.5},
                  {key:"gr",       label:"기업 성장률(%)",min:0,max:30,step:0.5},
                  {key:"reqReturn",label:"요구수익률(%)",min:1,max:20,step:0.5},
                ].map(f=>(
                  <div key={f.key}>
                    <div style={{color:C.muted,fontSize:10,marginBottom:4}}>{f.label}</div>
                    <input type="number" min={f.min} max={f.max} step={f.step}
                      value={dcfDraft[f.key]}
                      onChange={e=>setDcfDraft(p=>({...p,[f.key]:+e.target.value}))}
                      style={{width:"100%",background:C.card2,color:C.text,border:`1px solid ${C.border}`,
                        borderRadius:6,padding:"5px 8px",fontSize:12,outline:"none",fontFamily:"monospace",boxSizing:"border-box"}}/>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{color:C.muted,fontSize:11}}>
                  할인율: <span style={{color:C.gold,fontWeight:700}}>{(dcfApplied.bondYield+dcfApplied.riskPrem).toFixed(1)}%</span>
                </div>
                <button onClick={()=>setDcfApplied({...dcfDraft})}
                  style={{background:`linear-gradient(135deg,${C.blue},${C.blueL})`,color:"#fff",
                    border:"none",borderRadius:8,padding:"7px 18px",fontSize:12,cursor:"pointer",fontWeight:700}}>
                  ⚡ DCF 재계산 적용
                </button>
              </div>
            </Box>
            <Box style={{border:`2px solid ${C.gold}33`}}>
              <ST accent={C.gold}>3가지 내재가치 교차검증 ({lastAnn.year||"—"}년 기준)</ST>
              {hasFinData?(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:12}}>
                    {[
                      {label:"A. DCF (금리기반)",sub:`할인율 ${(dcfApplied.bondYield+dcfApplied.riskPrem).toFixed(1)}% · 성장률 ${dcfApplied.gr}%`,val:dcfResults.a,color:C.blue},
                      {label:"B. 그레이엄 멀티플",sub:`V=EPS×(8.5+2g)×4.4/Y`,val:dcfResults.b,color:C.purple},
                      {label:"C. ROE 멀티플",sub:`적정가=ROE×EPS (적정PER=ROE)`,val:dcfResults.c,color:C.teal},
                      {label:"3가지 평균",sub:"교차검증 종합",val:dcfResults.avg,color:C.gold},
                    ].map(item=>{
                      const diff=price&&item.val?Math.round((item.val/price-1)*100):null;
                      return(
                        <div key={item.label} style={{background:C.card2,borderRadius:10,padding:"10px 12px",border:`1px solid ${item.color}33`}}>
                          <div style={{color:item.color,fontSize:10,fontWeight:700,marginBottom:2}}>{item.label}</div>
                          <div style={{color:C.muted,fontSize:8,marginBottom:6,lineHeight:1.4}}>{item.sub}</div>
                          <div style={{fontSize:16,fontWeight:900,color:item.color,fontFamily:"monospace"}}>{item.val?item.val.toLocaleString()+"원":"—"}</div>
                          {diff!==null&&<div style={{marginTop:4}}><Tag color={diff>=0?C.green:C.red} size={9}>{diff>=0?"저평가":"고평가"} {Math.abs(diff)}%</Tag></div>}
                        </div>
                      );
                    })}
                  </div>
                  {dcfHistory.length>=2&&(
                    <>
                      <ST accent={C.gold} right="참고용">연도별 DCF 추이</ST>
                      <CW h={190}>
                        <ComposedChart data={dcfHistory} margin={{top:4,right:10,left:0,bottom:8}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                          <XAxis dataKey="year" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                          <YAxis yAxisId="left"  {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                          <YAxis yAxisId="right" orientation="right" {...yp("억",40)}/>
                          <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                          <Bar yAxisId="right" dataKey="fcf" name="FCF(억)" fill={C.teal} opacity={0.6} maxBarSize={32}/>
                          <Line yAxisId="left" dataKey="intrinsic" name="DCF 내재가치" stroke={C.gold} strokeWidth={2.5} dot={{r:4,fill:C.gold}}/>
                          {price>0&&<ReferenceLine yAxisId="left" y={price} stroke={C.blueL} strokeDasharray="4 2"
                            label={{value:`현재가 ${price.toLocaleString()}원`,fill:C.blueL,fontSize:9,position:"insideTopRight"}}/>}
                        </ComposedChart>
                      </CW>
                    </>
                  )}
                </>
              ):(
                <div style={{color:C.muted,textAlign:"center",padding:20,fontSize:12}}>📂 엑셀 업로드 후 DCF 계산이 표시됩니다.</div>
              )}
            </Box>
          </div>
        )}

        {/* ════ 안정성 ════ */}
        {tab==="stability"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {hasFinData?(()=>{
              const data=stabView==="연간"?annTimeline:qtrTimeline;
              return(
                <>
                  <ViewToggle view={stabView} setView={setStabView}/>
                  <ST accent={C.teal}>부채비율(우축) · 자본유보율(좌축)</ST>
                  <CW h={220}>
                    <ComposedChart data={data} margin={{top:4,right:44,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis yAxisId="left"  {...yp("%",44)}/><YAxis yAxisId="right" orientation="right" {...yp("%",44)}/>
                      <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                      <ReferenceLine yAxisId="right" y={100} stroke={C.orange} strokeDasharray="4 2" label={{value:"부채100%",fill:C.orange,fontSize:9}}/>
                      <Bar  yAxisId="right" dataKey="debt"     name="부채비율%"   fill={C.red}  opacity={0.65} maxBarSize={24}/>
                      <Line yAxisId="left"  dataKey="retained" name="자본유보율%" stroke={C.teal} strokeWidth={2} dot={{r:3}}/>
                    </ComposedChart>
                  </CW>
                  <ST accent={C.green}>자산·부채·자본 (억원)</ST>
                  <CW h={210}>
                    <ComposedChart data={data} margin={{top:4,right:10,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp("억")}/>
                      <Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="assets" name="자산총계" fill={C.blue}  opacity={0.6} maxBarSize={24}/>
                      <Bar dataKey="liab"   name="부채총계" fill={C.red}   opacity={0.6} maxBarSize={24}/>
                      <Bar dataKey="equity" name="자본총계" fill={C.green} opacity={0.7} maxBarSize={24}/>
                    </ComposedChart>
                  </CW>
                </>
              );
            })():(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>📂 엑셀 업로드 후 표시됩니다.</div></Box>
            )}
          </div>
        )}

        {/* ════ 배당 ════ */}
        {tab==="dividend"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {co?.divData?.length?(
              <>
                <ST accent={C.gold}>배당금 (DPS) 추이</ST>
                <CW h={200}>
                  <ComposedChart data={co.divData} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={{stroke:C.border}}/>
                    <YAxis {...yp("원")}/><Tooltip content={<MTip/>}/>
                    <Bar dataKey="dps" name="DPS(원)" fill={C.gold} opacity={0.8} maxBarSize={40} radius={[4,4,0,0]}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.green}>배당수익률 · 배당성향</ST>
                <CW h={180}>
                  <ComposedChart data={co.divData} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={{stroke:C.border}}/>
                    <YAxis {...yp("%")}/><Tooltip content={<MTip/>}/><Legend wrapperStyle={{fontSize:10}}/>
                    <Line dataKey="divYield"  name="배당수익률%" stroke={C.green}  strokeWidth={2} dot={{r:4}}/>
                    <Line dataKey="divPayout" name="배당성향%"   stroke={C.purple} strokeWidth={2} dot={{r:4}}/>
                  </ComposedChart>
                </CW>
              </>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20,fontSize:12}}>
                💸 배당 데이터 없음<br/><span style={{fontSize:10}}>③배당 시트에 네이버 배당 탭을 붙여넣으세요.</span>
              </div></Box>
            )}
          </div>
        )}

        {/* ════ 8거장 ════ */}
        {tab==="masters"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* 수정 6: 재무데이터 없으면 업로드 안내 */}
            {!hasFinData?(
              <Box><div style={{color:C.muted,textAlign:"center",padding:24,lineHeight:1.8,fontSize:12}}>
                👑 8인의 거장 판정을 위해<br/><b style={{color:C.gold}}>엑셀 재무자료를 업로드</b>해주세요.<br/>
                <span style={{fontSize:10}}>파일명: 179290_엠아이텍.xlsx 형식</span>
              </div></Box>
            ):masterJudge.length?(()=>{
              const passCount=masterJudge.filter(m=>m.calc.verdict==="추천").length;
              const consensus=passCount>=5?"강력매수":passCount>=3?"중립":"관망";
              const cc=passCount>=5?C.green:passCount>=3?C.gold:C.red;
              return(
                <>
                  <div style={{background:`linear-gradient(135deg,${cc}18,${C.card2})`,border:`2px solid ${cc}55`,borderRadius:14,padding:"12px 14px",marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{color:C.muted,fontSize:9,letterSpacing:"0.1em",marginBottom:2}}>👑 8인의 거장 컨센서스</div>
                        <div style={{fontSize:18,fontWeight:900,color:cc,fontFamily:"monospace"}}>SEQUOIA: {consensus}</div>
                        <div style={{color:C.muted,fontSize:10,marginTop:3}}>※ 알고리즘 판정 · 투자 참고용</div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {[{l:"✅",v:"추천",c:C.green},{l:"⚖️",v:"중립",c:C.gold},{l:"❌",v:"비추천",c:C.red}].map(s=>(
                          <div key={s.l} style={{background:C.bg,borderRadius:7,padding:"5px 10px",textAlign:"center"}}>
                            <span style={{color:s.c,fontSize:14,fontWeight:900,fontFamily:"monospace"}}>{masterJudge.filter(m=>m.calc.verdict===s.v).length}</span>
                            <span style={{color:C.muted,fontSize:9,marginLeft:3}}>{s.l}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:2,marginTop:8}}>
                      {masterJudge.map((m,i)=><div key={i} style={{flex:1,height:22,borderRadius:3,background:m.calc.color,opacity:0.8}}/>)}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:7}}>
                    {masterJudge.map((m,i)=>(
                      <div key={i} style={{background:C.card,border:`1.5px solid ${m.calc.color}44`,borderTop:`3px solid ${m.calc.color}`,borderRadius:10,padding:"9px",position:"relative"}}>
                        <div style={{position:"absolute",top:7,right:7,fontSize:13}}>{m.calc.icon}</div>
                        <div style={{color:m.calc.color,fontSize:11,fontWeight:800,marginBottom:1}}>{m.ko}</div>
                        <div style={{color:C.muted,fontSize:8,marginBottom:4,lineHeight:1.3}}>{m.style}</div>
                        <div style={{display:"inline-block",background:`${m.calc.color}22`,color:m.calc.color,fontSize:10,fontWeight:900,padding:"1px 6px",borderRadius:3,marginBottom:5}}>{m.calc.verdict}</div>
                        <div style={{color:C.muted,fontSize:7.5,lineHeight:1.5,marginBottom:5,minHeight:24}}>{m.calc.reason}</div>
                        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:4}}>
                          {m.detail.map((d,j)=>(<div key={j} style={{display:"flex",justifyContent:"space-between",marginBottom:1}}>
                            <span style={{color:C.muted,fontSize:8}}>{d.k}</span>
                            <span style={{color:C.text,fontSize:8,fontFamily:"monospace",fontWeight:700}}>{d.v}</span>
                          </div>))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })():(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20,fontSize:12}}>주가 데이터 로딩 후 판정이 표시됩니다.</div></Box>
            )}
          </div>
        )}

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
          padding:"8px 12px",display:"flex",justifyContent:"space-between",
          alignItems:"center",flexWrap:"wrap",gap:4,marginTop:12}}>
          <div style={{color:C.gold,fontSize:11,fontWeight:700}}>🌲 SEQUOIA v3.1</div>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            <Tag color={C.blue}  size={8}>주가:키움REST</Tag>
            <Tag color={C.green} size={8}>재무:엑셀입력</Tag>
            <Tag color={C.purple} size={8}>DB:Supabase</Tag>
            <Tag color={C.gold}  size={8}>투자참고용</Tag>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px;}
        *{-webkit-tap-highlight-color:transparent;}
      `}</style>
    </div>
  );
}
