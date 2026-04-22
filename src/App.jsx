import { useState, useEffect, useMemo, useRef } from "react";
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
// 1. 엔진
// ══════════════════════════════════════════════════════════════
const PROXY="https://api.allorigins.win/raw?url=";

const fetchYahoo=async(ticker,market="KQ")=>{
  try{
    const sfx=market==="KS"?".KS":".KQ";
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}${sfx}?interval=1mo&range=10y`;
    const r=await fetch(PROXY+encodeURIComponent(url));
    const d=await r.json();
    const chart=d?.chart?.result?.[0];
    if(!chart)return null;
    const ts=chart.timestamp||[],q=chart.indicators.quote[0];
    const monthly=ts.map((t,i)=>{
      const dt=new Date(t*1000);
      return{ts:t,label:`${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,"0")}`,
        year:dt.getFullYear(),month:dt.getMonth()+1,
        price:Math.round(q.close[i]||0),open:Math.round(q.open[i]||0),
        high:Math.round(q.high[i]||0),low:Math.round(q.low[i]||0),volume:q.volume[i]||0};
    }).filter(d=>d.price>0);
    const cur=Math.round(chart.meta?.regularMarketPrice||q.close[q.close.length-1]||0);
    const prv=Math.round(chart.meta?.chartPreviousClose||0);
    return{monthly,currentPrice:cur,prevClose:prv,change:cur-prv,
      changePct:prv?+((cur-prv)/prv*100).toFixed(2):0};
  }catch{return null;}
};

const ema=(arr,n)=>{const k=2/(n+1);let e=arr[0];return arr.map((v,i)=>{if(i===0)return e;e=v*k+e*(1-k);return+e.toFixed(0);});};

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

// PER/PBR 밴드 — 분기 데이터 기반
const buildBandsFromQtr=(monthly,qtrData,annData)=>{
  if(!monthly.length)return monthly;
  // 분기 데이터가 있으면 분기 우선, 없으면 연간 보간
  const epsMap={},bpsMap={};
  // 연간 먼저
  (annData||[]).forEach(r=>{epsMap[`${r.year}.12`]=r.eps;bpsMap[`${r.year}.12`]=r.bps;});
  // 분기로 덮어씌움 (더 세밀)
  (qtrData||[]).forEach(r=>{
    if(r.eps){const mo=String(r.month||((r.quarter||1)*3)).padStart(2,"0");epsMap[`${r.year}.${mo}`]=r.eps;}
    if(r.bps){const mo=String(r.month||((r.quarter||1)*3)).padStart(2,"0");bpsMap[`${r.year}.${mo}`]=r.bps;}
  });

  const allKeys=Object.keys(epsMap).sort();
  const interp=(label,map)=>{
    const keys=Object.keys(map).sort();
    if(!keys.length)return 0;
    // label: "2024.03"
    const [yr,mo]=label.split(".").map(Number);
    const val=yr*12+(mo||6);
    let k0=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)<=val;}).slice(-1)[0];
    let k1=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)>val;})[0];
    if(!k0)k0=keys[0];
    if(!k1)return map[k0]||0;
    const[y0,m0]=k0.split(".").map(Number),[y1,m1]=k1.split(".").map(Number);
    const v0=map[k0],v1=map[k1];
    const t=(val-(y0*12+(m0||6)))/((y1*12+(m1||6))-(y0*12+(m0||6)));
    return v0+(v1-v0)*t;
  };
  return monthly.map(d=>({...d,
    perLo:Math.round(interp(d.label,epsMap)*7),
    perHi:Math.round(interp(d.label,epsMap)*20),
    perMid:Math.round(interp(d.label,epsMap)*13),
    pbrLo:Math.round(interp(d.label,bpsMap)*1.0),
    pbrHi:Math.round(interp(d.label,bpsMap)*3.5),
  }));
};

// DCF — 단일 연도
const calcDCF=({fcf,gr=0.08,tg=0.03,dr=0.10,shares})=>{
  if(!fcf||!shares)return{intrinsic:0};
  let pv=0,cf=fcf;
  for(let y=1;y<=10;y++){cf*=(1+gr);pv+=cf/Math.pow(1+dr,y);}
  const tvPV=(cf*(1+tg)/(dr-tg))/Math.pow(1+dr,10);
  return{intrinsic:+((pv+tvPV)/shares).toFixed(0)};
};

// DCF 연도별 테이블 (참고용 5개년)
const buildDCFHistory=(annData)=>{
  if(!annData?.length)return[];
  return annData.filter(r=>r.fcf&&r.shares&&r.year).map(r=>{
    const v=calcDCF({fcf:r.fcf,shares:r.shares/1e8});
    return{year:r.year,fcf:r.fcf,intrinsic:v.intrinsic};
  });
};

const calcFScore=(annData)=>{
  if(!annData||annData.length<2)return{items:[],total:0};
  const cur=annData[annData.length-1],prv=annData[annData.length-2];
  const safe=(fn)=>{try{return fn();}catch{return 0;}};
  const items=[
    {name:"ROA > 0",val:cur.roa>0?1:0,desc:"수익성"},
    {name:"ΔROA > 0",val:(cur.roa-prv.roa)>0?1:0,desc:"수익 개선"},
    {name:"CFO > 0",val:(cur.cfo||0)>0?1:0,desc:"영업현금"},
    {name:"발생액 < 0",val:safe(()=>(cur.net/cur.assets-cur.cfo/cur.assets)<0?1:0),desc:"이익 질"},
    {name:"레버리지 감소",val:(cur.debt||0)<(prv.debt||0)?1:0,desc:"재무안정"},
    {name:"유동성 개선",val:1,desc:"유동성"},
    {name:"주식 미발행",val:(cur.shares||0)<=(prv.shares||0)?1:0,desc:"희석 없음"},
    {name:"매출총이익률 ↑",val:(cur.opm||0)>(prv.opm||0)?1:0,desc:"경쟁력"},
    {name:"자산회전율 ↑",val:safe(()=>cur.rev/cur.assets>prv.rev/prv.assets?1:0),desc:"효율성"},
  ];
  return{items,total:items.reduce((s,x)=>s+x.val,0)};
};

// 매수/매도 신호 포인트 생성
const calcSignalPoints=(withMA60Data)=>{
  const pts=[];
  withMA60Data.forEach((d,i)=>{
    if(d.gap60===null||d.ma60===null)return;
    const prev=i>0?withMA60Data[i-1]:null;
    if(!prev||prev.gap60===null)return;
    // 적극매수: gap60이 -20% 이하로 진입
    if(prev.gap60>-20&&d.gap60<=-20){
      pts.push({label:d.label,price:d.price,type:"강력매수",color:"#00C878",arrow:"▲"});
    }
    // 매수: 0% 이하로 진입
    else if(prev.gap60>0&&d.gap60<=0){
      pts.push({label:d.label,price:d.price,type:"매수",color:"#10A898",arrow:"▲"});
    }
    // 매도: +150% 이상으로 진입
    else if(prev.gap60<150&&d.gap60>=150){
      pts.push({label:d.label,price:d.price,type:"매도",color:"#FF7830",arrow:"▼"});
    }
    // 적극매도: +300% 이상으로 진입
    else if(prev.gap60<300&&d.gap60>=300){
      pts.push({label:d.label,price:d.price,type:"강력매도",color:"#FF3D5A",arrow:"▼"});
    }
  });
  return pts;
};

// ══════════════════════════════════════════════════════════════
// 2. 엑셀 파서
// ══════════════════════════════════════════════════════════════
const FIELD_MAP={
  "매출액":"rev","영업이익":"op","당기순이익":"net",
  "영업이익률":"opm","순이익률":"npm",
  "자산총계":"assets","부채총계":"liab","자본총계":"equity",
  "부채비율":"debt","자본유보율":"retained",
  "영업활동현금흐름":"cfo","투자활동현금흐름":"cfi",
  "재무활동현금흐름":"cff","FCF":"fcf",
  "ROE(%)":"roe","ROA(%)":"roa",
  "EPS(원)":"eps","BPS(원)":"bps",
  "PER(배)":"per","PBR(배)":"pbr",
  "발행주식수(보통주)":"shares",
  "현금DPS(원)":"dps","현금배당수익률":"divYield","현금배당성향(%)":"divPayout",
};

const parseSheet=(sheet)=>{
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:""});
  if(!rows.length)return[];
  const isYear=v=>/^20[0-9]{2}/.test(String(v||"").trim());
  let hIdx=-1;
  for(let i=0;i<Math.min(rows.length,8);i++){
    if(rows[i].slice(1).filter(isYear).length>=1){hIdx=i;break;}
  }
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
      const annSheet=find(["연간","①"]),qtrSheet=find(["분기","②"]),divSheet=find(["배당","③"]);
      const annData=annSheet?parseAnn(wb.Sheets[annSheet]):[];
      const qtrData=qtrSheet?parseQtr(wb.Sheets[qtrSheet]):[];
      const divData=divSheet?parseDiv(wb.Sheets[divSheet]):[];
      const fname=file.name.replace(/\.xlsx?$/,"");
      const match=fname.match(/^(\d{6})_(.+)$/);
      resolve({ticker:match?.[1]||"",name:match?.[2]||fname,annData,qtrData,divData});
    }catch(err){reject(err);}
  };
  reader.onerror=reject;
  reader.readAsBinaryString(file);
});

// ══════════════════════════════════════════════════════════════
// 3. 공통 UI
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

// X축 틱 — 월봉용 (Q1/Q2/Q3/Q4 분기 표시, 나머지 숨김)
// 1월=Q1, 4월=Q2, 7월=Q3, 10월=Q4 위치에만 표시
// 연도는 1월 자리에만 표시
const QTick=({x,y,payload,yearOnly})=>{
  if(!payload?.value)return null;
  const parts=payload.value.split(".");
  const yr=parseInt(parts[0]),mo=parseInt(parts[1]||"1");
  const qMap={1:"Q1",4:"Q2",7:"Q3",10:"Q4"};
  const q=qMap[mo];
  if(yearOnly){
    if(mo!==1)return null;
    return(<g transform={`translate(${x},${y+4})`}><text textAnchor="middle" fill={C.muted} fontSize={10} fontFamily="monospace">{yr}</text></g>);
  }
  if(!q)return null; // 분기 기준월이 아니면 아무것도 표시 안 함
  const isQ1=mo===1;
  return(
    <g transform={`translate(${x},${y+2})`}>
      {isQ1&&<text y={0} textAnchor="middle" fill={C.text} fontSize={10} fontWeight={700} fontFamily="monospace">{yr}</text>}
      <text y={isQ1?14:0} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">{q}</text>
    </g>
  );
};

// X축 틱 — 재무 탭용 (연간/분기 텍스트 그대로)
const FinTick=({x,y,payload})=>(
  <g transform={`translate(${x},${y+4})`}>
    <text textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">{payload?.value}</text>
  </g>
);

const MTip=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 11px",fontSize:11,minWidth:120}}>
      <div style={{color:C.gold,fontWeight:700,marginBottom:4,fontFamily:"monospace"}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,marginBottom:2}}>
          <span style={{color:C.muted}}>{p.name}</span>
          <span style={{color:p.color||C.text,fontFamily:"monospace",fontWeight:700}}>
            {typeof p.value==="number"?p.value.toLocaleString():p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const ViewToggle=({view,setView})=>(
  <div style={{display:"flex",gap:4,marginBottom:10}}>
    {["연간","분기"].map(v=>(
      <button key={v} onClick={()=>setView(v)}
        style={{background:view===v?`${C.blue}22`:"transparent",color:view===v?C.blue:C.muted,
          border:`1px solid ${view===v?C.blue:C.border}`,borderRadius:6,
          padding:"4px 14px",fontSize:11,cursor:"pointer",fontWeight:view===v?700:400}}>
        {v}
      </button>
    ))}
  </div>
);

// ══════════════════════════════════════════════════════════════
// 4. 메인 앱
// ══════════════════════════════════════════════════════════════
const LS_KEY="sequoia_stocks_v2";

export default function App(){
  const [darkMode,setDarkMode]=useState(true);
  C=darkMode?DARK:LIGHT;

  const [stocks,setStocks]=useState([]);
  const [activeIdx,setActiveIdx]=useState(0);
  const [tab,setTab]=useState("overview");
  const [rangeIdx,setRangeIdx]=useState(0);
  const [monthly,setMonthly]=useState([]);
  const [priceInfo,setPriceInfo]=useState(null);
  const [priceLoading,setPriceLoading]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [finView,setFinView]=useState("연간");
  const [stabView,setStabView]=useState("연간");
  const fileRef=useRef();

  const RANGES=[{label:"10년",months:120},{label:"5년",months:60},{label:"3년",months:36},{label:"1년",months:12}];

  useEffect(()=>{
    try{const s=localStorage.getItem(LS_KEY);if(s){const p=JSON.parse(s);if(p?.length){setStocks(p);setActiveIdx(0);}}}catch{}
  },[]);
  useEffect(()=>{if(stocks.length)localStorage.setItem(LS_KEY,JSON.stringify(stocks));},[stocks]);

  const co=stocks[activeIdx]||null;

  useEffect(()=>{
    if(!co?.ticker)return;
    setPriceLoading(true);setMonthly([]);setPriceInfo(null);
    const market=["005930","000660","035420","005380","051910"].includes(co.ticker)?"KS":"KQ";
    fetchYahoo(co.ticker,market).then(res=>{
      if(res?.monthly?.length){setMonthly(res.monthly);setPriceInfo(res);}
      setPriceLoading(false);
    });
  },[activeIdx,co?.ticker]);

  const latestLabel=useMemo(()=>{
    const now=new Date(),d=new Date(now.getFullYear(),now.getMonth()-1,1);
    return`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}`;
  },[]);

  const displayMonthly=useMemo(()=>
    monthly.slice(-RANGES[rangeIdx].months).filter(d=>d.label<=latestLabel)
  ,[monthly,rangeIdx,latestLabel]);

  const withMA60  =useMemo(()=>calcMA60(displayMonthly),[displayMonthly]);
  const withBands =useMemo(()=>buildBandsFromQtr(withMA60,co?.qtrData,co?.annData),[withMA60,co?.qtrData,co?.annData]);
  const withG     =useMemo(()=>calcGBands(displayMonthly),[displayMonthly]);
  const withRSI   =useMemo(()=>calcRSI(displayMonthly),[displayMonthly]);
  const withMACD  =useMemo(()=>calcMACD(displayMonthly),[displayMonthly]);
  const withOBV   =useMemo(()=>calcOBV(displayMonthly),[displayMonthly]);
  const withMFI   =useMemo(()=>calcMFI(displayMonthly),[displayMonthly]);
  const signalPts =useMemo(()=>calcSignalPoints(withMA60),[withMA60]);

  const lastGap=withMA60.slice(-1)[0]?.gap60??null;

  // DCF — 가장 최근 연간 기준 고정
  const lastAnn=co?.annData?.slice(-1)?.[0]||{};
  const dcfFixed=useMemo(()=>calcDCF({fcf:lastAnn.fcf,shares:lastAnn.shares?lastAnn.shares/1e8:null})
  ,[lastAnn.fcf,lastAnn.shares]);
  const dcfHistory=useMemo(()=>buildDCFHistory(co?.annData),[co?.annData]);

  // 재무 데이터
  const annTimeline=useMemo(()=>(co?.annData||[]).map(r=>({...r,period:`${r.year}년`})),[co?.annData]);
  const qtrTimeline=useMemo(()=>(co?.qtrData||[]).map(r=>({...r,period:r.label})),[co?.qtrData]);

  // 이격도 신호
  const gapSig=(gap)=>{
    if(gap===null)return{label:"—",color:C.muted};
    if(gap<=-20)return{label:"적극매수",color:C.green};
    if(gap<0)return{label:"매수",color:C.teal};
    if(gap<150)return{label:"관망",color:C.gold};
    if(gap<300)return{label:"매도",color:C.orange};
    return{label:"적극매도",color:C.red};
  };
  const gs=gapSig(lastGap);

  // 스코어
  const scores=useMemo(()=>({
    fin:  Math.min(100,Math.max(0,Math.round(95-(lastAnn.debt||0)*1.5))),
    growth:Math.min(100,Math.max(0,Math.round(65+(lastAnn.roe||0)))),
    stable:Math.min(100,Math.max(0,Math.round(95-(lastAnn.debt||0)*2))),
    value: Math.min(100,Math.max(0,Math.round(100-((priceInfo?.currentPrice||0)/(dcfFixed.intrinsic||1)-1)*80))),
    mom:   Math.min(100,Math.max(0,Math.round(50+(lastGap||0)/4))),
    supply:65,
  }),[lastAnn,priceInfo,dcfFixed,lastGap]);

  const price  =priceInfo?.currentPrice||0;
  const change =priceInfo?.change||0;
  const chgPct =priceInfo?.changePct||0;
  const ma60val=withMA60.slice(-1)[0]?.ma60||0;
  const per    =lastAnn.per||(lastAnn.eps&&price?Math.round(price/lastAnn.eps*10)/10:0);
  const pbr    =lastAnn.pbr||(lastAnn.bps&&price?Math.round(price/lastAnn.bps*100)/100:0);

  // X축 props
  const xp=(yearOnly=false)=>({
    dataKey:"label",height:yearOnly?20:40,
    tick:<QTick yearOnly={yearOnly}/>,
    tickLine:false,axisLine:{stroke:C.border},interval:0,
  });
  const yp=(unit="",w=44)=>({tick:{fill:C.muted,fontSize:11},tickLine:false,axisLine:false,unit,width:w});

  // 업로드
  const handleUpload=async(e)=>{
    const files=Array.from(e.target.files);if(!files.length)return;
    setUploading(true);
    try{
      const results=await Promise.all(files.map(parseExcel));
      setStocks(prev=>{const merged=[...prev];
        results.forEach(res=>{const idx=merged.findIndex(s=>s.ticker===res.ticker);
          if(idx>=0)merged[idx]=res;else merged.push(res);});return merged;});
    }catch(err){alert("엑셀 읽기 실패: "+err.message);}
    setUploading(false);e.target.value="";
  };

  const removeStock=(idx)=>{
    setStocks(prev=>prev.filter((_,i)=>i!==idx));setActiveIdx(0);
    if(stocks.length<=1)localStorage.removeItem(LS_KEY);
  };

  // 9거장
  const masterJudge=useMemo(()=>{
    if(!co||!price)return[];
    const last=co.annData?.slice(-1)?.[0]||{},prev=co.annData?.slice(-2,-1)?.[0]||{};
    const opm=last.opm||0,prevOpm=prev.opm||0,roe=last.roe||0;
    const rev=last.rev||0,prevRev=prev.rev||0,revGrowth=prevRev?Math.round((rev-prevRev)/prevRev*100):0;
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
    const qtrEps=co.qtrData?.slice(-1)?.[0]?.eps||0,prevQtrEps=co.qtrData?.slice(-5,-4)?.[0]?.eps||0;
    const qEpsGrowth=prevQtrEps?Math.round((qtrEps-prevQtrEps)/Math.abs(prevQtrEps)*100):0;
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

  // ── 빈 상태 (수정 6: 타이틀 간소화)
  if(!stocks.length)return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",gap:20,padding:24,textAlign:"center"}}>
      <div style={{color:C.gold,fontSize:28,fontWeight:900,letterSpacing:"0.06em",fontFamily:"monospace"}}>
        🌲 SEQUOIA
      </div>
      <div style={{color:C.muted,fontSize:13,lineHeight:1.8,maxWidth:260}}>
        네이버 재무제표를 엑셀에 붙여넣고<br/>업로드하면 종목이 추가됩니다.
      </div>
      <button onClick={()=>fileRef.current?.click()} style={{
        background:`linear-gradient(135deg,${C.blue},${C.blueL})`,
        color:"#fff",border:"none",borderRadius:12,
        padding:"13px 28px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
        📂 엑셀 파일 업로드
      </button>
      <div style={{color:C.muted,fontSize:10}}>파일명: 179290_엠아이텍.xlsx</div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{display:"none"}} onChange={handleUpload}/>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontSize:13,
      fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>

      {/* ── 헤더 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
        padding:"8px 12px",display:"flex",alignItems:"center",gap:8,
        position:"sticky",top:0,zIndex:100}}>
        <div style={{color:C.gold,fontSize:15,fontWeight:900,fontFamily:"monospace",flexShrink:0}}>🌲</div>
        <div style={{position:"relative",flex:1,minWidth:0}}>
          <select value={activeIdx} onChange={e=>{setActiveIdx(+e.target.value);setTab("overview");}}
            style={{width:"100%",background:C.card2,color:C.text,
              border:`1px solid ${C.blue}`,borderRadius:8,padding:"6px 26px 6px 10px",
              fontSize:13,fontWeight:700,fontFamily:"monospace",cursor:"pointer",
              appearance:"none",WebkitAppearance:"none",outline:"none"}}>
            {stocks.map((s,i)=><option key={i} value={i}>{s.name}　{s.ticker}</option>)}
          </select>
          <div style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",
            pointerEvents:"none",color:C.blue,fontSize:11}}>▼</div>
        </div>
        <button onClick={()=>fileRef.current?.click()} disabled={uploading}
          style={{background:C.blue,color:"#fff",border:"none",borderRadius:7,
            padding:"6px 10px",fontSize:11,cursor:"pointer",fontWeight:700,flexShrink:0}}>
          {uploading?"…":"📂"}
        </button>
        <button onClick={()=>setDarkMode(d=>!d)}
          style={{background:"transparent",color:C.muted,border:`1px solid ${C.border}`,
            borderRadius:7,padding:"6px 8px",fontSize:13,cursor:"pointer",flexShrink:0}}>
          {darkMode?"☀️":"🌙"}
        </button>
        <button onClick={()=>removeStock(activeIdx)}
          style={{background:"transparent",color:C.red,border:`1px solid ${C.red}44`,
            borderRadius:7,padding:"6px 8px",fontSize:11,cursor:"pointer",flexShrink:0}}>🗑</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{display:"none"}} onChange={handleUpload}/>
      </div>

      {/* ── 종목 헤더 */}
      <div style={{background:`linear-gradient(135deg,${C.card2},${C.card})`,
        borderBottom:`1px solid ${C.border}`,padding:"10px 12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:16,fontWeight:900,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{co?.name}</div>
            <div style={{color:C.muted,fontSize:10,marginTop:1}}>{co?.ticker} · 15~20분 지연</div>
          </div>
          {priceLoading?<div style={{color:C.muted,fontSize:11}}>로딩 중...</div>:price>0?(
            <div style={{display:"flex",alignItems:"baseline",gap:6,flexShrink:0}}>
              <div style={{fontSize:20,fontWeight:900,color:C.text,fontFamily:"monospace"}}>{price.toLocaleString()}원</div>
              <div style={{fontSize:12,color:change>=0?C.green:C.red,fontWeight:700}}>
                {change>=0?"+":""}{change.toLocaleString()} ({chgPct>=0?"+":""}{chgPct}%)
              </div>
            </div>
          ):null}
        </div>
        <div style={{display:"flex",gap:6,marginTop:8,overflowX:"auto",paddingBottom:2}}>
          {[
            {k:"PER",v:per?`${per}배`:"—",c:C.gold},
            {k:"PBR",v:pbr?`${pbr}배`:"—",c:C.gold},
            {k:"이격도",v:lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"—",c:gs.color},
            {k:"신호",v:gs.label,c:gs.color},
            {k:`DCF(${lastAnn.year||"—"}년)`,v:dcfFixed.intrinsic?`${dcfFixed.intrinsic.toLocaleString()}원`:"—",c:C.blueL},
          ].map(k=>(
            <div key={k.k} style={{textAlign:"center",background:C.bg,borderRadius:7,padding:"5px 8px",flexShrink:0}}>
              <div style={{color:C.muted,fontSize:9}}>{k.k}</div>
              <div style={{color:k.c,fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 탭 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
        padding:"6px 12px",display:"flex",gap:4,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{background:tab===t.id?C.blue:"transparent",
              color:tab===t.id?"#fff":C.muted,
              border:`1px solid ${tab===t.id?C.blue:C.border}`,
              borderRadius:7,padding:"5px 10px",fontSize:11,
              cursor:"pointer",whiteSpace:"nowrap",fontWeight:tab===t.id?700:400}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 기간 선택 */}
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

      {/* ── 콘텐츠 */}
      <div style={{padding:"12px",maxWidth:900,margin:"0 auto"}}>

        {/* ════ 종합 ════ */}
        {tab==="overview"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <Box>
              <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{width:120,height:120,flexShrink:0}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={[
                      {s:"재무",v:scores.fin},{s:"성장",v:scores.growth},
                      {s:"안정",v:scores.stable},{s:"밸류",v:scores.value},
                      {s:"모멘텀",v:scores.mom},{s:"수급",v:scores.supply},
                    ]}>
                      <PolarGrid stroke={C.border}/>
                      <PolarAngleAxis dataKey="s" tick={{fill:C.muted,fontSize:9}}/>
                      <Radar dataKey="v" stroke={C.gold} fill={C.gold} fillOpacity={0.2} strokeWidth={2}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{flex:1,minWidth:120}}>
                  <div style={{color:C.muted,fontSize:10,marginBottom:2}}>종합 투자 스코어</div>
                  <div style={{fontSize:32,fontWeight:900,color:C.gold,fontFamily:"monospace"}}>
                    {Math.round(Object.values(scores).reduce((s,v)=>s+v,0)/6)}
                  </div>
                  <div style={{color:C.muted,fontSize:9,marginBottom:6}}>/100점</div>
                  {[["재무건전성",scores.fin],["성장성",scores.growth],["안정성",scores.stable],
                    ["밸류",scores.value],["모멘텀",scores.mom],["수급",scores.supply]].map(([k,v])=>(
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
            {lastAnn.rev?(
              <Box>
                <ST accent={C.gold}>최근 연간 재무 요약 ({lastAnn.year}년)</ST>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))",gap:6}}>
                  {[
                    {k:"매출액",v:`${lastAnn.rev}억`,c:C.text},
                    {k:"영업이익",v:`${lastAnn.op}억`,c:C.green},
                    {k:"순이익",v:`${lastAnn.net}억`,c:C.green},
                    {k:"OPM",v:`${lastAnn.opm}%`,c:C.gold},
                    {k:"ROE",v:`${lastAnn.roe}%`,c:C.blueL},
                    {k:"부채비율",v:`${lastAnn.debt}%`,c:(lastAnn.debt||0)>100?C.red:C.teal},
                    {k:"FCF",v:`${lastAnn.fcf}억`,c:C.cyan},
                    {k:"EPS",v:`${(lastAnn.eps||0).toLocaleString()}원`,c:C.purple},
                  ].map(item=>(
                    <div key={item.k} style={{background:C.card2,borderRadius:8,padding:"8px 10px",border:`1px solid ${C.border}`}}>
                      <div style={{color:C.muted,fontSize:9,marginBottom:2}}>{item.k}</div>
                      <div style={{color:item.c,fontSize:13,fontWeight:700,fontFamily:"monospace"}}>{item.v}</div>
                    </div>
                  ))}
                </div>
              </Box>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:"16px 0",fontSize:12}}>📂 엑셀 파일을 업로드하면 재무 데이터가 표시됩니다.</div></Box>
            )}
          </div>
        )}

        {/* ════ 주가·60MA ════ */}
        {tab==="price60"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {lastGap!==null&&(
              <div style={{background:`${gs.color}15`,border:`1px solid ${gs.color}44`,
                borderRadius:9,padding:"8px 13px",marginBottom:10,
                display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                <div style={{color:gs.color,fontWeight:700,fontSize:12}}>
                  60MA 이격도: {lastGap>0?"+":""}{lastGap}%
                </div>
                <Tag color={gs.color} size={11}>{gs.label}</Tag>
                <div style={{color:C.muted,fontSize:9}}>≤-20%:적극매수 / 0%↓:매수 / +150%:매도 / +300%:적극매도</div>
              </div>
            )}
            <ST accent={C.blue} right="화살표: 매수▲ 매도▼ 신호">주가 & 60MA · 매수매도 시점</ST>
            <CW h={320}>
              <ComposedChart data={withMA60} margin={{top:20,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/>
                <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>}/>
                <Legend wrapperStyle={{fontSize:10}}/>
                <Area dataKey="price" name="주가" stroke={C.blue} strokeWidth={2} fill={`${C.blue}18`} dot={false}/>
                <Line dataKey="ma60" name="60MA" stroke={C.gold} strokeWidth={2} dot={false} strokeDasharray="5 3"/>
                {/* 매수/매도 신호 포인트 */}
                {signalPts.map((pt,i)=>(
                  <ReferenceDot key={i} x={pt.label} y={pt.price}
                    r={0}
                    label={{
                      value:pt.arrow,
                      position:pt.arrow==="▲"?"bottom":"top",
                      fill:pt.color,fontSize:16,fontWeight:900,
                    }}/>
                ))}
              </ComposedChart>
            </CW>
            {/* 신호 범례 */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10,fontSize:10,color:C.muted}}>
              {[{c:C.green,t:"▲ 적극매수 (이격도≤-20%)"},{c:C.teal,t:"▲ 매수 (이격도<0%)"},{c:C.orange,t:"▼ 매도 (이격도≥+150%)"},{c:C.red,t:"▼ 적극매도 (이격도≥+300%)"}]
                .map((s,i)=><span key={i} style={{color:s.c,fontWeight:700}}>{s.t}</span>)}
            </div>
            <ST accent={C.teal}>60MA 이격도 (%)</ST>
            <CW h={180}>
              <ComposedChart data={withMA60} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/>
                <YAxis {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={-100} y2={-20} fill={`${C.green}10`}/>
                <ReferenceArea y1={150}  y2={500} fill={`${C.red}08`}/>
                <ReferenceLine y={0}   stroke={C.dim}   strokeDasharray="2 2"/>
                <ReferenceLine y={-20} stroke={C.green} strokeDasharray="4 2" label={{value:"적극매수-20%",fill:C.green,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={150} stroke={C.orange} strokeDasharray="4 2" label={{value:"매도+150%",fill:C.orange,fontSize:9,position:"insideTopRight"}}/>
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
                <div style={{background:`${C.blue}11`,border:`1px solid ${C.blue}33`,borderRadius:8,
                  padding:"7px 12px",marginBottom:10,fontSize:10,color:C.muted}}>
                  📊 EPS/BPS: 분기 데이터 우선 적용 → 연간 보간으로 밴드 생성
                </div>
                <ST accent={C.purple}>PER 밴드 (7배·13배·20배)</ST>
                <CW h={270}>
                  <ComposedChart data={withBands} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(rangeIdx===0)}/>
                    <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>}/>
                    <Area dataKey="perHi"  name="PER 20배" stroke={C.red}   fill={`${C.red}10`}   strokeWidth={1} dot={false}/>
                    <Area dataKey="perMid" name="PER 13배" stroke={C.gold}  fill={`${C.gold}08`}  strokeWidth={1} dot={false}/>
                    <Area dataKey="perLo"  name="PER 7배"  stroke={C.green} fill={`${C.green}10`} strokeWidth={1} dot={false}/>
                    <Line dataKey="price"  name="주가"     stroke={C.blueL} strokeWidth={2.5}     dot={false}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.cyan}>PBR 밴드 (1배·3.5배)</ST>
                <CW h={240}>
                  <ComposedChart data={withBands} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(rangeIdx===0)}/>
                    <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>}/>
                    <Area dataKey="pbrHi" name="PBR 3.5배" stroke={C.red}   fill={`${C.red}10`}   strokeWidth={1} dot={false}/>
                    <Area dataKey="pbrLo" name="PBR 1배"   stroke={C.green} fill={`${C.green}10`} strokeWidth={1} dot={false}/>
                    <Line dataKey="price" name="주가"       stroke={C.blueL} strokeWidth={2.5}    dot={false}/>
                  </ComposedChart>
                </CW>
              </>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>엑셀 업로드 후 표시됩니다.</div></Box>
            )}
          </div>
        )}

        {/* ════ 재무 ════ */}
        {tab==="financial"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {annTimeline.length||qtrTimeline.length?(()=>{
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
                      <Tooltip content={<MTip/>}/>
                      <Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="rev" name="매출액"   fill={C.blue}   opacity={0.7} maxBarSize={24}/>
                      <Bar dataKey="op"  name="영업이익" fill={C.green}  opacity={0.8} maxBarSize={24}/>
                      <Bar dataKey="net" name="순이익"   fill={C.purple} opacity={0.7} maxBarSize={24}/>
                    </ComposedChart>
                  </CW>
                  <ST accent={C.gold} right="%">OPM · ROE · ROA</ST>
                  <CW h={200}>
                    <ComposedChart data={data} margin={{top:4,right:10,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp("%")}/>
                      <Tooltip content={<MTip/>}/>
                      <Legend wrapperStyle={{fontSize:10}}/>
                      <Line dataKey="opm" name="OPM%" stroke={C.gold}  strokeWidth={2} dot={{r:3}}/>
                      <Line dataKey="roe" name="ROE%" stroke={C.green} strokeWidth={2} dot={{r:3}}/>
                      <Line dataKey="roa" name="ROA%" stroke={C.blueL} strokeWidth={2} dot={{r:3}}/>
                    </ComposedChart>
                  </CW>
                  <ST accent={C.cyan} right="억원">현금흐름</ST>
                  <CW h={200}>
                    <ComposedChart data={data} margin={{top:4,right:10,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp("억")}/>
                      <Tooltip content={<MTip/>}/>
                      <Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="cfo" name="영업CF" fill={C.teal}  opacity={0.8} maxBarSize={24}/>
                      <Bar dataKey="cfi" name="투자CF" fill={C.red}   opacity={0.6} maxBarSize={24}/>
                      <Line dataKey="fcf" name="FCF"  stroke={C.gold} strokeWidth={2.5} dot={{r:3}}/>
                    </ComposedChart>
                  </CW>
                </>
              );
            })():(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>엑셀 업로드 후 표시됩니다.</div></Box>
            )}
          </div>
        )}

        {/* ════ 기술분석 ════ */}
        {tab==="technical"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            <div style={{background:`${C.teal}11`,border:`1px solid ${C.teal}33`,borderRadius:9,
              padding:"8px 12px",marginBottom:10,fontSize:10,color:C.muted,lineHeight:1.6}}>
              <span style={{color:C.teal,fontWeight:700}}>G-Band</span>　
              <span style={{color:C.green}}>G1 무릎</span> 200일MA /
              <span style={{color:C.blueL}}> G2 허벅지</span> 60MA+10% /
              <span style={{color:C.orange}}> G3 어깨</span> 60MA+25% /
              <span style={{color:C.red}}> G4 상투</span> 볼린저상단(2σ)
            </div>
            <ST accent={C.gold}>G1·G2·G3·G4 밴드</ST>
            <CW h={280}>
              <ComposedChart data={withG} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/>
                <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>}/>
                <Legend wrapperStyle={{fontSize:10}}/>
                <Line dataKey="price" name="주가"    stroke={C.blue}   strokeWidth={2.5} dot={false}/>
                <Line dataKey="g1" name="G1 무릎"   stroke={C.green}  strokeWidth={1.5} dot={false} strokeDasharray="4 2"/>
                <Line dataKey="g2" name="G2 허벅지" stroke={C.blueL}  strokeWidth={1.5} dot={false} strokeDasharray="3 2"/>
                <Line dataKey="g3" name="G3 어깨"   stroke={C.orange} strokeWidth={1.5} dot={false} strokeDasharray="3 2"/>
                <Line dataKey="g4" name="G4 상투"   stroke={C.red}    strokeWidth={1.5} dot={false} strokeDasharray="2 2"/>
              </ComposedChart>
            </CW>
            <ST accent={C.green}>RSI (14개월)</ST>
            <CW h={155}>
              <ComposedChart data={withRSI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/>
                <YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={70} y2={100} fill={`${C.red}12`}/>
                <ReferenceArea y1={0}  y2={30}  fill={`${C.green}12`}/>
                <ReferenceLine y={70} stroke={C.red}   strokeDasharray="4 2" label={{value:"과매수70",fill:C.red,  fontSize:9}}/>
                <ReferenceLine y={30} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도30",fill:C.green,fontSize:9}}/>
                <Area dataKey="rsi" name="RSI(%)" stroke={C.green} strokeWidth={2} fill={`${C.green}18`} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.blueL}>MACD (12·26·9)</ST>
            <CW h={155}>
              <ComposedChart data={withMACD} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/>
                <YAxis {...yp("",38)}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceLine y={0} stroke={C.dim}/>
                <Bar dataKey="hist" name="히스토그램" maxBarSize={6} radius={[2,2,0,0]} fill={C.blueL} fillOpacity={0.65}/>
                <Line dataKey="macd"   name="MACD"   stroke={C.blueL}  strokeWidth={2}   dot={false}/>
                <Line dataKey="signal" name="Signal" stroke={C.orange} strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.teal}>OBV</ST>
            <CW h={135}>
              <AreaChart data={withOBV} margin={{top:4,right:10,left:0,bottom:8}}>
                <defs><linearGradient id="obvG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.teal} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.teal} stopOpacity={0}/>
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/>
                <YAxis {...yp("",44)} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/>
                <Tooltip content={<MTip/>}/>
                <Area dataKey="obv" name="OBV" stroke={C.teal} strokeWidth={2} fill="url(#obvG)" dot={false}/>
              </AreaChart>
            </CW>
            <ST accent={C.pink}>MFI</ST>
            <CW h={135}>
              <ComposedChart data={withMFI} margin={{top:4,right:10,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/>
                <YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>}/>
                <ReferenceArea y1={80} y2={100} fill={`${C.red}12`}/>
                <ReferenceArea y1={0}  y2={20}  fill={`${C.green}12`}/>
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
            {/* 최근 연도 DCF 고정 */}
            <Box style={{border:`2px solid ${dcfFixed.intrinsic&&price&&dcfFixed.intrinsic>price?C.green:C.red}44`}}>
              <div style={{color:C.muted,fontSize:10,marginBottom:6}}>
                📐 DCF 내재가치 — {lastAnn.year||"—"}년 연간 기준
                (FCF {lastAnn.fcf||"—"}억 · 성장률 8% · 할인율 10% · 영구성장 3%)
              </div>
              {dcfFixed.intrinsic>0?(
                <>
                  <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontSize:28,fontWeight:900,color:C.gold,fontFamily:"monospace",lineHeight:1}}>
                        {dcfFixed.intrinsic.toLocaleString()}원
                      </div>
                      {price>0&&(
                        <div style={{marginTop:6}}>
                          <Tag color={dcfFixed.intrinsic>price?C.green:C.red} size={12}>
                            {dcfFixed.intrinsic>price?"저평가":"고평가"} {Math.abs(Math.round((dcfFixed.intrinsic/price-1)*100))}%
                          </Tag>
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {[
                        {k:"현재가",v:`${price.toLocaleString()}원`,c:C.text},
                        {k:"현재 시총",v:`${Math.round(price*(lastAnn.shares||0)/1e8).toLocaleString()}억`,c:C.text},
                        {k:"내재가치 시총",v:`${Math.round(dcfFixed.intrinsic*(lastAnn.shares||0)/1e8).toLocaleString()}억`,c:C.gold},
                      ].map(item=>(
                        <div key={item.k} style={{background:C.bg,borderRadius:8,padding:"6px 10px",textAlign:"center"}}>
                          <div style={{color:C.muted,fontSize:9,marginBottom:2}}>{item.k}</div>
                          <div style={{color:item.c,fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{item.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ):(
                <div style={{color:C.muted,fontSize:12,padding:"8px 0"}}>FCF 및 발행주식수 데이터가 필요합니다.</div>
              )}
            </Box>

            {/* 참고: 5개년 DCF 추이 */}
            {dcfHistory.length>=2&&(
              <Box>
                <ST accent={C.gold} right="참고용 · 동일 가정(g8%·r10%·tg3%) 적용">연도별 DCF 내재가치 추이</ST>
                <CW h={210}>
                  <ComposedChart data={dcfHistory} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                    <YAxis yAxisId="left"  {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <YAxis yAxisId="right" orientation="right" {...yp("억",40)}/>
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:10}}/>
                    <Bar yAxisId="right" dataKey="fcf" name="FCF(억)" fill={C.teal} opacity={0.6} maxBarSize={32}/>
                    <Line yAxisId="left" dataKey="intrinsic" name="DCF 내재가치(원)"
                      stroke={C.gold} strokeWidth={2.5} dot={{r:4,fill:C.gold}}/>
                    {price>0&&<ReferenceLine yAxisId="left" y={price} stroke={C.blueL} strokeDasharray="4 2"
                      label={{value:`현재가 ${price.toLocaleString()}원`,fill:C.blueL,fontSize:9,position:"insideTopRight"}}/>}
                  </ComposedChart>
                </CW>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead>
                      <tr>{["연도","FCF(억)","DCF 내재가치","현재가 대비"].map(h=>(
                        <th key={h} style={{padding:"6px 8px",borderBottom:`1px solid ${C.border}`,
                          color:C.muted,fontWeight:600,textAlign:"center",whiteSpace:"nowrap"}}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {dcfHistory.map((r,i)=>{
                        const diff=price?Math.round((r.intrinsic/price-1)*100):null;
                        return(
                          <tr key={i} style={{borderBottom:`1px solid ${C.border}44`}}>
                            <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",color:C.text,fontWeight:r.year===lastAnn.year?700:400}}>{r.year}{r.year===lastAnn.year?" ★":""}</td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",color:C.teal}}>{r.fcf}</td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",color:C.gold,fontWeight:700}}>{r.intrinsic.toLocaleString()}원</td>
                            <td style={{padding:"6px 8px",textAlign:"center",color:diff===null?"—":diff>=0?C.green:C.red,fontWeight:700}}>
                              {diff===null?"—":`${diff>=0?"+":""}${diff}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Box>
            )}

          </div>
        )}

        {/* ════ 안정성 ════ */}
        {tab==="stability"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {annTimeline.length||qtrTimeline.length?(()=>{
              const data=stabView==="연간"?annTimeline:qtrTimeline;
              return(
                <>
                  <ViewToggle view={stabView} setView={setStabView}/>
                  {/* 수정 2: 부채비율 우측 보조축, 자본유보율 좌측 */}
                  <ST accent={C.teal}>부채비율(우축) · 자본유보율(좌축)</ST>
                  <CW h={220}>
                    <ComposedChart data={data} margin={{top:4,right:44,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis yAxisId="left"  {...yp("%",44)} label={{value:"자본유보율%",angle:-90,position:"insideLeft",fill:C.teal,fontSize:9,dx:-2}}/>
                      <YAxis yAxisId="right" orientation="right" {...yp("%",44)} label={{value:"부채비율%",angle:90,position:"insideRight",fill:C.red,fontSize:9,dx:8}}/>
                      <Tooltip content={<MTip/>}/>
                      <Legend wrapperStyle={{fontSize:10}}/>
                      <ReferenceLine yAxisId="right" y={100} stroke={C.orange} strokeDasharray="4 2"
                        label={{value:"부채100%",fill:C.orange,fontSize:9}}/>
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
                      <Tooltip content={<MTip/>}/>
                      <Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="assets" name="자산총계" fill={C.blue}  opacity={0.6} maxBarSize={24}/>
                      <Bar dataKey="liab"   name="부채총계" fill={C.red}   opacity={0.6} maxBarSize={24}/>
                      <Bar dataKey="equity" name="자본총계" fill={C.green} opacity={0.7} maxBarSize={24}/>
                    </ComposedChart>
                  </CW>
                </>
              );
            })():(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20}}>엑셀 업로드 후 표시됩니다.</div></Box>
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
                    <YAxis {...yp("원")}/>
                    <Tooltip content={<MTip/>}/>
                    <Bar dataKey="dps" name="DPS(원)" fill={C.gold} opacity={0.8} maxBarSize={40} radius={[4,4,0,0]}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.green}>배당수익률 · 배당성향</ST>
                <CW h={180}>
                  <ComposedChart data={co.divData} margin={{top:4,right:10,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={{stroke:C.border}}/>
                    <YAxis {...yp("%")}/>
                    <Tooltip content={<MTip/>}/>
                    <Legend wrapperStyle={{fontSize:10}}/>
                    <Line dataKey="divYield"  name="배당수익률%" stroke={C.green}  strokeWidth={2} dot={{r:4}}/>
                    <Line dataKey="divPayout" name="배당성향%"   stroke={C.purple} strokeWidth={2} dot={{r:4}}/>
                  </ComposedChart>
                </CW>
                <Box>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {[
                      {k:"최근 DPS",v:`${co.divData.slice(-1)[0]?.dps||0}원/주`},
                      {k:"최근 배당수익률",v:`${co.divData.slice(-1)[0]?.divYield||0}%`},
                      {k:"최근 배당성향",v:`${co.divData.slice(-1)[0]?.divPayout||0}%`},
                    ].map(item=>(
                      <div key={item.k} style={{background:C.card2,borderRadius:8,padding:"8px 12px",
                        flex:"1 1 80px",textAlign:"center",border:`1px solid ${C.border}`}}>
                        <div style={{color:C.muted,fontSize:9,marginBottom:2}}>{item.k}</div>
                        <div style={{color:C.gold,fontSize:13,fontWeight:700,fontFamily:"monospace"}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                </Box>
              </>
            ):(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20,lineHeight:1.8,fontSize:12}}>
                💸 배당 데이터 없음<br/><span style={{fontSize:10}}>③배당 시트에 네이버 배당 탭을 붙여넣으세요.</span>
              </div></Box>
            )}
          </div>
        )}

        {/* ════ 9거장 ════ */}
        {tab==="masters"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {masterJudge.length?(()=>{
              const passCount=masterJudge.filter(m=>m.calc.verdict==="추천").length;
              const consensus=passCount>=5?"강력매수":passCount>=3?"중립":"관망";
              const cc=passCount>=5?C.green:passCount>=3?C.gold:C.red;
              return(
                <>
                  <div style={{background:`linear-gradient(135deg,${cc}18,${C.card2})`,
                    border:`2px solid ${cc}55`,borderRadius:14,padding:"12px 14px",marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{color:C.muted,fontSize:9,letterSpacing:"0.1em",marginBottom:2}}>👑 8인의 거장 컨센서스</div>
                        <div style={{fontSize:18,fontWeight:900,color:cc,fontFamily:"monospace"}}>SEQUOIA: {consensus}</div>
                        <div style={{color:C.muted,fontSize:10,marginTop:3}}>※ 알고리즘 판정 · 투자 참고용</div>
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {[{l:"✅",v:"추천",c:C.green},{l:"⚖️",v:"중립",c:C.gold},{l:"❌",v:"비추천",c:C.red}].map(s=>(
                          <div key={s.l} style={{background:C.bg,borderRadius:7,padding:"5px 10px",textAlign:"center"}}>
                            <span style={{color:s.c,fontSize:14,fontWeight:900,fontFamily:"monospace"}}>
                              {masterJudge.filter(m=>m.calc.verdict===s.v).length}
                            </span>
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
                      <div key={i} style={{background:C.card,border:`1.5px solid ${m.calc.color}44`,
                        borderTop:`3px solid ${m.calc.color}`,borderRadius:10,padding:"9px",position:"relative"}}>
                        <div style={{position:"absolute",top:7,right:7,fontSize:13}}>{m.calc.icon}</div>
                        <div style={{color:m.calc.color,fontSize:11,fontWeight:800,marginBottom:1}}>{m.ko}</div>
                        <div style={{color:C.muted,fontSize:8,marginBottom:4,lineHeight:1.3}}>{m.style}</div>
                        <div style={{display:"inline-block",background:`${m.calc.color}22`,color:m.calc.color,
                          fontSize:10,fontWeight:900,padding:"1px 6px",borderRadius:3,marginBottom:5}}>
                          {m.calc.verdict}
                        </div>
                        <div style={{color:C.muted,fontSize:7.5,lineHeight:1.5,marginBottom:5,minHeight:24}}>{m.calc.reason}</div>
                        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:4}}>
                          {m.detail.map((d,j)=>(
                            <div key={j} style={{display:"flex",justifyContent:"space-between",marginBottom:1}}>
                              <span style={{color:C.muted,fontSize:8}}>{d.k}</span>
                              <span style={{color:C.text,fontSize:8,fontFamily:"monospace",fontWeight:700}}>{d.v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })():(
              <Box><div style={{color:C.muted,textAlign:"center",padding:20,fontSize:12}}>재무 데이터를 업로드하면 판정이 표시됩니다.</div></Box>
            )}
          </div>
        )}

        {/* 푸터 */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
          padding:"8px 12px",display:"flex",justifyContent:"space-between",
          alignItems:"center",flexWrap:"wrap",gap:4,marginTop:12}}>
          <div style={{color:C.gold,fontSize:11,fontWeight:700}}>🌲 SEQUOIA v2.2</div>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            <Tag color={C.blue}  size={8}>주가:Yahoo</Tag>
            <Tag color={C.green} size={8}>재무:엑셀입력</Tag>
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
