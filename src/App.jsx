import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  ComposedChart, AreaChart, Area, Bar, Line,
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
const SB_KEY="sb_publishable_m6hqPF2sFbHJDlm5iYtjfQ_WhXBBQSV";
const sbFetch=async(path,opts={})=>{
  const {headers:extraHeaders={},...restOpts}=opts;
  const r=await fetch(`${SB_URL}/rest/v1/${path}`,{
    headers:{"apikey":SB_KEY,"Authorization":`Bearer ${SB_KEY}`,"Content-Type":"application/json","Prefer":"return=representation",...extraHeaders},
    ...restOpts,
  });
  const txt=await r.text();
  return txt?JSON.parse(txt):null;
};
const sbGetStocks=()=>sbFetch("stocks?select=*&order=name");
const sbUpsertStock=(s)=>sbFetch("stocks?on_conflict=ticker",{method:"POST",
  headers:{"Prefer":"resolution=merge-duplicates,return=representation"},
  body:JSON.stringify({ticker:s.ticker,name:s.name,ann_data:s.annData||[],qtr_data:s.qtrData||[],div_data:s.divData||[],updated_at:new Date().toISOString()}),
});
const sbDeleteStock=(ticker)=>sbFetch(`stocks?ticker=eq.${ticker}`,{method:"DELETE"});
const rowToStock=(r)=>({ticker:r.ticker,name:r.name,annData:r.ann_data||[],qtrData:r.qtr_data||[],divData:r.div_data||[]});

// ══════════════════════════════════════════════════════════════
// 2. 주가: 키움 REST API 서버리스 중계 + localStorage 캐시
// ══════════════════════════════════════════════════════════════
const PRICE_CACHE_TTL=60*60*1000;

const fetchPrice=async(ticker,market)=>{
  try{
    const raw=localStorage.getItem(`sq_price_v2_${ticker}`);
    if(raw){const{data,ts}=JSON.parse(raw);if(Date.now()-ts<PRICE_CACHE_TTL&&data?.monthly?.length)return data;}
  }catch{}
  try{
    const mkt=market||"";
    const res=await fetch(`/api/price?ticker=${ticker}${mkt?`&market=${mkt}`:""}`);
    if(!res.ok)throw new Error(`price API ${res.status}`);
    const data=await res.json();
    if(!data?.monthly?.length)return null;
    try{localStorage.setItem(`sq_price_v2_${ticker}`,JSON.stringify({data,ts:Date.now()}));}catch{}
    return data;
  }catch(e){console.warn("[fetchPrice] 실패:",e.message);return null;}
};

// ══════════════════════════════════════════════════════════════
// 3. 기술적 지표
// ══════════════════════════════════════════════════════════════
const ema=(arr,n)=>{const k=2/(n+1);let e=arr[0];return arr.map((v,i)=>{if(i===0)return e;e=v*k+e*(1-k);return+e.toFixed(2);});};

const calcMA60=(monthly)=>{
  const len=monthly.length;
  const N=len>=60?60:len>=15?15:len>=3?len:0;
  if(N===0)return monthly.map(d=>({...d,ma60:null,gap60:null}));
  return monthly.map((d,i)=>{
    if(i<N-1)return{...d,ma60:null,gap60:null};
    const avg=monthly.slice(i-N+1,i+1).reduce((s,x)=>s+x.price,0)/N;
    return{...d,ma60:+avg.toFixed(0),gap60:+((d.price/avg-1)*100).toFixed(2)};
  });
};
const calcMAN=(monthly,N)=>{
  if(!monthly||monthly.length<N)return null;
  const slice=monthly.slice(-N);
  return Math.round(slice.reduce((s,x)=>s+x.price,0)/N);
};
const calc3LineSignal=(monthly, fin={})=>{
  if(!monthly||monthly.length<3)return null;
  const ma60m=monthly.length>=60?calcMAN(monthly,60):null;
  const ma60w=monthly.length>=15?calcMAN(monthly,15):null;
  const ma60d=monthly.length>=3 ?calcMAN(monthly,3) :null;
  const available=[ma60m,ma60w,ma60d].filter(v=>v!==null);
  if(available.length<2)return null;

  const last=monthly[monthly.length-1];
  const gapM=ma60m!=null?+(((last.price/ma60m)-1)*100).toFixed(1):null;
  const gapW=ma60w!=null?+(((last.price/ma60w)-1)*100).toFixed(1):null;
  const gapD=ma60d!=null?+(((last.price/ma60d)-1)*100).toFixed(1):null;

  // 구간 판단 — 차트 밴드 배수 기준
  const toZone=(gap)=>{
    if(gap===null)return null;
    if(gap<=-40)return{label:"VL",zScore:+2,color:"#00C878"};
    if(gap<-20) return{label:"L", zScore:+1,color:"#5BA0FF"};
    if(gap<50)  return{label:"M", zScore: 0,color:"#8AA8C8"};
    if(gap<100) return{label:"H", zScore:-1,color:"#FF7830"};
    if(gap<150) return{label:"VH",zScore:-2,color:"#FF3D5A"};
    return      {label:"EH",zScore:-3,color:"#8855FF"};
  };
  const zm=toZone(gapM),zw=toZone(gapW),zd=toZone(gapD);

// ── 1. 이격도 점수 (QMA 통합 및 에러 방지 로직)
  const pQ = zm != null ? zm.zScore * 3 : 0; // 통합 퀀텀 스코어 (최대 ±9점)
  
  // [에러 해결 핵심] 기존 변수명을 유지하여 하단 합산 로직과의 충돌을 방지합니다.
  const pM = pQ; 
  const pW = 0;
  const pD = 0;
  
  const priceScore = pM + pW + pD; // 최종 점수 산출

  // 가중 최대점수 계산 (데이터 무결성 확인)
  const priceMaxPos = zm != null ? 9 : 0;
  const priceMaxNeg = zm != null ? 9 : 0;

  // ── 2. 배열 및 추세 분석 (QMA 기준 상회/하회 판정)
  let arrangement = "데이터 부족";
  let arrangementColor = DARK.muted;
  let arrangementEn = "none";
  let arrScore = 0;

  if (zm != null) {
    // QMA(기준선) 대비 현재 주가 위치 판정
    const currentPrice = monthly[monthly.length - 1]?.price;
    const baseValue = zm.base;

    if (currentPrice > baseValue) {
      arrangement = "QMA 상회";
      arrangementColor = DARK.green;
      arrangementEn = "bull";
      arrScore = +3;
    } else {
      arrangement = "QMA 하회";
      arrangementColor = DARK.red;
      arrangementEn = "bear";
      arrScore = -3;
    }
  }

  // ── 3. 결손 데이터 알림
  const hasAll = zm !== null;
  const missingLines = zm === null ? ["QMA 데이터 부족"] : [];

  // ── 3. 실적 점수 (재무제표 있을 때만)
  const {
    epsTrend="", fcfTrend="", momentum="",
    profitability="", opm=0, roe=0,
    annData=[], hasFinData=false
  } = fin;

  let epsScore=0,fcfScore=0,momScore=0,profScore=0,roeScore=0;
  let finScoreDetail={};

  if(hasFinData){
    // ① EPS 추세 (±3점)
    if(epsTrend==="개선") epsScore=+3;
    else if(epsTrend==="악화") epsScore=-3;
    else epsScore=0;

    // ② FCF 상태 (±3점)
    if(fcfTrend==="흑자안정") fcfScore=+3;
    else if(fcfTrend==="흑자전환") fcfScore=+1;
    else if(fcfTrend==="적자지속") fcfScore=-3;
    else fcfScore=0;

    // ③ 영업이익 모멘텀 (±2점)
    if(momentum==="성장지속") momScore=+2;
    else if(momentum==="훼손") momScore=-2;
    else momScore=0;

    // ④ 수익성 OPM+ROE (±2점)
    const opmN=opm||0, roeN=roe||0;
    if(opmN>=15&&roeN>=15) profScore=+2;
    else if(opmN>=8||roeN>=10) profScore=+1;
    else profScore=-1;

    // ⑤ 해자 지표: 평균 ROE (±3점) — 버핏 핵심 (3년 이상 데이터 필요)
    const annRoeAll=(annData||[]).filter(r=>r.roe!=null).slice(-10);
    const roeYears=annRoeAll.length;
    const avgRoeAll=roeYears>=3
      ? +(annRoeAll.reduce((s,r)=>s+(r.roe||0),0)/roeYears).toFixed(1)
      : null;
    if(avgRoeAll!==null){
      if(avgRoeAll>=15) roeScore=+3;
      else if(avgRoeAll>=10) roeScore=+1;
      else roeScore=-2;
    }

    finScoreDetail={epsScore,fcfScore,momScore,profScore,roeScore,avgRoeAll,roeYears};
  }

  const finScore=epsScore+fcfScore+momScore+profScore+roeScore;
  // 실적 최대/최저 (있을 때)
  const finMaxPos=hasFinData?13:0;   // 3+3+2+2+3
  const finMaxNeg=hasFinData?-11:0;  // -3-3-2-1-2

  // ── 4. 총점 계산
  const totalScore=priceScore+arrScore+finScore;
  const maxPossible=priceMaxPos+3+(hasFinData?finMaxPos:0);
  const minPossible=-priceMaxNeg-3+(hasFinData?finMaxNeg:0);

  // ── 5. 등급 판정
  // 재무있음: -31~+25, 재무없음: -21~+15 범위
  let grade="",gradeColor="#8AA8C8",gradeIcon="";
  if(hasFinData){
    if(totalScore>=18)     {grade="강력 매수";gradeColor="#00C878";gradeIcon="★★★";}
    else if(totalScore>=10){grade="매수 고려";gradeColor="#5BA0FF";gradeIcon="★★☆";}
    else if(totalScore>=3) {grade="중립 관망";gradeColor="#E8B840";gradeIcon="★☆☆";}
    else if(totalScore>=-4){grade="주의";     gradeColor="#FF7830";gradeIcon="☆☆☆";}
    else if(totalScore>=-12){grade="매도 고려";gradeColor="#FF3D5A";gradeIcon="▼▼☆";}
    else                   {grade="강력 매도";gradeColor="#8855FF";gradeIcon="▼▼▼";}
  } else {
    if(totalScore>=10)     {grade="강력 매수";gradeColor="#00C878";gradeIcon="★★★";}
    else if(totalScore>=4) {grade="매수 고려";gradeColor="#5BA0FF";gradeIcon="★★☆";}
    else if(totalScore>=-3){grade="중립 관망";gradeColor="#E8B840";gradeIcon="★☆☆";}
    else if(totalScore>=-8){grade="주의";     gradeColor="#FF7830";gradeIcon="☆☆☆";}
    else                   {grade="매도 고려";gradeColor="#FF3D5A";gradeIcon="▼▼☆";}
  }

  // ── 6. Verdict 텍스트 (기존 로직 유지 + 등급 연계)
  const bearDir=zm!=null&&zw!=null?(zm.zScore<0&&zw.zScore<0):false;
  const bullDir=zm!=null&&zw!=null?(zm.zScore>0&&zw.zScore>0):false;
  const allNeutral=zm!=null&&zw!=null&&zd!=null&&zm.zScore===0&&zw.zScore===0&&zd.zScore===0;
  const epsGood=epsTrend==="개선", epsBad=epsTrend==="악화";
  const fcfGood=fcfTrend==="흑자안정"||fcfTrend==="흑자전환";
  const fcfBad=fcfTrend==="적자지속";
  const momBad=momentum==="훼손";
  const fundGood=hasFinData&&(epsGood||fcfGood);
  const fundBad=hasFinData&&(epsBad||fcfBad||momBad);

  let verdictTitle="",verdictDesc="";
  const gradeLabel=grade;
  if(allNeutral){
    if(hasFinData){
      if(fundGood){verdictTitle="횡보 중이지만 실적이 받쳐주고 있습니다";verdictDesc="세 시간대 모두 중립 구간입니다.\n실적이 개선 중이라면 추세 전환의 초입일 수 있습니다.";}
      else if(fundBad){verdictTitle="횡보처럼 보이지만 실적이 꺾이고 있습니다";verdictDesc="가격은 중립이지만 펀더멘털이 약화되고 있습니다.\n하락 전 마지막 횡보일 수 있으니 주의하세요.";}
      else{verdictTitle="세 시간대 모두 중립 구간입니다";verdictDesc="급등도 급락도 없는 횡보 구간입니다.\n실적 방향이 주가를 결정할 시기입니다.";}
    } else{verdictTitle="세 시간대 모두 중립 구간입니다";verdictDesc="급등도 급락도 없는 횡보 구간입니다.\n재무제표를 업로드하면 실적까지 연계한 판단이 가능합니다.";}
  } else if(bearDir){
    if(arrangementEn==="bull"){
      if(hasFinData){
        if(fundGood){verdictTitle="추세도 살아있고 가격도 바닥권입니다";verdictDesc="상승 흐름 속에서 눌린 구간입니다.\n실적까지 받쳐주니 가장 확실한 매수 타이밍입니다.";}
        else if(fundBad){verdictTitle="가격은 바닥이지만 실적이 꺾이고 있습니다";verdictDesc="눌림목처럼 보이지만 실적 악화가 원인일 수 있습니다.\n다음 분기 실적 확인 후 진입하세요.";}
        else{verdictTitle="추세도 살아있고 가격도 바닥권입니다";verdictDesc="상승 흐름 속에서 눌린 구간입니다.\n분할 매수를 진지하게 검토할 타이밍입니다.";}
      } else{verdictTitle="추세도 살아있고 가격도 바닥권입니다";verdictDesc="상승 흐름 속에서 눌린 구간입니다.\n분할 매수를 검토할 타이밍입니다.";}
    } else if(arrangementEn==="bear"){
      if(hasFinData){
        if(fundGood){verdictTitle="하락 추세지만 실적이 돌아서고 있습니다";verdictDesc="추세 전환의 초입일 수 있습니다.\n소량 선취매 후 배열 전환을 확인하세요. 역발상 매수 기회입니다.";}
        else if(fundBad){verdictTitle="가격도 추세도 실적도 모두 하락 중입니다";verdictDesc="매수 근거가 없습니다.\n완전 관망하세요.";}
        else{verdictTitle="가격은 바닥이지만 하락 추세 중입니다";verdictDesc="단기 반등일 수 있습니다.\n재무제표를 확인하고 실적이 좋다면 역발상 매수를 고려하세요.";}
      } else{verdictTitle="가격은 바닥이지만 하락 추세 중입니다";verdictDesc="단기 반등일 수 있습니다.\n재무제표를 업로드하면 실적과 연계한 판단이 가능합니다.";}
    } else{verdictTitle="가격은 바닥권이나 배열이 혼재합니다";verdictDesc="확인된 시간대 모두 저점을 가리킵니다.\n분할 매수를 진지하게 검토할 타이밍입니다.";}
  } else if(bullDir){
    if(arrangementEn==="bull"){
      if(hasFinData){
        if(fundBad){verdictTitle="추세는 살아있지만 실적이 꺾이고 있습니다";verdictDesc="주가가 아직 버티고 있을 뿐입니다.\n선제적 비중 축소를 고려할 타이밍입니다.";}
        else if(fundGood){verdictTitle="강한 상승 추세, 지금은 과열 구간입니다";verdictDesc="추세와 실적 모두 좋지만 고점권입니다.\n신규 진입보다 보유 물량 관리에 집중하세요.";}
        else{verdictTitle="강한 상승 추세, 지금은 과열 구간입니다";verdictDesc="추세는 살아있지만 고점권입니다.\n신규 진입보다 보유 물량 관리에 집중하세요.";}
      } else{verdictTitle="강한 상승 추세, 지금은 과열 구간입니다";verdictDesc="추세는 살아있지만 고점권입니다.\n신규 진입보다 보유 물량 관리에 집중하세요.";}
    } else if(arrangementEn==="bear"){
      verdictTitle="하락 추세 속 반등이 고점에 달했습니다";verdictDesc="하락 추세 중 일시 반등이 꼭대기까지 왔습니다.\n매도 또는 관망이 적절합니다.";
    } else{verdictTitle="하루·주·달 모두 꼭대기권입니다";verdictDesc="확인된 시간대 모두 과열을 가리킵니다.\n신규 진입은 위험하고, 보유 중이라면 비중 축소를 고려하세요.";}
  } else if(totalScore<=-1){
    if(hasFinData&&fundBad){verdictTitle="신호가 엇갈리고 실적도 좋지 않습니다";verdictDesc="방향성이 불분명한 상태에서 실적까지 약화되고 있습니다.\n관망을 유지하세요.";}
    else{verdictTitle="단기·중기·장기가 제각각입니다";verdictDesc="지금 가격 위치를 어느 한 시간대로도 단정할 수 없습니다.\n관망이 최선입니다.";}
  } else{
    verdictTitle="신호가 엇갈립니다 — 한 시간대만 다릅니다";verdictDesc="대체로 방향이 맞지만 완전하지 않습니다.\n조금 더 지켜본 후 진입하세요.";
  }

  const verdictColor=gradeColor;
  const borderColor=gradeColor;
  const scoreColor=gradeColor;
  const dimension=hasFinData?"3차원":"2차원";

  // alignScore는 UI 점수 블록용으로 유지 (이격도 방향 일치 수)
  const activeZones=[zm,zw,zd].filter(z=>z!==null);
  const zScores=activeZones.map(z=>z.zScore);
  const allSame=zScores.every(s=>s===zScores[0]);
  const allNegStrict=zScores.every(s=>s<0);
  const allPosStrict=zScores.every(s=>s>0);
  const allNeg2=zScores.every(s=>s<=0);
  const allPos2=zScores.every(s=>s>=0);
  const mxS=activeZones.length;
  let alignScore=0;
  if(allSame)alignScore=mxS;
  else if(allNegStrict||allPosStrict)alignScore=Math.max(1,mxS-1);
  else if(allNeg2||allPos2)alignScore=1;
  else alignScore=0;

  return{
    ma60m,ma60w,ma60d,gapM,gapW,gapD,zm,zw,zd,
    alignScore,maxScore:mxS,hasAll,missingLines,
    arrangement,arrangementColor,arrangementEn,
    // 점수 상세
    priceScore,arrScore,finScore,totalScore,
    pM,pW,pD,
    finScoreDetail,
    maxPossible,minPossible,
    priceMaxPos,finMaxPos,
    // 등급
    grade,gradeColor,gradeIcon,
    // verdict
    verdictTitle,verdictDesc,
    verdictColor,borderColor,scoreColor,
    dimension,
  };
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
// 가격 위치 밴드 — ma60 배수 기반 통일
// 무릎x0.8 / 기준=x1.0 / 어깨x1.5 / 상투x2.0 / 초과열 상단x2.5
const calcPositionBands = (monthly) => {
  if (!monthly || monthly.length === 0) return [];
  return monthly.map((d, i) => {
    // [수정 핵심] 고정된 N이 아니라, 현재 위치(i)까지 가용한 데이터 개수를 유동적으로 결정
    // 최대 60개까지만 보되, 데이터가 적으면 있는 만큼(i + 1)만 계산에 사용합니다.
    const currentWindowSize = Math.min(i + 1, 60);
    // 데이터가 너무 적은 극초반(예: 1~2개월차)만 제외하고 모두 계산
    if (currentWindowSize < 3) {
      return { 
        ...d, 
        bFloor: null, bKnee: null, bBase: null, 
        bShoulder: null, bTop: null, bPeak: null 
      };
    }
    // [수정 핵심] 슬라이스 범위를 i - currentWindowSize + 1로 잡아야 
    // 상장 초기부터 선이 끊기지 않고 부드럽게 이어집니다.
    const window = monthly.slice(i - currentWindowSize + 1, i + 1);
    const sum = window.reduce((s, x) => s + (x.price || 0), 0);
    const ma = sum / window.length;
    return {
      ...d,
      bFloor: Math.round(ma * 0.6),
      bKnee: Math.round(ma * 0.8),
      bBase: Math.round(ma * 1.0),    // 이것이 움직이는 기준선(QMA)
      bShoulder: Math.round(ma * 1.5),
      bTop: Math.round(ma * 2.0),
      bPeak: Math.round(ma * 2.5),
    };
  });
};
const buildBandsFromQtr=(monthly,qtrData,annData,bandCfg)=>{
  if(!monthly.length)return monthly;
  // 연간 데이터: EPS/BPS/PER/PBR 모두 맵으로 저장
  const epsMap={},bpsMap={},perLoMap={},perMidMap={},perHiMap={},pbrLoMap={},pbrMidMap={},pbrHiMap={};
  const ann=annData||[];

  if(bandCfg){
    // ── 수동모드: 사용자가 입력한 배수 × 보간된 EPS/BPS
    ann.forEach(r=>{
      if(r.eps!=null)epsMap[`${r.year}.12`]=r.eps;
      if(r.bps!=null)bpsMap[`${r.year}.12`]=r.bps;
    });
    const interp=(label,map)=>{
      const keys=Object.keys(map).sort();if(!keys.length)return null;
      const [yr,mo]=label.split(".").map(Number),val=yr*12+(mo||6);
      let k0=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)<=val;}).slice(-1)[0];
      let k1=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)>val;})[0];
      if(!k0)return null;
      if(!k1)return map[k0]||0;
      const[y0,m0]=k0.split(".").map(Number),[y1,m1]=k1.split(".").map(Number);
      const t=(val-(y0*12+(m0||6)))/((y1*12+(m1||6))-(y0*12+(m0||6)));
      return (map[k0]||0)+((map[k1]||0)-(map[k0]||0))*t;
    };
    return monthly.map(d=>{
      const eVal=interp(d.label,epsMap);
      const bVal=interp(d.label,bpsMap);
      return{...d,
        perLo :eVal!=null?Math.round(eVal*bandCfg.perLo):null,
        perMid:eVal!=null?Math.round(eVal*bandCfg.perMid):null,
        perHi :eVal!=null?Math.round(eVal*bandCfg.perHi):null,
        pbrLo :bVal!=null?Math.round(bVal*bandCfg.pbrLo):null,
        pbrMid:bVal!=null?Math.round(bVal*bandCfg.pbrMid):null,
        pbrHi :bVal!=null?Math.round(bVal*bandCfg.pbrHi):null,
        _adaptive:bandCfg,
      };
    });
  }

  // ── 자동모드: 연도별 실제 PER/PBR × 해당연도 EPS/BPS
  // 각 연도의 실제 PER(min/mid/max), PBR(min/mid/max)를 연도별로 직접 저장
  // min=해당연도PER, mid=해당연도PER, max=해당연도PER (1개면 동일)
  // 여러 연도 데이터로 연도별 Lo/Mid/Hi 밴드를 구성:
  // ── 1단계: 기본 유효 데이터 (EPS/BPS 있고 명백한 이상치 제거)
  const rawValidPer=ann.filter(r=>r.per>0&&r.per<200&&r.eps!=null&&r.eps>0);
  const rawValidPbr=ann.filter(r=>r.pbr>0&&r.pbr<30&&r.bps!=null&&r.bps>0);

  // ── 2단계: 중앙값 먼저 산출
  const medOf=(arr,fn)=>{const s=[...arr].sort((a,b)=>fn(a)-fn(b));return s.length?fn(s[Math.floor((s.length-1)/2)]):null;};
  const medPer=medOf(rawValidPer,r=>r.per)||13;
  const medPbr=medOf(rawValidPbr,r=>r.pbr)||2.0;

  // ── 3단계: 중앙값 기준 ×0.2~×4 이내만 최종 허용 (이상치 제거)
  const validPer=rawValidPer.filter(r=>r.per>=medPer*0.2&&r.per<=medPer*4);
  const validPbr=rawValidPbr.filter(r=>r.pbr>=medPbr*0.2&&r.pbr<=medPbr*4);

  // ── midPer/midPbr: 필터 후 중앙값 재산출
  const midPer=medOf(validPer,r=>r.per)||medPer;
  const midPbr=medOf(validPbr,r=>r.pbr)||medPbr;

  // ── Lo/Hi: midPer 기준 대칭 배수 (중간선이 항상 중앙에)
  // 실제 데이터 범위도 참고하되 midPer ±60% 이내로 클램프
  const rawMinPer=validPer.length?Math.min(...validPer.map(r=>r.per)):null;
  const rawMaxPer=validPer.length?Math.max(...validPer.map(r=>r.per)):null;
  const rawMinPbr=validPbr.length?Math.min(...validPbr.map(r=>r.pbr)):null;
  const rawMaxPbr=validPbr.length?Math.max(...validPbr.map(r=>r.pbr)):null;

  // 실제 min/max 범위를 midPer 기준으로 비율화 후 대칭 적용
  const perSpread=rawMinPer&&rawMaxPer?Math.max((midPer-rawMinPer)/midPer,(rawMaxPer-midPer)/midPer):0.5;
  const pbrSpread=rawMinPbr&&rawMaxPbr?Math.max((midPbr-rawMinPbr)/midPbr,(rawMaxPbr-midPbr)/midPbr):0.5;
  const perLo=+(midPer*(1-Math.min(perSpread,0.6))).toFixed(1);
  const perHi=+(midPer*(1+Math.min(perSpread,0.6))).toFixed(1);
  const pbrLo=+(midPbr*(1-Math.min(pbrSpread,0.6))).toFixed(2);
  const pbrHi=+(midPbr*(1+Math.min(pbrSpread,0.6))).toFixed(2);

  const interp=(label,map)=>{
    const keys=Object.keys(map).sort();if(!keys.length)return null;
    const [yr,mo]=label.split(".").map(Number),val=yr*12+(mo||6);
    let k0=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)<=val;}).slice(-1)[0];
    let k1=keys.filter(k=>{const[y,m]=k.split(".").map(Number);return y*12+(m||6)>val;})[0];
    if(!k0)return null;
    if(!k1)return map[k0]||0;
    const[y0,m0]=k0.split(".").map(Number),[y1,m1]=k1.split(".").map(Number);
    const t=(val-(y0*12+(m0||6)))/((y1*12+(m1||6))-(y0*12+(m0||6)));
    return (map[k0]||0)+((map[k1]||0)-(map[k0]||0))*t;
  };

  // ── 연도별 밴드맵: midPer/Lo/Hi 고정 배수 × EPS 보간
  ann.forEach(r=>{
    const key=`${r.year}.12`;
    if(r.eps!=null&&r.eps>0){
      epsMap[key]=r.eps;
      perLoMap[key]=Math.round(r.eps*perLo);
      perMidMap[key]=Math.round(r.eps*midPer);
      perHiMap[key]=Math.round(r.eps*perHi);
    }
    if(r.bps!=null&&r.bps>0){
      bpsMap[key]=r.bps;
      pbrLoMap[key]=Math.round(r.bps*pbrLo);
      pbrMidMap[key]=Math.round(r.bps*midPbr);
      pbrHiMap[key]=Math.round(r.bps*pbrHi);
    }
  });

  const _adaptive={
    perLo:perLo,perMid:+midPer.toFixed(1),perHi:perHi,
    pbrLo:pbrLo,pbrMid:+midPbr.toFixed(2),pbrHi:pbrHi,
  };

  return monthly.map(d=>({...d,
    perLo :interp(d.label,perLoMap),
    perMid:interp(d.label,perMidMap),
    perHi :interp(d.label,perHiMap),
    pbrLo :interp(d.label,pbrLoMap),
    pbrMid:interp(d.label,pbrMidMap),
    pbrHi :interp(d.label,pbrHiMap),
    _adaptive,
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
    else if(prev.gap60<100&&d.gap60>=100) pts.push({label:d.label,price:d.price,type:"매도",color:"#FF7830",arrow:"▼",pos:"top"});
    else if(prev.gap60<200&&d.gap60>=200) pts.push({label:d.label,price:d.price,type:"적극매도",color:"#FF3D5A",arrow:"▼",pos:"top"});
    else if(prev.gap60<300&&d.gap60>=300) pts.push({label:d.label,price:d.price,type:"극단매도",color:"#8855FF",arrow:"▼",pos:"top"});
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
const buildDCFHistory=(annData,gr,dr,bondYield,capexRatio)=>{
  if(!annData?.length)return[];
  return annData.filter(r=>r.shares&&r.year).map(r=>{
    const sh=r.shares/1e8;
    const owner=calcDCF_owner({net:r.net,cfo:r.cfo,cfi:r.cfi,capex:r.capex,capexRatio,gr,dr,shares:sh});
    const rate=r.fcf?calcDCF_rate({fcf:r.fcf,gr,dr,shares:sh}):0;
    const graham=calcDCF_graham({eps:r.eps,gr,bondYield});
    const roe=calcDCF_roe({roe:r.roe,eps:r.eps});
    return{year:r.year,fcf:r.fcf||null,owner:owner||null,rate:rate||null,graham:graham||null,roe:roe||null};
  });
};

// ── 오너이익 DCF (버핏 방식)
// 오너이익 = 순이익 + 추정감가상각(영업CF - 순이익) - CAPEX(투자CF 음수부분 근사)
const calcOwnerEarnings=({net,cfo,cfi,capex,capexRatio=50})=>{
  if(!net||!cfo)return null;
  const depEst=cfo-net;                                            // 감가상각 근사
  const totalCapex=capex?Math.abs(capex):cfi<0?Math.abs(cfi)*0.7:0; // 실제CAPEX 우선
  const maintCapex=totalCapex*(capexRatio/100);                    // 유지CAPEX = 전체 × 비율
  return net+depEst-maintCapex;
};
const calcDCF_owner=({net,cfo,cfi,capex,capexRatio,gr,dr,shares})=>{
  const oe=calcOwnerEarnings({net,cfo,cfi,capex,capexRatio});
  if(!oe||oe<=0||!shares||shares<=0)return 0;
  let pv=0,cf=oe;
  for(let y=1;y<=10;y++){cf*=(1+gr);pv+=cf/Math.pow(1+dr,y);}
  const tv=(cf*(1+0.03)/(dr-0.03))/Math.pow(1+dr,10);
  return Math.round((pv+tv)/shares);
};

// ── 역DCF: 현재 주가에 내재된 성장률 역산
const calcReverseDCF=({price,eps,dr})=>{
  if(!price||!eps||eps<=0||dr<=0)return null;
  // 현재주가 = EPS × (1+g)/(dr-g) × (1-Math.pow((1+g)/(1+dr),10)) + TV
  // 수치적으로 이분탐색으로 역산
  let lo=-0.5,hi=1.0;
  for(let i=0;i<60;i++){
    const g=(lo+hi)/2;
    if(dr-g<=0.001){hi=g;continue;}
    let pv=0,cf=eps;
    for(let y=1;y<=10;y++){cf*=(1+g);pv+=cf/Math.pow(1+dr,y);}
    const tv=(cf*(1+0.02)/(dr-0.02))/Math.pow(1+dr,10);
    if(pv+tv>price)hi=g;else lo=g;
  }
  return +((lo+hi)/2*100).toFixed(1);
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
  "설비투자(CAPEX)":"capex","현금DPS(원)":"dps","현금배당수익률":"divYield","현금배당성향(%)":"divPayout",
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
      <span style={{color:p.color||C.text,fontFamily:"monospace",fontWeight:700}}>{typeof p.value==="number"?Math.round(p.value).toLocaleString():p.value}</span>
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
// ══════════════════════════════════════════════════════════════
// BuffettTabInner — 버핏의 말 탭 컴포넌트
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// MoatTab — 경제적 해자 계량화 스코어 컴포넌트
// ══════════════════════════════════════════════════════════════
function MoatTab({annData,hasFinData}){
  if(!hasFinData||!annData?.length){
    return(
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"24px",textAlign:"center"}}>
        <div style={{fontSize:28,marginBottom:10}}>🛡️</div>
        <div style={{color:C.gold,fontSize:13,fontWeight:700,marginBottom:6}}>경제적 해자 분석</div>
        <div style={{color:C.muted,fontSize:11}}>재무제표를 업로드하면 경제적 해자 점수를 산출합니다.</div>
      </div>
    );
  }

  // ── 데이터 준비 (최대 5년)
  const rows=annData.filter(r=>r.year).slice(-5);
  const n=rows.length;
  const avg=(arr)=>arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:null;
  const stddev=(arr)=>{
    if(arr.length<2)return 0;
    const m=avg(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length);
  };

  // ── 1. 자본 효율성 (40점)
  // ROIC ≈ net / equity (equity가 없으면 assets-liab)
  const roicArr=rows.filter(r=>r.net!=null&&(r.equity!=null||r.assets!=null)).map(r=>{
    const invested=r.equity||(r.assets-(r.liab||0));
    return invested>0?(r.net/invested*100):null;
  }).filter(v=>v!=null);
  const avgROIC=roicArr.length?avg(roicArr):null;

  // ROE
  const roeArr=rows.filter(r=>r.roe!=null).map(r=>r.roe);
  const avgROE=roeArr.length?avg(roeArr):null;
  const roeConsistent=roeArr.length>=2&&roeArr.every(v=>v>=10);

  let roicScore=0,roeScore=0;
  if(avgROIC!=null){
    if(avgROIC>=20)roicScore=20;
    else if(avgROIC>=15)roicScore=15;
    else if(avgROIC>=10)roicScore=8;
    else if(avgROIC>=5)roicScore=3;
  }
  if(avgROE!=null){
    if(avgROE>=20&&roeConsistent)roeScore=20;
    else if(avgROE>=15)roeScore=15;
    else if(avgROE>=10)roeScore=8;
    else if(avgROE>=5)roeScore=3;
  }
  const capitalScore=roicScore+roeScore;

  // ── 2. 수익성 및 가격 결정력 (30점)
  // Gross Margin: (rev-op차이로 근사 불가) → opm으로 대체 (매출총이익률 없으면 opm 사용)
  const opmArr=rows.filter(r=>r.opm!=null).map(r=>r.opm);
  const avgOPM=opmArr.length?avg(opmArr):null;
  const opmStd=opmArr.length>=2?stddev(opmArr):null;

  // rev, op로 gross margin 근사 (op/rev가 최선)
  const gpArr=rows.filter(r=>r.op!=null&&r.rev!=null&&r.rev>0).map(r=>r.op/r.rev*100);
  const avgGP=gpArr.length?avg(gpArr):null;

  let gmScore=0,opmStabilityScore=0;
  // Gross Margin (실제 GPM 없으면 OPM으로 대체, 기준 완화)
  const gpRef=avgGP??avgOPM;
  if(gpRef!=null){
    if(gpRef>=30)gmScore=15;
    else if(gpRef>=20)gmScore=10;
    else if(gpRef>=12)gmScore=5;
    else if(gpRef>=5)gmScore=2;
  }
  // OPM 안정성 (표준편차 < 10%)
  if(opmStd!=null){
    if(opmStd<3)opmStabilityScore=15;
    else if(opmStd<5)opmStabilityScore=12;
    else if(opmStd<10)opmStabilityScore=7;
    else opmStabilityScore=2;
  } else if(avgOPM!=null){
    opmStabilityScore=5; // 1년치 데이터
  }
  const profitScore=gmScore+opmStabilityScore;

  // ── 3. 현금 창출 (20점)
  // FCF/Net Income > 80%
  const fcfConvArr=rows.filter(r=>r.fcf!=null&&r.net!=null&&r.net>0).map(r=>r.fcf/r.net*100);
  const avgFcfConv=fcfConvArr.length?avg(fcfConvArr):null;

  // CAPEX/CFO < 25%
  const capexRatioArr=rows.filter(r=>r.capex!=null&&r.cfo!=null&&r.cfo>0).map(r=>Math.abs(r.capex)/r.cfo*100);
  const avgCapexRatio=capexRatioArr.length?avg(capexRatioArr):null;

  let fcfConvScore=0,capexScore=0;
  if(avgFcfConv!=null){
    if(avgFcfConv>=100)fcfConvScore=10;
    else if(avgFcfConv>=80)fcfConvScore=10;
    else if(avgFcfConv>=50)fcfConvScore=6;
    else if(avgFcfConv>=0)fcfConvScore=3;
  } else if(rows.filter(r=>r.fcf!=null&&r.fcf>0).length===rows.length){
    fcfConvScore=6; // FCF 전부 양수
  }
  if(avgCapexRatio!=null){
    if(avgCapexRatio<15)capexScore=10;
    else if(avgCapexRatio<25)capexScore=10;
    else if(avgCapexRatio<40)capexScore=5;
    else capexScore=1;
  } else if(rows.filter(r=>r.cfo!=null&&r.cfo>0).length>0){
    capexScore=5;
  }
  const cashScore=fcfConvScore+capexScore;

  // ── 4. 재무 건전성 (10점)
  const lastRow=rows[rows.length-1];
  const debtRatio=lastRow?.debt??null;
  // 유동비율: current ratio 없으므로 부채비율만 사용, 만점 기준 완화
  let safetyScore=0;
  if(debtRatio!=null){
    if(debtRatio<50)safetyScore=10;
    else if(debtRatio<80)safetyScore=10;
    else if(debtRatio<150)safetyScore=5;
    else if(debtRatio<250)safetyScore=2;
  }

  // ── 총점
  const total=capitalScore+profitScore+cashScore+safetyScore;

  // ── 해자 등급
  let moatGrade,moatColor,moatIcon,moatDesc;
  if(total>=80){moatGrade="광역 해자";moatColor=C.green;moatIcon="🏰";moatDesc="탁월한 경쟁 우위. 10년 이상 지속 가능한 해자.";}
  else if(total>=60){moatGrade="넓은 해자";moatColor=C.teal;moatIcon="🛡️";moatDesc="견고한 경쟁 우위. 장기 투자 적합.";}
  else if(total>=40){moatGrade="좁은 해자";moatColor=C.gold;moatIcon="⚔️";moatDesc="일부 경쟁 우위. 지속성 모니터링 필요.";}
  else if(total>=20){moatGrade="해자 미약";moatColor=C.orange;moatIcon="🏚️";moatDesc="경쟁 우위 약함. 가격 우위 확인 필요.";}
  else{moatGrade="해자 없음";moatColor=C.red;moatIcon="💔";moatDesc="경쟁 우위 확인 불가. 추가 분석 필요.";}

  const sections=[
    {
      title:"자본 효율성",full:40,score:capitalScore,
      desc:"해자의 가장 강력한 증거 — 적은 자본으로 많은 수익",
      items:[
        {label:"ROIC (투하자본수익률)",score:roicScore,max:20,
         val:avgROIC!=null?`${avgROIC.toFixed(1)}%`:"—",
         bench:"15% 이상",
         detail:avgROIC!=null?(avgROIC>=20?"탁월":avgROIC>=15?"우수":avgROIC>=10?"양호":avgROIC>=5?"미흡":"미달"):"데이터 없음",
        },
        {label:"ROE (자기자본이익률)",score:roeScore,max:20,
         val:avgROE!=null?`${avgROE.toFixed(1)}%`:"—",
         bench:"15% 이상 + 일관성",
         detail:avgROE!=null?(avgROE>=20?"탁월":avgROE>=15?"우수":avgROE>=10?"양호":avgROE>=5?"미흡":"미달"):"데이터 없음",
        },
      ]
    },
    {
      title:"수익성 및 가격 결정력",full:30,score:profitScore,
      desc:"브랜드와 독점력 — 경기에 상관없이 이익을 지키는 방어력",
      items:[
        {label:"영업이익률 수준",score:gmScore,max:15,
         val:gpRef!=null?`${gpRef.toFixed(1)}%`:"—",
         bench:"30% 이상 (OPM 기준)",
         detail:gpRef!=null?(gpRef>=30?"탁월":gpRef>=20?"우수":gpRef>=12?"양호":gpRef>=5?"미흡":"미달"):"데이터 없음",
        },
        {label:"영업이익률 안정성",score:opmStabilityScore,max:15,
         val:opmStd!=null?`σ ${opmStd.toFixed(1)}%`:"—",
         bench:"표준편차 10% 이내",
         detail:opmStd!=null?(opmStd<3?"매우 안정":opmStd<5?"안정":opmStd<10?"보통":"불안정"):"데이터 필요(2년+)",
        },
      ]
    },
    {
      title:"현금 창출 및 잉여력",full:20,score:cashScore,
      desc:"실질적 생존력 — 장부 이익이 아닌 실제 현금",
      items:[
        {label:"FCF 전환율",score:fcfConvScore,max:10,
         val:avgFcfConv!=null?`${avgFcfConv.toFixed(0)}%`:"—",
         bench:"80% 이상",
         detail:avgFcfConv!=null?(avgFcfConv>=100?"탁월":avgFcfConv>=80?"우수":avgFcfConv>=50?"양호":avgFcfConv>=0?"미흡":"적자FCF"):"데이터 없음",
        },
        {label:"CAPEX 부담율",score:capexScore,max:10,
         val:avgCapexRatio!=null?`${avgCapexRatio.toFixed(0)}%`:"—",
         bench:"CFO의 25% 이내",
         detail:avgCapexRatio!=null?(avgCapexRatio<15?"경량 모델":avgCapexRatio<25?"양호":avgCapexRatio<40?"보통":"중자산"):"데이터 없음",
        },
      ]
    },
    {
      title:"재무 건전성",full:10,score:safetyScore,
      desc:"외부 충격에도 해자가 무너지지 않을 최소 방벽",
      items:[
        {label:"부채비율",score:safetyScore,max:10,
         val:debtRatio!=null?`${debtRatio}%`:"—",
         bench:"80% 이하",
         detail:debtRatio!=null?(debtRatio<50?"매우 안전":debtRatio<80?"안전":debtRatio<150?"보통":debtRatio<250?"주의":"위험"):"데이터 없음",
        },
      ]
    },
  ];

  const pct=Math.round(total/100*100);
  const arcLen=251.2; // 2πr, r=40
  const dashOffset=arcLen*(1-total/100);

  return(
    <div style={{animation:"fadeIn 0.3s ease"}}>

      {/* ── 총점 헤더 카드 */}
      <div style={{
        background:C.card,border:`2px solid ${moatColor}55`,
        borderRadius:14,padding:"18px 16px",marginBottom:12,
        boxShadow:`0 0 32px ${moatColor}12`,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          {/* 원형 게이지 */}
          <div style={{position:"relative",width:90,height:90,flexShrink:0}}>
            <svg width="90" height="90" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="40" fill="none" stroke={C.dim} strokeWidth="8"/>
              <circle cx="45" cy="45" r="40" fill="none"
                stroke={moatColor} strokeWidth="8"
                strokeDasharray={arcLen}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform="rotate(-90 45 45)"
                style={{transition:"stroke-dashoffset 0.8s ease"}}
              />
            </svg>
            <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
              <div style={{fontSize:20,fontWeight:900,fontFamily:"monospace",color:moatColor,lineHeight:1}}>{total}</div>
              <div style={{fontSize:8,color:C.muted}}>/ 100</div>
            </div>
          </div>
          {/* 등급 정보 */}
          <div style={{flex:1}}>
            <div style={{fontSize:9,color:C.muted,marginBottom:4,letterSpacing:"0.06em"}}>
              🛡️ 경제적 해자 스코어 · {n}년 평균 기준
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{fontSize:20}}>{moatIcon}</span>
              <span style={{fontSize:16,fontWeight:900,color:moatColor,fontFamily:"monospace"}}>{moatGrade}</span>
            </div>
            <div style={{fontSize:10,color:C.muted,lineHeight:1.6}}>{moatDesc}</div>
            <div style={{
              fontSize:8,color:C.muted,marginTop:6,
              background:C.card2,borderRadius:6,padding:"4px 8px",
              border:`1px solid ${C.border}`,display:"inline-block",
            }}>
              버핏 기준 · 자본효율40+수익성30+현금창출20+건전성10
            </div>
          </div>
        </div>

        {/* 섹션 점수 바 요약 */}
        <div style={{marginTop:14,display:"flex",gap:6,flexWrap:"wrap"}}>
          {sections.map(s=>{
            const pct2=Math.round(s.score/s.full*100);
            const col=pct2>=75?C.green:pct2>=50?C.gold:pct2>=25?C.orange:C.red;
            return(
              <div key={s.title} style={{flex:"1 1 calc(50% - 6px)",minWidth:120,
                background:C.card2,borderRadius:8,padding:"7px 10px",
                border:`1px solid ${col}33`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span style={{fontSize:9,color:C.muted}}>{s.title}</span>
                  <span style={{fontSize:10,fontWeight:700,fontFamily:"monospace",color:col}}>
                    {s.score}/{s.full}
                  </span>
                </div>
                <div style={{height:4,borderRadius:2,background:C.dim,overflow:"hidden"}}>
                  <div style={{width:`${pct2}%`,height:"100%",background:col,borderRadius:2,transition:"width 0.6s ease"}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 섹션별 상세 */}
      {sections.map(sec=>{
        const secPct=Math.round(sec.score/sec.full*100);
        const secCol=secPct>=75?C.green:secPct>=50?C.gold:secPct>=25?C.orange:C.red;
        return(
          <div key={sec.title} style={{
            background:C.card,border:`1px solid ${secCol}33`,
            borderRadius:12,padding:"13px 14px",marginBottom:10,
          }}>
            {/* 섹션 헤더 */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:secCol,marginBottom:3}}>{sec.title}</div>
                <div style={{fontSize:9,color:C.muted}}>{sec.desc}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                <div style={{fontSize:14,fontWeight:900,fontFamily:"monospace",color:secCol}}>{sec.score}</div>
                <div style={{fontSize:8,color:C.muted}}>/ {sec.full}점</div>
              </div>
            </div>
            {/* 지표 행 */}
            {sec.items.map(item=>{
              const itemPct=Math.round(item.score/item.max*100);
              const itemCol=itemPct>=75?C.green:itemPct>=50?C.gold:itemPct>=25?C.orange:C.red;
              return(
                <div key={item.label} style={{
                  background:C.card2,borderRadius:8,padding:"9px 11px",marginBottom:6,
                  border:`1px solid ${C.border}`,
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <div>
                      <span style={{fontSize:10,color:C.text,fontWeight:600}}>{item.label}</span>
                      <span style={{fontSize:8,color:C.muted,marginLeft:6}}>(기준: {item.bench})</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                      <span style={{fontSize:10,fontWeight:700,fontFamily:"monospace",color:itemCol}}>{item.val}</span>
                      <span style={{
                        fontSize:9,fontWeight:700,fontFamily:"monospace",color:itemCol,
                        background:`${itemCol}18`,borderRadius:4,padding:"1px 7px",
                        border:`1px solid ${itemCol}44`,
                      }}>{item.score}/{item.max}</span>
                    </div>
                  </div>
                  <div style={{height:5,borderRadius:3,background:C.dim,overflow:"hidden",marginBottom:4}}>
                    <div style={{width:`${itemPct}%`,height:"100%",background:itemCol,borderRadius:3}}/>
                  </div>
                  <div style={{fontSize:9,color:itemCol,fontWeight:600}}>{item.detail}</div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* ── 버핏의 해자 철학 */}
      <div style={{
        background:`${C.gold}0A`,border:`1px solid ${C.gold}30`,
        borderRadius:10,padding:"12px 14px",
      }}>
        <div style={{fontSize:9,color:C.gold,fontWeight:700,marginBottom:6,letterSpacing:"0.06em"}}>버핏의 해자 철학</div>
        <div style={{fontSize:10,color:C.muted,lineHeight:1.75,fontStyle:"italic"}}>
          "해자의 본질은 자본을 재투자했을 때 평균 이상의 수익을 지속적으로 창출하는 능력에 있습니다.
          ROE 15% 이상이 오랫동안 지속된다면 그것이 해자의 증거입니다."
        </div>
        <div style={{fontSize:8,color:C.muted,textAlign:"right",marginTop:4}}>— 워런 버핏, 버크셔 해서웨이 주주서한</div>
      </div>
    </div>
  );
}

function BuffettTabInner({Q,todayQ,CATS,CAT_COLOR,CAT_ICON}){
  const [catFilter,setCatFilter]=useState("전체");
  const [whoFilter,setWhoFilter]=useState("전체");
  const [idx,setIdx]=useState(0);

  // 인물별 색상 (이모티콘 없이 텍스트만)
  const WHO_LIST=[
    {id:"전체",    col:C.teal},
    {id:"워런 버핏",col:C.gold},
    {id:"찰리 멍거",col:C.purple},
    {id:"그레이엄", col:"#60A8DC"},
    {id:"피터 린치",col:C.green},
    {id:"하워드 막스",col:C.orange},
    {id:"필립 피셔",col:"#7EC8A0"},
    {id:"세스 클라만",col:C.red},
    {id:"존 템플턴",col:"#A78BFA"},
    {id:"파브라이", col:"#F472B6"},
    {id:"리루",    col:"#34D399"},
    {id:"테리 스미스",col:"#FB923C"},
  ];

  const filtered=(()=>{
    let q=catFilter==="전체"?Q:Q.filter(r=>r.cat===catFilter);
    if(whoFilter!=="전체")q=q.filter(r=>(r.who||"워런 버핏")===whoFilter);
    return q;
  })();
  const current=filtered[idx]||filtered[0];
  const accent=CAT_COLOR[current?.cat]||C.gold;

  const prev=()=>setIdx(i=>(i-1+filtered.length)%filtered.length);
  const next=()=>setIdx(i=>(i+1)%filtered.length);
  const changeCat=(cat)=>{setCatFilter(cat);setIdx(0);};
  const changeWho=(who)=>{setWhoFilter(who);setIdx(0);};

  return(
    <div style={{animation:"fadeIn 0.3s ease"}}>

      {/* ── 오늘의 어록 헤더 */}
      <div style={{
        background:C.card,
        border:`1px solid ${C.gold}44`,borderRadius:12,padding:"14px 16px",marginBottom:12,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          
          <div>
            <div style={{fontSize:13,fontWeight:900,color:C.gold,fontFamily:"monospace",letterSpacing:"0.05em"}}>📚 투자거장의 말</div>
            <div style={{fontSize:9,color:C.muted}}>투자거장 어록 {Q.length}선</div>
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div style={{fontSize:8,color:C.muted}}>오늘의 어록</div>
            <div style={{fontSize:9,color:C.gold,fontWeight:700,fontFamily:"monospace"}}>#{todayQ?.id}</div>
          </div>
        </div>
        {/* 오늘의 어록 카드 */}
        <div style={{background:`${C.gold}0E`,border:`1px solid ${C.gold}33`,borderRadius:8,padding:"10px 12px"}}>
          <div style={{fontSize:9,color:CAT_COLOR[todayQ?.cat]||C.gold,fontWeight:700,marginBottom:5,letterSpacing:"0.06em"}}>
            {CAT_ICON[todayQ?.cat]} {todayQ?.cat}
          </div>
          <div style={{fontSize:11,color:C.text,lineHeight:1.75,fontStyle:"italic",marginBottom:6}}>
            "{todayQ?.en}"
          </div>
          <div style={{fontSize:12,color:C.gold,lineHeight:1.7,fontWeight:600,marginBottom:5}}>
            "{todayQ?.ko}"
          </div>
          <div style={{fontSize:9,textAlign:"right"}}>
            {(()=>{
              const s=todayQ?.src||"";
              if(s.includes(" — ")){
                const[who,...rest]=s.split(" — ");
                return <span>
                  <span style={{color:C.gold}}>〈{who}〉</span>
                  <span style={{color:C.muted}}> {rest.join(" — ")}</span>
                </span>;
              }
              return <span style={{color:C.gold}}>〈{s}〉</span>;
            })()}
          </div>
        </div>
      </div>


      {/* ── 투자거장 필터 (가로 스크롤) */}
      <div style={{overflowX:"auto",marginBottom:8,paddingBottom:4,
        scrollbarWidth:"none",msOverflowStyle:"none"}}>
        <div style={{display:"flex",gap:5,width:"max-content"}}>
          {WHO_LIST.map(w=>{
            const active=whoFilter===w.id;
            const cnt=w.id==="전체"?Q.length:Q.filter(r=>(r.who||"워런 버핏")===w.id).length;
            return(
              <button key={w.id} onClick={()=>changeWho(w.id)} style={{
                background:active?`${w.col}22`:C.card,
                border:`1px solid ${active?w.col:C.border}`,
                borderRadius:16,padding:"4px 11px",
                color:active?w.col:C.muted,
                fontSize:9,fontWeight:active?700:400,
                cursor:"pointer",transition:"all 0.15s",
                whiteSpace:"nowrap",
              }}>
                {w.id}
                <span style={{
                  marginLeft:4,fontSize:8,
                  color:active?w.col:C.border,
                  fontFamily:"monospace",
                }}>{cnt}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 카테고리 필터 */}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
        {CATS.map(cat=>{
          const active=catFilter===cat;
          const col=cat==="전체"?C.gold:(CAT_COLOR[cat]||C.muted);
          return(
            <button key={cat} onClick={()=>changeCat(cat)} style={{
              background:active?`${col}22`:C.card,
              border:`1px solid ${active?col:C.border}`,
              borderRadius:20,padding:"5px 11px",
              color:active?col:C.muted,
              fontSize:10,fontWeight:active?700:400,
              cursor:"pointer",transition:"all 0.15s",
            }}>
              {cat==="전체"?"전체":CAT_ICON[cat]+" "+cat}
            </button>
          );
        })}
      </div>

      {/* ── 메인 어록 카드 */}
      {current&&(
        <div style={{
          background:C.card,border:`1px solid ${accent}55`,
          borderRadius:12,padding:"18px 16px",marginBottom:12,
          boxShadow:`0 0 24px ${accent}10`,
        }}>
          {/* 카테고리 + 번호 */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{
              background:`${accent}18`,border:`1px solid ${accent}44`,
              borderRadius:16,padding:"4px 12px",
              fontSize:10,color:accent,fontWeight:700,
            }}>
              {CAT_ICON[current.cat]} {current.cat}
            </div>
            <div style={{fontSize:9,color:C.muted,fontFamily:"monospace"}}>
              #{current.id} / {filtered.length}
            </div>
          </div>

          {/* 영문 원문 */}
          <div style={{
            fontSize:12,color:C.muted,lineHeight:1.85,fontStyle:"italic",
            marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${C.border}`,
          }}>
            "{current.en}"
          </div>

          {/* 한국어 번역 */}
          <div style={{
            fontSize:14,color:C.text,lineHeight:1.8,fontWeight:600,
            marginBottom:12,
          }}>
            "{current.ko}"
          </div>

          {/* 출처 */}
          <div style={{fontSize:9,textAlign:"right"}}>
            {(()=>{
              const s=current.src||"";
              if(s.includes(" — ")){
                const[who,...rest]=s.split(" — ");
                return <span>
                  <span style={{color:C.gold}}>〈{who}〉</span>
                  <span style={{color:C.muted}}> {rest.join(" — ")}</span>
                </span>;
              }
              // 이름만 있는 경우 (출처 없음)
              return <span style={{color:C.gold}}>〈{s}〉</span>;
            })()}
          </div>
        </div>
      )}

      {/* ── 네비게이션 */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:12}}>
        <button onClick={prev} style={{
          flex:1,background:C.card,border:`1px solid ${C.border}`,
          borderRadius:10,padding:"10px",color:C.muted,
          fontSize:13,cursor:"pointer",fontWeight:700,
        }}>← 이전</button>

        <div style={{
          textAlign:"center",padding:"8px 16px",
          background:C.card2,borderRadius:10,border:`1px solid ${C.border}`,
        }}>
          <div style={{fontSize:10,color:C.muted}}>
            {catFilter==="전체"?"전체":CAT_ICON[catFilter]+" "+catFilter}
          </div>
          <div style={{fontSize:11,fontWeight:700,color:C.text,fontFamily:"monospace"}}>
            {idx+1} / {filtered.length}
          </div>
        </div>

        <button onClick={next} style={{
          flex:1,background:C.card,border:`1px solid ${C.border}`,
          borderRadius:10,padding:"10px",color:C.muted,
          fontSize:13,cursor:"pointer",fontWeight:700,
        }}>다음 →</button>
      </div>

      {/* ── 카테고리별 어록 수 */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px"}}>
        <div style={{fontSize:9,color:C.muted,marginBottom:8,fontWeight:700}}>카테고리별 어록 수</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {CATS.filter(c=>c!=="전체").map(cat=>{
            const cnt=Q.filter(q=>q.cat===cat).length;
            const col=CAT_COLOR[cat]||C.muted;
            return(
              <div key={cat} onClick={()=>changeCat(cat)} style={{
                display:"flex",alignItems:"center",gap:4,
                background:`${col}12`,border:`1px solid ${col}33`,
                borderRadius:8,padding:"4px 8px",cursor:"pointer",
              }}>
                <span style={{fontSize:9}}>{CAT_ICON[cat]}</span>
                <span style={{fontSize:9,color:col,fontWeight:700}}>{cat}</span>
                <span style={{fontSize:9,color:C.muted,fontFamily:"monospace"}}>{cnt}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
  const [uploadToast,setUploadToast]=useState(null);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const [showSearch,setShowSearch]=useState(false);
  const DCF_DEFAULT_INIT={bondYield:3.5,riskPrem:2.0,gr:8.0,reqReturn:10.0,capexRatio:50};
  const [dcfDraft,setDcfDraft]=useState({});
  const [dcfApplied,setDcfApplied]=useState({...DCF_DEFAULT_INIT});
  const BAND_DEFAULT={perLo:7,perMid:13,perHi:20,pbrLo:1.0,pbrMid:2.0,pbrHi:3.5};
  const [bandDraft,setBandDraft]=useState(null); // null=자동모드
  const [bandApplied,setBandApplied]=useState(null); // null=자동모드
  // 전체 종목 목록 (KRX 동적 로드)
  const [stockList,setStockList]=useState(FALLBACK_STOCKS);
  const fileRef=useRef();
  const searchRef=useRef();
  const RANGES=[{label:"10년",months:120},{label:"5년",months:60},{label:"3년",months:36},{label:"1년",months:12}];

  // ── 시장탭: 거시경제 + 코스피/코스닥 지수 데이터
  const [macroData,setMacroData]=useState(null);
  const [kospiMonthly,setKospiMonthly]=useState([]);
  const [kosdaqMonthly,setKosdaqMonthly]=useState([]);
  const [marketLoading,setMarketLoading]=useState(false);
  const [marketLoaded,setMarketLoaded]=useState(false);
  const [marketSub,setMarketSub]=useState("econ"); // econ | kospi | kosdaq

  useEffect(()=>{
    if(tab!=="market"||marketLoaded)return;
    setMarketLoading(true);
    // localStorage 캐시 우선 (24시간 TTL)
    const MACRO_CACHE_TTL=24*60*60*1000;
    let cached=null;
    try{
      const raw=localStorage.getItem("sq_macro_v1");
      if(raw){const{data,ts}=JSON.parse(raw);if(Date.now()-ts<MACRO_CACHE_TTL&&data)cached=data;}
    }catch{}
    if(cached){
      setMacroData(cached);
      if(cached.kospiMonthly?.length)  setKospiMonthly(cached.kospiMonthly);
      if(cached.kosdaqMonthly?.length) setKosdaqMonthly(cached.kosdaqMonthly);
      setMarketLoaded(true);setMarketLoading(false);
      return;
    }
    const loadMacro = () =>
      fetch("/api/macro").then(r=>r.ok?r.json():null).catch(()=>null);
    loadMacro().then(macro=>{
      if(macro){
        setMacroData(macro);
        if(macro.kospiMonthly?.length)  setKospiMonthly(macro.kospiMonthly);
        if(macro.kosdaqMonthly?.length) setKosdaqMonthly(macro.kosdaqMonthly);
        try{localStorage.setItem("sq_macro_v1",JSON.stringify({data:macro,ts:Date.now()}));}catch{}
      }
      setMarketLoaded(true);
      setMarketLoading(false);
    });
  },[tab,marketLoaded]);

  // Supabase 로드 + localStorage 이중 보장
  // PC 마우스 환경에서만 스크롤바 표시
  useEffect(()=>{
    const isPC=window.matchMedia("(hover:hover) and (pointer:fine)").matches;
    if(isPC) document.documentElement.classList.add("show-scrollbar");
    return()=>document.documentElement.classList.remove("show-scrollbar");
  },[]);

  useEffect(()=>{
    setDbLoading(true);
    const loadFromLocal=()=>{
      try{const s=localStorage.getItem("sequoia_v3");if(s){const p=JSON.parse(s);if(p?.length){setStocks(p);return true;}}}catch{}
      return false;
    };
    sbGetStocks().then(rows=>{
      if(rows?.length){const mapped=rows.map(rowToStock);setStocks(mapped);try{localStorage.setItem("sequoia_v3",JSON.stringify(mapped));}catch{}}
      else{loadFromLocal();}
    }).catch(()=>{loadFromLocal();}).finally(()=>setDbLoading(false));
  },[]);

  // 종목 목록: localStorage 캐시 → /api/corplist → FALLBACK
  useEffect(()=>{
    try{const raw=localStorage.getItem("sq_corplist");if(raw){const{data,ts}=JSON.parse(raw);if(Date.now()-ts<86400000&&data?.length>100){setStockList(data);return;}}}catch{}
    fetch("/corplist.json").then(r=>r.json()).then(data=>{
      if(data?.length>100){setStockList(data);try{localStorage.setItem("sq_corplist",JSON.stringify({data,ts:Date.now()}));}catch{}}
    }).catch(()=>{});
  },[]);

  const co=stocks[activeIdx]||null;

  // 종목 변경 시 밴드 수동설정 초기화 → 자동모드로 복귀
  useEffect(()=>{
    setBandDraft(null);
    setBandApplied(null);
  },[activeIdx,co?.ticker]);

  // 종목 주가 로드 (Yahoo Finance)
  useEffect(()=>{
    if(!co?.ticker)return;
    setPriceLoading(true);setMonthly([]);setPriceInfo(null);
    const market=stockList.find(s=>s.ticker===co.ticker)?.market||co.market||"";
    fetchPrice(co.ticker,market).then(res=>{
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

  const displayMonthly=useMemo(()=>monthly.slice(-RANGES[rangeIdx].months),[monthly,rangeIdx]);

  const withMA60  =useMemo(()=>calcMA60(displayMonthly),[displayMonthly]);
  // 이격도 차트용: 전체 monthly 기반 계산 후 슬라이스 (QMA 누락 방지)
  const withMA60Slice=useMemo(()=>calcMA60(monthly).slice(-RANGES[rangeIdx].months),[monthly,rangeIdx]);
  // PER/PBR 밴드는 전체 monthly 기반 (범위 제한 없이 EPS 보간 정확히)
  const withBands =useMemo(()=>{
    const full=calcMA60(monthly);
    // bandApplied가 null이면 자동모드, 값이 있으면 수동모드
    return buildBandsFromQtr(full,co?.qtrData,co?.annData,bandApplied).slice(-RANGES[rangeIdx].months);
  },[monthly,co?.qtrData,co?.annData,rangeIdx,bandApplied]);
  const withPositionBands=useMemo(()=>calcPositionBands(monthly).slice(-RANGES[rangeIdx].months),[monthly,rangeIdx]);
  const withRSI   =useMemo(()=>calcRSI(displayMonthly),[displayMonthly]);
  const withMACD  =useMemo(()=>calcMACD(displayMonthly),[displayMonthly]);
  const withOBV   =useMemo(()=>calcOBV(displayMonthly),[displayMonthly]);
  const withMFI   =useMemo(()=>calcMFI(displayMonthly),[displayMonthly]);
  const withMA60Full=useMemo(()=>calcMA60(monthly),[monthly]);
  const signalPts =useMemo(()=>{
    const allPts=calcSignalPoints(withMA60Full);
    if(!displayMonthly.length)return allPts;
    const firstLabel=displayMonthly[0]?.label;
    return allPts.filter(pt=>pt.label>=firstLabel);
  },[withMA60Full,displayMonthly]);
  // threeLineSignal은 readingEngine 이후에 계산 (fin 파라미터 필요)
  // lastGap: 전체 monthly 기반 MA60 사용 (displayMonthly 슬라이스 문제 방지)
  // 60개 미만이면 가능한 최장 MA로 fallback
  const lastGap=useMemo(()=>{
    const full=withMA60Full;
    const last=full.slice(-1)[0];
    if(last?.gap60!=null)return last.gap60;
    // fallback: 20MA
    if(monthly.length>=20){
      const m20=monthly.slice(-20).reduce((s,x)=>s+x.price,0)/20;
      const p=monthly.slice(-1)[0]?.price;
      return p?+(((p/m20)-1)*100).toFixed(2):null;
    }
    // fallback: 전체 평균
    if(monthly.length>=3){
      const mAll=monthly.reduce((s,x)=>s+x.price,0)/monthly.length;
      const p=monthly.slice(-1)[0]?.price;
      return p?+(((p/mAll)-1)*100).toFixed(2):null;
    }
    return null;
  },[withMA60Full,monthly]);
  const lastAnn   =co?.annData?.slice(-1)?.[0]||{};

  const dcfResults=useMemo(()=>{
    const dr=(dcfApplied.bondYield+dcfApplied.riskPrem)/100,gr=dcfApplied.gr/100;
    const shares=lastAnn.shares?lastAnn.shares/1e8:null;
    const a=shares?calcDCF_rate({fcf:lastAnn.fcf,gr,dr,shares}):0;
    const b=calcDCF_graham({eps:lastAnn.eps,gr,bondYield:dcfApplied.bondYield});
    const c=calcDCF_roe({roe:lastAnn.roe,eps:lastAnn.eps});
    const d=shares?calcDCF_owner({net:lastAnn.net,cfo:lastAnn.cfo,cfi:lastAnn.cfi,capex:lastAnn.capex,capexRatio:dcfApplied.capexRatio,gr,dr,shares}):0;
    const valid=[a,b,c,d].filter(v=>v>0);
    const avg=valid.length?Math.round(valid.reduce((s,v)=>s+v,0)/valid.length):0;
    // 역DCF — 현재 주가에 내재된 성장률 (priceInfo에서 직접 읽기)
    const curPrice=priceInfo?.currentPrice||0;
    const impliedGr=curPrice>0?calcReverseDCF({price:curPrice,eps:lastAnn.eps,dr}):null;
    return{a,b,c,d,avg,impliedGr};
  },[lastAnn,dcfApplied,priceInfo]);

  const dcfHistory=useMemo(()=>buildDCFHistory(co?.annData,dcfApplied.gr/100,(dcfApplied.bondYield+dcfApplied.riskPrem)/100,dcfApplied.bondYield,dcfApplied.capexRatio),[co?.annData,dcfApplied]);

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
    if(gap<=-40)return{label:"필수매수",color:C.green};   // VL: ×0.6 이하
    if(gap<=-20) return{label:"적극매수",color:C.teal};        // L:  ×0.8 이하
    if(gap<=0) return{label:"매수",color:"#40E0D0"};        // M:  ×1.0 이하
    if(gap<50)  return{label:"관망",color:C.gold};        // MH:  ×1.5 미만
    if(gap<100) return{label:"과열",color:C.orange};      // H:  ×2.0 미만
    if(gap<150) return{label:"매도",color:"#FF6B00"};     // VH: ×2.5 미만
    return{label:"적극매도",color:C.red};                  // EH: ×2.5 이상
  };
  const gs=gapSig(lastGap);
  const price=priceInfo?.currentPrice||0;
  const priceDateStr=priceInfo?.priceDateStr||"";
  const ma60val=withMA60.slice(-1)[0]?.ma60||0;
  const per=lastAnn.per||(lastAnn.eps&&price?Math.round(price/lastAnn.eps*10)/10:0);
  const pbr=lastAnn.pbr||(lastAnn.bps&&price?Math.round(price/lastAnn.bps*100)/100:0);

  // 자동 단위 변환 (억/조)
  const autoUnit=(data,keys)=>{
    const maxVal=Math.max(...(data||[]).flatMap(d=>keys.map(k=>Math.abs(d[k]||0))));
    if(maxVal>=10000)return{unit:"조",scale:10000};
    return{unit:"억",scale:1};
  };
  const scaleData=(data,keys,scale)=>scale===1?data:data.map(d=>{
    const r={...d};keys.forEach(k=>{if(r[k]!=null)r[k]=+(r[k]/scale).toFixed(1);});return r;
  });

  // rangeIdx: 0=10년, 1=5년, 2=3년, 3=1년
  // 10년·5년은 연도만, 3년·1년은 분기 표시
  const xp=(forceYearOnly=false)=>({
    dataKey:"label",
    height: (forceYearOnly||rangeIdx<=1)?20:40,
    tick:<QTick yearOnly={forceYearOnly||rangeIdx<=1}/>,
    tickLine:false,axisLine:{stroke:C.border},interval:0,
  });
  const yp=(unit="",w=44)=>({tick:{fill:C.muted,fontSize:11},tickLine:false,axisLine:false,unit,width:w});

  const handleUpload=async(e)=>{
    const files=Array.from(e.target.files);if(!files.length)return;
    setUploading(true);
    try{
      const results=await Promise.all(files.map(parseExcel));
      for(const res of results)await sbUpsertStock(res).catch(()=>{});
      const rows=await sbGetStocks().catch(()=>null);
      if(rows?.length)setStocks(rows.map(rowToStock));
      else setStocks(prev=>{const m=[...prev];results.forEach(res=>{const i=m.findIndex(s=>s.ticker===res.ticker);if(i>=0)m[i]=res;else m.push(res);});return m;});
    }catch(err){alert("업로드 실패: "+err.message);}
    setUploading(false);e.target.value="";
  };

  const removeStock=async(idx)=>{
    const s=stocks[idx];
    if(s?.ticker)await sbDeleteStock(s.ticker).catch(()=>{});
    setStocks(prev=>prev.filter((_,i)=>i!==idx));
    setActiveIdx(0);
  };

  // ══════════════════════════════════════════════════════════════
  // SEQUOIA 판독 엔진 (8거장 대체 — 가격위치 × 펀더멘털 조합)
  // ══════════════════════════════════════════════════════════════
  const readingEngine=useMemo(()=>{
    // ── 기본값: 데이터 없을 때 최소 구조 반환
    const noData={ready:false};
    if(!co)return noData;

    // ── ① 가격 위치 (ma60 이격도)
    const gap=lastGap;
    let priceZone="—",priceZoneEn="none",priceZoneColor=C.muted;
    if(gap!==null){
      if(gap<=-40){priceZone="VL";priceZoneEn="knee";priceZoneColor=C.blue;}      // ×0.6 이하
      else if(gap<-20){priceZone="L";priceZoneEn="thigh";priceZoneColor=C.teal;}  // ×0.8 이하
      else if(gap<50){priceZone="M";priceZoneEn="neutral";priceZoneColor=C.green;} // ×1.5 미만
      else if(gap<100){priceZone="H";priceZoneEn="shoulder";priceZoneColor=C.orange;} // ×2.0 미만
      else if(gap<150){priceZone="VH";priceZoneEn="top";priceZoneColor=C.red;}    // ×2.5 미만
      else{priceZone="EH";priceZoneEn="peak";priceZoneColor=C.purple;}             // ×2.5 이상
    }

    // ── ② EPS 추세 (최근 3년)
    const ann3=(co.annData||[]).slice(-3);
    let epsTrend="정체",epsTrendIcon="→",epsTrendColor=C.muted;
    if(ann3.length>=2){
      const ups=ann3.filter((r,i)=>i>0&&r.eps!=null&&ann3[i-1].eps!=null&&r.eps>ann3[i-1].eps).length;
      const dns=ann3.filter((r,i)=>i>0&&r.eps!=null&&ann3[i-1].eps!=null&&r.eps<ann3[i-1].eps).length;
      if(ups>=Math.min(2,ann3.length-1)){epsTrend="개선";epsTrendIcon="↑";epsTrendColor=C.green;}
      else if(dns>=Math.min(2,ann3.length-1)){epsTrend="악화";epsTrendIcon="↓";epsTrendColor=C.red;}
    }

    // ── ③ FCF 추세 (최근 2년)
    const ann2=(co.annData||[]).slice(-2);
    let fcfTrend="확인불가",fcfTrendIcon="?",fcfTrendColor=C.muted;
    if(ann2.length>=1){
      const pos=ann2.filter(r=>r.fcf!=null&&r.fcf>0).length;
      const neg=ann2.filter(r=>r.fcf!=null&&r.fcf<0).length;
      if(pos===ann2.length){fcfTrend="흑자안정";fcfTrendIcon="↑";fcfTrendColor=C.green;}
      else if(pos>0&&neg>0){fcfTrend="흑자전환";fcfTrendIcon="↗";fcfTrendColor=C.teal;}
      else if(neg===ann2.length){fcfTrend="적자지속";fcfTrendIcon="↓";fcfTrendColor=C.red;}
    }

    // ── ④ 실적 모멘텀 (최근 opGrowth — annTimeline 기반)
    const recentGrowth=annTimeline.slice(-2);
    let momentum="정체",momentumColor=C.muted;
    if(recentGrowth.length>=2){
      const og=recentGrowth[1].op!=null&&recentGrowth[0].op!=null&&recentGrowth[0].op!==0
        ?((recentGrowth[1].op-recentGrowth[0].op)/Math.abs(recentGrowth[0].op)*100):null;
      if(og!=null){
        if(og>=15){momentum="성장지속";momentumColor=C.green;}
        else if(og>=0){momentum="둔화";momentumColor=C.gold;}
        else{momentum="훼손";momentumColor=C.red;}
      }
    }

    // ── ⑤ 수익성
    const opm=lastAnn.opm||0,roe=lastAnn.roe||0;
    let profitability="취약",profitabilityColor=C.red;
    if(opm>=15&&roe>=15){profitability="우량";profitabilityColor=C.green;}
    else if(opm>=8||roe>=10){profitability="보통";profitabilityColor=C.gold;}

    // ── ⑥ 재무안정성
    const debt=lastAnn.debt||0;
    let debtLevel="주의",debtColor=C.red;
    if(debt<50){debtLevel="안전";debtColor=C.green;}
    else if(debt<=100){debtLevel="보통";debtColor=C.gold;}

    // ── ⑦ 밸류에이션 (내재가치 대비)
    const avg=dcfResults.avg||0;
    let valuation="—",valuationColor=C.muted,valuationPct=null;
    if(avg>0&&price>0){
      valuationPct=Math.round((price/avg-1)*100);
      if(price<avg*0.85){valuation="저평가";valuationColor=C.green;}
      else if(price<=avg*1.15){valuation="적정";valuationColor=C.gold;}
      else{valuation="고평가";valuationColor=C.red;}
    }

    // ── ⑧ 판독 매트릭스
    let verdict="중립",verdictColor=C.muted,verdictIcon="⚪",reason="",interpretation="";
    const fundGood=epsTrend==="개선"&&(fcfTrend==="흑자안정"||fcfTrend==="흑자전환");
    const fundBad=epsTrend==="악화"||fcfTrend==="적자지속";
    const momentumGood=momentum==="성장지속";
    const momentumBad=momentum==="훼손";

    if(priceZoneEn==="knee"){
      if(fundGood){
        verdict="핵심 관심 구간";verdictColor=C.blue;verdictIcon="🔵";
        reason=`EPS ${epsTrendIcon}${epsTrend} + FCF ${fcfTrend}`;
        interpretation="장기 저점권, 실적 개선 중 — 분할 매수 검토 구간";
      } else if(fundBad){
        verdict="가치함정 주의";verdictColor=C.red;verdictIcon="🔴";
        reason=`EPS ${epsTrendIcon}${epsTrend} + FCF ${fcfTrend}`;
        interpretation="저점처럼 보이나 펀더멘털 훼손 — 구조적 원인 확인 필요";
      } else {
        verdict="저점 대기 관망";verdictColor=C.muted;verdictIcon="⚪";
        reason="가격 저점권, 실적 방향 불명확";
        interpretation="추세 확인 후 진입 검토";
      }
    } else if(priceZoneEn==="thigh"){
      if(profitability==="우량"&&momentumGood){
        verdict="우량 진입 구간";verdictColor=C.green;verdictIcon="🟢";
        reason=`OPM ${opm}% · ROE ${roe}% + 모멘텀 ${momentum}`;
        interpretation="수익성 우량 + 가격 합리적 — 핵심 매수 구간";
      } else {
        verdict="관망";verdictColor=C.muted;verdictIcon="⚪";
        reason="수익성 또는 모멘텀 미충족";
        interpretation="수익성 개선 확인 후 재검토";
      }
    } else if(priceZoneEn==="neutral"){
      if(momentumGood){
        verdict="추세 동행 구간";verdictColor=C.green;verdictIcon="🟢";
        reason=`실적 모멘텀 ${momentum} 지속`;
        interpretation="실적이 주가를 견인 중 — 추세 유지 여부 모니터링";
      } else if(momentumBad){
        verdict="관망";verdictColor=C.muted;verdictIcon="⚪";
        reason=`모멘텀 ${momentum}, 방향 재확인 필요`;
        interpretation="실적 둔화 신호 — 다음 분기 확인 필요";
      } else {
        verdict="중립";verdictColor=C.muted;verdictIcon="⚪";
        reason="가격·실적 모두 중립 구간";
        interpretation="특이 신호 없음 — 관망 유지";
      }
    } else if(priceZoneEn==="shoulder"||priceZoneEn==="top"){
      if(momentumGood&&profitability==="우량"){
        verdict="재평가 가능 구간";verdictColor=C.purple;verdictIcon="🟣";
        reason=`고가권이나 실적 ${momentum} + 수익성 ${profitability}`;
        interpretation="실적이 밸류를 정당화 중 — 과열 vs 재평가 판단 필요";
      } else if(momentumBad||fundBad){
        verdict="차익 고려 구간";verdictColor=C.orange;verdictIcon="🟠";
        reason=`고가권 + 모멘텀 ${momentum}`;
        interpretation="가격 고점권에서 실적 둔화 — 비중 축소 검토";
      } else {
        verdict="경계 구간";verdictColor=C.orange;verdictIcon="🟠";
        reason="고가권 진입, 실적 모니터링 강화 필요";
        interpretation="추가 상승 여력 제한적 — 신규 진입 자제";
      }
    } else if(priceZoneEn==="peak"){
      verdict="극단 과열 주의";verdictColor=C.red;verdictIcon="🔴";
      reason="QMA 대비 250% 초과 — 역사적 극단 과열";
      interpretation="어떤 실적에도 리스크 극단적으로 높음";
    } else {
      // gap이 있지만 priceZone 미산출 (매우 드문 케이스)
      if(gap!==null){
        verdict="분석 대기";verdictColor=C.gold;verdictIcon="🟡";
        reason=`QMA 산출 중 (현재 이격: ${gap>0?"+":""}${gap}%)`;
        interpretation="데이터 축적 중 — 이격도 참고만 하세요";
      } else {
        verdict="주가 로딩 중";verdictColor=C.muted;verdictIcon="⚪";
        reason="주가 데이터 연결 중";
        interpretation="잠시 후 자동 갱신됩니다";
      }
    }

    // ── TTM EPS
    const ttmEps=(co.qtrData?.slice(-4)||[]).reduce((s,r)=>s+(r.eps||0),0)||(lastAnn.eps||0);
    const ttmPer=ttmEps&&price?Math.round(price/ttmEps*10)/10:per;
    const avgRoe3=ann3.reduce((s,r)=>s+(r.roe||0),0)/(ann3.length||1);

    return{
      ready:true,
      // 가격
      priceZone,priceZoneColor,gap,
      // 펀더멘털
      epsTrend,epsTrendIcon,epsTrendColor,
      fcfTrend,fcfTrendIcon,fcfTrendColor,
      momentum,momentumColor,
      profitability,profitabilityColor,
      debtLevel,debtColor,debt,
      valuation,valuationColor,valuationPct,
      // 수치
      opm,roe,avgRoe3:+avgRoe3.toFixed(1),
      ttmPer,pbr,
      fcfVal:lastAnn.fcf||null,
      // 판독
      verdict,verdictColor,verdictIcon,reason,interpretation,
    };
  },[co,lastGap,lastAnn,dcfResults,price,per,pbr,annTimeline]);

  // 3선 정렬 신호 — readingEngine 이후에 계산 (실적 연계)
  const threeLineSignal=useMemo(()=>{
    const re=readingEngine;
    return calc3LineSignal(monthly,{
      epsTrend:re.epsTrend||"",
      fcfTrend:re.fcfTrend||"",
      momentum:re.momentum||"",
      profitability:re.profitability||"",
      opm:re.opm||0,
      roe:re.roe||0,
      annData:co?.annData||[],
      hasFinData:!!(co?.annData?.length>=1||co?.qtrData?.length>=1),
    });
  },[monthly,readingEngine,co?.annData,co?.qtrData]);

  const TABS=[
    {id:"overview",label:"📊 종합"},
    {id:"market",label:"🌐 시장"},
    {id:"moat",label:"🛡 경제적 해자"},
    {id:"price60",label:"📈 주가"},
    {id:"perbpr",label:"💹 PER/PBR"},{id:"financial",label:"💰 재무"},
    {id:"technical",label:"🧮 기술분석"},{id:"valuation",label:"💎 가치평가"},
    {id:"stability",label:"🛡 안정성"},{id:"dividend",label:"💸 배당"},
    {id:"buffett",label:"📚 투자거장의 말"},
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
      fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      overflowX:"hidden"}}>

      {/* ── 상단 타이틀 바 */}
      <div style={{background:darkMode?`linear-gradient(135deg,#040C1A,#071428)`:`linear-gradient(135deg,${C.card},${C.card2})`,borderBottom:`1px solid ${C.border}`,
        padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}
          onClick={()=>setTab("overview")}
          title="종합 화면으로">
          <span style={{fontSize:16}}>🌲</span>
          <span style={{color:C.gold,fontSize:13,fontWeight:900,fontFamily:"monospace",letterSpacing:"0.12em"}}>SEQUOIA QUANTUM</span>
          <span style={{color:C.muted,fontSize:9,fontFamily:"monospace",letterSpacing:"0.18em"}}>ANALYSIS SYSTEM</span>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:C.green,boxShadow:`0 0 6px ${C.green}`}}/>
          <span style={{color:C.muted,fontSize:9,fontFamily:"monospace"}}>LIVE</span>
        </div>
      </div>

      {/* ── 헤더 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
        padding:"8px 12px",display:"flex",alignItems:"center",gap:8,position:"sticky",top:0,zIndex:100}}>

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
        <button onClick={()=>setConfirmDelete(true)}
          style={{background:"transparent",color:C.red,border:`1px solid ${C.red}44`,borderRadius:7,padding:"6px 8px",fontSize:11,cursor:"pointer",flexShrink:0}}>🗑</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{display:"none"}} onChange={handleUpload}/>
      </div>

      {/* ── 업로드 토스트 */}
      {uploadToast&&(
        <div style={{position:"fixed",top:16,right:12,zIndex:9999,
          background:uploadToast==="loading"?C.card:uploadToast==="success"?C.green:C.red,
          color:uploadToast==="loading"?C.text:"#fff",
          border:`1px solid ${uploadToast==="loading"?C.border:"transparent"}`,
          borderRadius:10,padding:"10px 18px",fontSize:12,fontWeight:700,
          boxShadow:"0 4px 20px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",gap:8}}>
          {uploadToast==="loading"?"⏳ 업로드 중...":uploadToast==="success"?"✅ 저장 완료!":"❌ 업로드 실패"}
        </div>
      )}

      {/* ── 종목 삭제 확인 팝업 */}
      {confirmDelete&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"24px 28px",minWidth:260,textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:8}}>🗑</div>
            <div style={{color:C.text,fontSize:14,fontWeight:700,marginBottom:6}}>{co?.name} 삭제</div>
            <div style={{color:C.muted,fontSize:11,marginBottom:20}}>종목과 재무 데이터가 모두 삭제됩니다.</div>
            <div style={{display:"flex",gap:8,justifyContent:"center"}}>
              <button onClick={()=>setConfirmDelete(false)}
                style={{background:C.card2,color:C.muted,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 20px",fontSize:12,cursor:"pointer",fontWeight:700}}>
                취소
              </button>
              <button onClick={()=>removeStock(activeIdx)}
                style={{background:C.red,color:"#fff",border:"none",borderRadius:8,padding:"8px 20px",fontSize:12,cursor:"pointer",fontWeight:700}}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

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
            {k:"QMA 이격도",v:lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"—",c:gs.color},
            {k:"신호",v:gs.label,c:gs.color},
            {k:"내재가치",v:dcfResults.avg?`${dcfResults.avg.toLocaleString()}원`:"—",c:C.blueL,
              sub:(()=>{if(!dcfResults.avg||!price)return null;const pct=Math.round((price/dcfResults.avg-1)*100);return{v:`${pct>0?"+":""}${pct}%`,c:pct>0?C.red:C.green,label:pct>0?"고평가":"저평가"};})()},
          ].map(k=>(
            <div key={k.k} style={{textAlign:"center",background:C.bg,borderRadius:7,padding:"5px 8px",flexShrink:0}}>
              <div style={{color:C.muted,fontSize:9}}>{k.k}</div>
              <div style={{color:k.c,fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{k.v}</div>
              {k.sub&&<div style={{color:k.sub.c,fontSize:9,fontWeight:700,fontFamily:"monospace",marginTop:1}}>{k.sub.v} {k.sub.label}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── 탭 */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"6px 12px",display:"flex",gap:4,overflowX:"auto"}}>
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

            {/* ── SEQUOIA 판독 카드 ── */}
            {(()=>{
              const re=readingEngine;
              const hasPriceZone=re.gap!==null;
              const hasFin=hasFinData;

              // 재무 데이터 없으면 업로드 안내
              if(!hasFin){return(
                <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 16px",marginBottom:12}}>
                  <div style={{color:C.muted,fontSize:10,letterSpacing:"0.1em",marginBottom:6}}>🔍 SEQUOIA 판독</div>
                  <div style={{color:C.muted,fontSize:12,textAlign:"center",padding:"8px 0",lineHeight:1.8}}>
                    📂 재무 데이터를 업로드해야<br/>판독을 볼 수 있습니다.
                  </div>
                </div>
              );}

              const vc=re.verdictColor||C.muted;
              return(
                <div style={{
                  background:`linear-gradient(135deg,${vc}12,${C.card})`,
                  border:`2px solid ${vc}55`,
                  borderRadius:14,padding:"14px 15px",marginBottom:12,
                  position:"relative",overflow:"hidden",
                }}>
                  {/* 배경 글로우 */}
                  <div style={{position:"absolute",top:-30,right:-30,width:100,height:100,
                    background:`radial-gradient(circle,${vc}20,transparent 70%)`,pointerEvents:"none"}}/>

                  {/* 헤더 행 */}
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:10,gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{color:C.muted,fontSize:9,letterSpacing:"0.12em",marginBottom:5}}>
                        🔍 SEQUOIA 판독 &nbsp;·&nbsp; <span style={{color:C.dim}}>알고리즘 자동 분석 · 투자 참고용</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:18}}>{re.verdictIcon||"⚪"}</span>
                        <span style={{
                          fontSize:17,fontWeight:900,color:vc,fontFamily:"monospace",
                          letterSpacing:"0.04em",lineHeight:1.2,
                        }}>{re.verdict}</span>
                      </div>
                    </div>
                    {/* 가격 위치 뱃지 */}
                    {hasPriceZone&&(
                      <div style={{
                        background:`${re.priceZoneColor}22`,border:`1.5px solid ${re.priceZoneColor}55`,
                        borderRadius:9,padding:"6px 11px",textAlign:"center",flexShrink:0,
                      }}>
                        <div style={{color:re.priceZoneColor,fontSize:13,fontWeight:900,fontFamily:"monospace"}}>{re.priceZone}</div>
                        <div style={{color:re.priceZoneColor,fontSize:10,fontFamily:"monospace",marginTop:1,opacity:0.85}}>
                          {re.gap!=null?`${re.gap>0?"+":""}${re.gap}%`:"—"}
                        </div>
                        <div style={{color:C.muted,fontSize:8,marginTop:1}}>QMA 이격도</div>
                      </div>
                    )}
                  </div>

                  {/* 판독 내용 */}
                  {re.reason&&(
                    <div style={{
                      background:`${vc}10`,borderLeft:`3px solid ${vc}`,
                      borderRadius:"0 8px 8px 0",padding:"8px 11px",marginBottom:9,
                    }}>
                      <div style={{color:C.muted,fontSize:9,marginBottom:3,letterSpacing:"0.05em"}}>핵심 근거</div>
                      <div style={{color:vc,fontSize:12,fontWeight:700,lineHeight:1.4}}>{re.reason}</div>
                    </div>
                  )}
                  {re.interpretation&&(
                    <div style={{color:C.text,fontSize:11,lineHeight:1.6,marginBottom:11,paddingLeft:2}}>
                      💬 {re.interpretation}
                    </div>
                  )}

                  {/* 구분선 */}
                  <div style={{borderTop:`1px solid ${C.border}`,marginBottom:10}}/>

                  {/* 근거 지표 그리드 */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                    {[
                      {
                        label:"EPS 추세",
                        value:`${re.epsTrendIcon||""} ${re.epsTrend||"—"}`,
                        color:re.epsTrendColor||C.muted,
                        sub: hasFin&&lastAnn.eps?`${(lastAnn.eps||0).toLocaleString()}원`:null,
                      },
                      {
                        label:"FCF 상태",
                        value:`${re.fcfTrendIcon||""} ${re.fcfTrend||"—"}`,
                        color:re.fcfTrendColor||C.muted,
                        sub: hasFin&&re.fcfVal!=null?`${re.fcfVal.toLocaleString()}억`:null,
                      },
                      {
                        label:"실적 모멘텀",
                        value:re.momentum||"—",
                        color:re.momentumColor||C.muted,
                        sub:null,
                      },
                      {
                        label:"수익성",
                        value:re.profitability||"—",
                        color:re.profitabilityColor||C.muted,
                        sub: hasFin?`OPM ${re.opm}% · ROE ${re.roe}%`:null,
                      },
                      {
                        label:"재무안정성",
                        value:re.debtLevel||"—",
                        color:re.debtColor||C.muted,
                        sub: hasFin?`부채비율 ${re.debt}%`:null,
                      },
                      {
                        label:"밸류에이션",
                        value:re.valuation||"—",
                        color:re.valuationColor||C.muted,
                        sub: re.valuationPct!=null?`내재가치 대비 ${re.valuationPct>0?"+":""}${re.valuationPct}%`:
                             hasFin?`PER ${re.ttmPer}배 · PBR ${re.pbr}배`:null,
                      },
                    ].map((item,i)=>(
                      <div key={i} style={{
                        background:C.bg,borderRadius:9,padding:"8px 10px",
                        border:`1px solid ${C.border}`,
                      }}>
                        <div style={{color:C.muted,fontSize:8,marginBottom:3,letterSpacing:"0.04em"}}>{item.label}</div>
                        <div style={{color:item.color,fontSize:12,fontWeight:800,fontFamily:"monospace",lineHeight:1}}>{item.value}</div>
                        {item.sub&&<div style={{color:C.muted,fontSize:8,marginTop:3,lineHeight:1.3}}>{item.sub}</div>}
                      </div>
                    ))}
                  </div>

                  {/* 3년 평균 ROE 보조 행 */}
                  {hasFin&&re.avgRoe3>0&&(
                    <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
                      {[
                        {k:"3년평균ROE",v:`${re.avgRoe3}%`,c:re.avgRoe3>=15?C.green:re.avgRoe3>=10?C.gold:C.red},
                        {k:"TTM PER",v:re.ttmPer?`${re.ttmPer}배`:"—",c:re.ttmPer&&re.ttmPer<15?C.green:re.ttmPer&&re.ttmPer<25?C.gold:C.red},
                        {k:"PBR",v:re.pbr?`${re.pbr}배`:"—",c:re.pbr&&re.pbr<1.5?C.green:re.pbr&&re.pbr<3?C.gold:C.red},
                      ].map((it,i)=>(
                        <div key={i} style={{
                          display:"flex",alignItems:"center",gap:5,
                          background:C.bg,borderRadius:7,padding:"4px 9px",
                          border:`1px solid ${C.border}`,
                        }}>
                          <span style={{color:C.muted,fontSize:9}}>{it.k}</span>
                          <span style={{color:it.c,fontSize:11,fontWeight:800,fontFamily:"monospace"}}>{it.v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {hasFinData?(
              <>
              <Box>
                <ST accent={C.gold}>최근 연간 재무 요약 ({lastAnn.year}년)</ST>
                {(()=>{
                  const {unit:ou,scale:os}=autoUnit([lastAnn],["rev","op","net","fcf"]);
                  const fmtCard=(v)=>{
                    if(v==null)return"—";
                    const converted=os!==1?v/os:v;
                    return`${converted.toLocaleString(undefined,{maximumFractionDigits:1})}${ou}`;
                  };
                  return(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))",gap:6}}>
                    {[
                      {k:"매출액",   v:fmtCard(lastAnn.rev),                                         c:C.text},
                      {k:"영업이익", v:fmtCard(lastAnn.op),                                          c:C.green},
                      {k:"순이익",   v:fmtCard(lastAnn.net),                                         c:C.green},
                      {k:"OPM",      v:lastAnn.opm!=null?`${lastAnn.opm}%`:"—",                      c:C.gold},
                      {k:"ROE",      v:lastAnn.roe!=null?`${lastAnn.roe}%`:"—",                      c:C.blueL},
                      {k:"부채비율", v:lastAnn.debt!=null?`${(lastAnn.debt).toLocaleString()}%`:"—", c:(lastAnn.debt||0)>100?C.red:C.teal},
                      {k:"FCF",      v:fmtCard(lastAnn.fcf),                                         c:C.cyan},
                      {k:"EPS",      v:lastAnn.eps!=null?`${(lastAnn.eps).toLocaleString()}원`:"—",  c:C.purple},
                    ].map(item=>(
                      <div key={item.k} style={{background:C.card2,borderRadius:8,padding:"8px 10px",border:`1px solid ${C.border}`}}>
                        <div style={{color:C.muted,fontSize:9,marginBottom:2}}>{item.k}</div>
                        <div style={{color:item.c,fontSize:13,fontWeight:700,fontFamily:"monospace"}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  );
                })()}
              </Box>
              {/* ── 연간 실적 요약 테이블 ── */}
              {(()=>{
                const rows=(co?.annData||[]).filter(r=>r.year&&(r.rev||r.op||r.eps||r.fcf));
                if(!rows.length)return null;
                const {unit:tu,scale:ts}=autoUnit(rows,["rev","op"]);
                const fmtN=(v)=>v==null?"—":Math.round(v/ts).toLocaleString();
                return(
                <Box>
                  <ST accent={C.gold}>연간 실적 요약 ({tu}원, EPS·원)</ST>
                  <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:380}}>
                    <thead>
                      <tr style={{borderBottom:`1px solid ${C.border}`}}>
                        {["연도","매출","YoY","영업이익","OPM","EPS","FCF","ROE","부채%"].map(h=>(
                          <th key={h} style={{color:C.muted,fontWeight:600,padding:"5px 4px",textAlign:"right",whiteSpace:"nowrap"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r,i)=>{
                        const prev=rows[i-1];
                        const yoy=prev?.rev&&r.rev?+((r.rev-prev.rev)/Math.abs(prev.rev)*100).toFixed(1):null;
                        const isLatest=i===rows.length-1;
                        return(
                        <tr key={r.year} style={{borderBottom:`1px solid ${C.border}22`,background:isLatest?`${C.gold}0D`:"transparent"}}>
                          <td style={{color:isLatest?C.gold:C.muted,fontWeight:isLatest?700:400,padding:"5px 4px",textAlign:"right"}}>{r.year}</td>
                          <td style={{color:C.text,  padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{fmtN(r.rev)}</td>
                          <td style={{color:yoy==null?"transparent":yoy>=0?C.green:C.red,padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{yoy==null?"—":(yoy>0?"+":"")+yoy+"%"}</td>
                          <td style={{color:C.green, padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{fmtN(r.op)}</td>
                          <td style={{color:C.gold,  padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.opm!=null?r.opm+"%":"—"}</td>
                          <td style={{color:C.purple,padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.eps!=null?r.eps.toLocaleString():"—"}</td>
                          <td style={{color:C.cyan,  padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{fmtN(r.fcf)}</td>
                          <td style={{color:C.blueL, padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.roe!=null?r.roe+"%":"—"}</td>
                          <td style={{color:(r.debt||0)>100?C.red:C.teal,padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.debt!=null?r.debt+"%":"—"}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </Box>
                );
              })()}
              </>
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

        {/* ════ 주가·QMA ════ */}
        {tab==="price60"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {lastGap!==null&&(
              <div style={{background:`${gs.color}15`,border:`1px solid ${gs.color}44`,borderRadius:9,
                padding:"8px 13px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                <div style={{color:gs.color,fontWeight:700,fontSize:12}}>QMA 이격도: {lastGap>0?"+":""}{lastGap}%</div>
                <Tag color={gs.color} size={11}>{gs.label}</Tag>
                <div style={{color:C.muted,fontSize:9}}>≤-20%:적극매수 / ≤-0%:매수 / +100%:매도 / +150%:적극매도 / </div>
              </div>
            )}
            <ST accent={C.blue} right="▲매수 ▼매도">주가 & QMA 위치밴드</ST>
            <CW h={310}>
              <ComposedChart data={withPositionBands} margin={{top:20,right:40,left:0,bottom:8}}>
                <defs>
                  <linearGradient id="floorShadeP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.blue} stopOpacity={0.0}/>
                    <stop offset="100%" stopColor={C.blue} stopOpacity={0.14}/>
                  </linearGradient>
                  <linearGradient id="peakShadeP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.purple} stopOpacity={0.14}/>
                    <stop offset="100%" stopColor={C.purple} stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp()}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:9}} iconSize={10}/>
                <Area dataKey="bFloor"    name="VL ×0.6"  stroke="#3B7DD8"   strokeWidth={1}   strokeDasharray="3 4" fill={`${C.blue}00`}        dot={false} legendType="line"/>
                <Area dataKey="bKnee"     name="L ×0.8"   stroke={C.blue}    strokeWidth={1.5} strokeDasharray="6 3" fill="url(#floorShadeP)" dot={false} legendType="line"/>
                <Line dataKey="bBase"     name="QMA" stroke={C.goldL} strokeWidth={2} dot={false}/>
                <Line dataKey="bShoulder" name="H ×1.5"   stroke={C.orange}  strokeWidth={1.5} strokeDasharray="8 3" dot={false}/>
                <Line dataKey="bTop"      name="VH ×2.0"  stroke={C.red}     strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                <Area dataKey="bPeak"     name="EH ×2.5" stroke={C.purple}  strokeWidth={1}   strokeDasharray="3 4" fill="url(#peakShadeP)" dot={false} legendType="line"/>
                <Area dataKey="price"     name="주가"      stroke={C.blueL}   strokeWidth={2.5} fill={`${C.blueL}14`} dot={false}/>
                {(()=>{
                  const last=withPositionBands.filter(d=>d.bBase!=null).slice(-1)[0];
                  if(!last)return null;
                  return[
                    {key:"bPeak",    color:C.purple,  label:"EH"},
                    {key:"bTop",     color:C.red,     label:"VH"},
                    {key:"bShoulder",color:C.orange,  label:"H"},
                    {key:"bBase",    color:C.goldL,   label:"QMA"},
                    {key:"bFloor",   color:"#3B7DD8", label:"VL"},
                    {key:"bKnee",    color:C.blue,    label:"L"},
                  ].map(b=>(
                    <ReferenceDot key={b.key} x={last.label} y={last[b.key]} r={0}
                      label={{value:b.label,position:"right",fill:b.color,fontSize:9,fontWeight:700}}/>
                  ));
                })()}
                {signalPts.map((pt,i)=>(
                  <ReferenceDot key={i} x={pt.label} y={pt.price} r={0}
                    label={{value:pt.arrow,position:pt.pos==="bottom"?"bottom":"top",fill:pt.color,fontSize:18,fontWeight:900}}/>
                ))}
              </ComposedChart>
            </CW>
            <ST accent={C.teal}>QMA 이격도 (%)</ST>
            <CW h={180}>
              <ComposedChart data={withMA60Slice} margin={{top:4,right:20,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("%")}/>
                <Tooltip content={<MTip/>} cursor={false}/>
                <ReferenceArea y1={-100} y2={-40} fill={`${C.green}10`}/>
                <ReferenceArea y1={150} y2={500} fill={`${C.red}08`}/>
                <ReferenceLine y={0}   stroke={C.dim}   strokeDasharray="2 2"/>
                <ReferenceLine y={-40} stroke={C.green} strokeDasharray="4 2" label={{value:"VL -40%",fill:C.green,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={-20} stroke={C.teal}  strokeDasharray="4 2" label={{value:"L -20%",fill:C.teal,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={50}  stroke={C.gold}  strokeDasharray="4 2" label={{value:"H +50%",fill:C.gold,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={100} stroke={C.orange} strokeDasharray="4 2" label={{value:"VH +100%",fill:C.orange,fontSize:9,position:"insideTopRight"}}/>
                <ReferenceLine y={150} stroke={C.red}   strokeDasharray="4 2" label={{value:"EH +150%",fill:C.red,fontSize:9,position:"insideTopRight"}}/>
                <Bar dataKey="gap60" name="이격도(%)" maxBarSize={8} radius={[2,2,0,0]} fill={C.teal}/>
              </ComposedChart>
            </CW>


          </div>
        )}


        {/* ════ 경제적 해자 ════ */}
        {tab==="moat"&&(
          <MoatTab annData={co?.annData||[]} hasFinData={hasFinData}/>
        )}

        {/* ════ PER/PBR ════ */}
        {tab==="perbpr"&&(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {/* ── 밴드 배수 설정 ── */}
            <Box>
              <ST accent={C.gold}>📐 밴드 배수 설정</ST>
              {(()=>{
                const autoVal=withBands[0]?._adaptive||BAND_DEFAULT;
                const fields=[
                  {key:"perLo", label:"PER 저평가(배)", step:0.1},
                  {key:"perMid",label:"PER 적정(배)",   step:0.1},
                  {key:"perHi", label:"PER 고평가(배)", step:0.1},
                  {key:"pbrLo", label:"PBR 저평가(배)", step:0.1},
                  {key:"pbrMid",label:"PBR 적정(배)",   step:0.1},
                  {key:"pbrHi", label:"PBR 고평가(배)", step:0.1},
                ];
                const isAuto=bandApplied===null;
                return(<>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                  {fields.map(f=>{
                    const hasCustom=bandDraft?.[f.key]!=null;
                    return(
                    <div key={f.key}>
                      <div style={{color:C.muted,fontSize:10,marginBottom:4}}>{f.label}</div>
                      <input type="number" step={f.step} min={0.1}
                        value={bandDraft?.[f.key]??''}
                        placeholder={String(autoVal[f.key])}
                        onChange={e=>{
                          const v=e.target.value===""?null:+e.target.value;
                          setBandDraft(p=>({...(p||{}),[f.key]:v}));
                        }}
                        onFocus={e=>e.target.select()}
                        style={{width:"100%",background:C.card2,color:C.text,
                          border:`1px solid ${hasCustom?C.purple:C.border}`,
                          borderRadius:6,padding:"5px 8px",fontSize:12,outline:"none",fontFamily:"monospace",boxSizing:"border-box"}}/>
                    </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                  <div style={{color:C.muted,fontSize:11}}>
                    PER <span style={{color:C.green,fontWeight:700}}>{autoVal.perLo}</span>배 ·
                    <span style={{color:C.gold,fontWeight:700}}> {autoVal.perMid}</span>배 ·
                    <span style={{color:C.red,fontWeight:700}}> {autoVal.perHi}</span>배 &nbsp;|&nbsp;
                    PBR <span style={{color:C.green,fontWeight:700}}>{autoVal.pbrLo}</span>배 ·
                    <span style={{color:C.gold,fontWeight:700}}> {autoVal.pbrMid}</span>배 ·
                    <span style={{color:C.red,fontWeight:700}}> {autoVal.pbrHi}</span>배
                    {isAuto&&<span style={{color:C.teal,fontSize:9,marginLeft:6}}>[종목 자동]</span>}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setBandDraft(null);setBandApplied(null);}}
                      style={{background:C.card2,color:C.muted,border:`1px solid ${C.border}`,
                        borderRadius:8,padding:"7px 14px",fontSize:11,cursor:"pointer"}}>
                      기본값
                    </button>
                    <button onClick={()=>{
                      // 수동입력값과 자동값을 합쳐서 적용
                      const merged={...autoVal};
                      if(bandDraft){Object.entries(bandDraft).forEach(([k,v])=>{if(v!=null)merged[k]=v;});}
                      setBandApplied(merged);
                    }}
                      style={{background:`linear-gradient(135deg,${C.purple},${C.pink})`,color:"#fff",
                        border:"none",borderRadius:8,padding:"7px 18px",fontSize:12,cursor:"pointer",fontWeight:700}}>
                      ⚡ 밴드 재계산 적용
                    </button>
                  </div>
                </div>
                </>);
              })()}
            </Box>
            {co?.annData?.length||co?.qtrData?.length?(
              <>
                {(()=>{const a=withBands[0]?._adaptive||bandApplied;return(<>
                <ST accent={C.purple}>PER 밴드 ({a.perLo}배·{a.perMid}배·{a.perHi}배)</ST>
                <CW h={270}>
                  <ComposedChart data={withBands} margin={{top:4,right:20,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <Area dataKey="perHi"  name={`PER ${a.perHi}배`}  stroke={C.red}   fill={`${C.red}10`}   strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                    <Area dataKey="perMid" name={`PER ${a.perMid}배`} stroke={C.gold}  fill={`${C.gold}08`}  strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                    <Area dataKey="perLo"  name={`PER ${a.perLo}배`}  stroke={C.green} fill={`${C.green}10`} strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                    <Line dataKey="price" name="주가"      stroke={C.blueL}  strokeWidth={2.5}    dot={false}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.cyan}>PBR 밴드 ({a.pbrLo}배·{a.pbrMid}배·{a.pbrHi}배)</ST>
                <CW h={240}>
                  <ComposedChart data={withBands} margin={{top:4,right:20,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <Area dataKey="pbrHi"  name={`PBR ${a.pbrHi}배`}  stroke={C.red}   fill={`${C.red}10`}   strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                    <Area dataKey="pbrMid" name={`PBR ${a.pbrMid}배`} stroke={C.gold}  fill={`${C.gold}08`}  strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                    <Area dataKey="pbrLo"  name={`PBR ${a.pbrLo}배`}  stroke={C.green} fill={`${C.green}10`} strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                    <Line dataKey="price"  name="주가"       stroke={C.blueL}  strokeWidth={2.5}     dot={false}/>
                  </ComposedChart>
                </CW>
                </>);})()}
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
                  {(()=>{const {unit:u1,scale:s1}=autoUnit(data,["rev","op","net"]);const d1=scaleData(data,["rev","op","net"],s1);return(<>
                  <ST accent={C.green} right={u1+"원"}>매출·영업이익·순이익</ST>
                  <CW h={240}>
                    <ComposedChart data={d1} margin={{top:4,right:20,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp(u1)}/>
                      <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="rev" name="매출액"   fill={C.blue}   opacity={0.7} maxBarSize={24}/>
                      <Bar dataKey="op"  name="영업이익" fill={C.green}  opacity={0.8} maxBarSize={24}/>
                      <Bar dataKey="net" name="순이익"   fill={C.purple} opacity={0.7} maxBarSize={24}/>
                    </ComposedChart>
                  </CW></>);})()}
                  {/* 영업이익률·순이익률(막대·좌축) + 성장률 YoY(꺾은선·우축) */}
                  <ST accent={C.gold}>이익률 & 성장률</ST>
                  <CW h={220}>
                    {(()=>{
                      const merged=growthData.map(r=>{
                        const base=finView==="연간"?annTimeline:qtrTimeline;
                        const match=base.find(b=>b.period===r.period);
                        return{...r,opm:match?.opm??null,npm:match?.npm??null};
                      });
                      return(
                        <ComposedChart data={merged} margin={{top:4,right:4,left:0,bottom:8}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                          <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                          <YAxis yAxisId="left"  {...yp("%",44)} domain={["auto","auto"]}/>
                          <YAxis yAxisId="right" orientation="right" {...yp("%",44)} domain={["auto","auto"]}/>
                          <Tooltip content={<MTip/>} cursor={false}/>
                          <Legend wrapperStyle={{fontSize:10,paddingTop:4}}/>
                          <ReferenceLine yAxisId="right" y={0} stroke={C.muted} strokeDasharray="4 3"/>
                          <Bar yAxisId="left" dataKey="opm" name="OPM%" fill={C.gold}   opacity={0.75} maxBarSize={22} radius={[3,3,0,0]}/>
                          <Bar yAxisId="left" dataKey="npm" name="NPM%" fill={C.purple} opacity={0.65} maxBarSize={22} radius={[3,3,0,0]}/>
                          <Line yAxisId="right" dataKey="revGrowth" name="매출YoY%" stroke={C.blue}  strokeWidth={2} dot={{r:3}} connectNulls/>
                          <Line yAxisId="right" dataKey="opGrowth"  name="영업YoY%" stroke={C.green} strokeWidth={2} dot={{r:3}} connectNulls/>
                        </ComposedChart>
                      );
                    })()}
                  </CW>
                  <ST accent={C.gold} right="%">OPM · ROE · ROA</ST>
                  <CW h={230}>
                    {(()=>{
                      const merged=growthData.map(r=>{
                        const base=finView==="연간"?annTimeline:qtrTimeline;
                        const match=base.find(b=>b.period===r.period);
                        return{...r,opm:match?.opm??null,roe:match?.roe??null,roa:match?.roa??null};
                      });
                      return(
                      <ComposedChart data={merged} margin={{top:8,right:4,left:0,bottom:8}}>
                        <defs>
                          <linearGradient id="roeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={C.purple} stopOpacity={0.35}/>
                            <stop offset="95%" stopColor={C.purple} stopOpacity={0.02}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                        <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                        <YAxis {...yp("%")} domain={[0,"auto"]}/>
                        <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10,paddingTop:4}}/>
                        <ReferenceLine y={15} stroke={C.purple} strokeDasharray="4 3"
                          label={{value:"ROE 15%",fill:C.purple,fontSize:9,position:"insideTopRight"}}/>
                        <Bar  dataKey="opm" name="OPM%" fill={C.gold} opacity={0.55} maxBarSize={22} radius={[3,3,0,0]}/>
                        <Area dataKey="roe" name="ROE%" stroke={C.purple} strokeWidth={2.5} fill="url(#roeGrad)" dot={{r:3,fill:C.purple,strokeWidth:0}} connectNulls/>
                        <Line dataKey="roa" name="ROA%" stroke={C.blueL} strokeWidth={2} dot={{r:2.5,fill:C.blueL,strokeWidth:0}} strokeDasharray="5 2" connectNulls/>
                      </ComposedChart>
                      );
                    })()}
                  </CW>
                  {/* 수정 3: 현금흐름 — 막대 4개 + 0선 점선 */}
                  {(()=>{const {unit:uc,scale:sc}=autoUnit(data,["fcf","cfo","cfi","cff"]);const dc=scaleData(data,["fcf","cfo","cfi","cff"],sc);return(<>
                  <ST accent={C.cyan} right={uc+"원"}>현금흐름</ST>
                  <CW h={230}>
                    <ComposedChart data={dc} margin={{top:4,right:8,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp(uc,52)}/>
                      <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10}}/>
                      <ReferenceLine y={0} stroke={C.muted} strokeDasharray="4 3"/>
                      <Bar  dataKey="fcf" name={`FCF(${uc})`} fill={C.blueL}  opacity={0.85} maxBarSize={20} radius={[3,3,0,0]}/>
                      <Line dataKey="cfo" name="영업CF" stroke={C.pink}   strokeWidth={2.5} dot={{r:3,fill:C.pink,strokeWidth:0}} connectNulls/>
                      <Line dataKey="cfi" name="투자CF" stroke={C.gold}   strokeWidth={2}   dot={{r:3,fill:C.gold,strokeWidth:0}} connectNulls strokeDasharray="4 2"/>
                      <Line dataKey="cff" name="재무CF" stroke={C.green}  strokeWidth={1.5} dot={{r:2.5,fill:C.green,strokeWidth:0}} connectNulls strokeDasharray="2 2"/>
                    </ComposedChart>
                  </CW></>);})()}
                  {/* EPS · FCF · 주가 동행 */}
                  {epsPriceData.length>=2&&(
                    <>
                      <ST accent={C.purple}>EPS · 주가 동행 추이</ST>
                      <CW h={240}>
                        <ComposedChart data={epsPriceData} margin={{top:8,right:8,left:0,bottom:8}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                          <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                          <YAxis yAxisId="eps" orientation="left"
                            tick={{fill:"#F97316",fontSize:10}} width={48}
                            tickFormatter={v=>v.toLocaleString()}
                            stroke="#F97316" tickCount={5}
                            domain={([min,max])=>{const pad=(max-min)*0.4||Math.abs(max)*0.3||100;return[Math.floor(min-pad),Math.ceil(max+pad)];}}/>
                          <YAxis yAxisId="price" orientation="right"
                            tick={{fill:"#38BDF8",fontSize:10}} width={48}
                            tickFormatter={v=>v.toLocaleString()}
                            stroke="#38BDF8" tickCount={5}
                            domain={([min,max])=>{const pad=(max-min)*0.4||Math.abs(max)*0.3||1000;return[Math.floor(min-pad),Math.ceil(max+pad)];}}/>
                          <Tooltip content={<MTip/>} cursor={false}/>
                          <Legend wrapperStyle={{fontSize:10,paddingTop:4}}/>
                          <Line yAxisId="eps" dataKey="eps" name="EPS(원)"
                            stroke="#F97316" strokeWidth={2} strokeDasharray="6 3"
                            dot={{r:4,fill:"#F97316",strokeWidth:0}}
                            activeDot={{r:6}}/>
                          <Line yAxisId="price" dataKey="price" name="주가(원)"
                            stroke="#38BDF8" strokeWidth={2.5}
                            dot={{r:4,fill:"#38BDF8",strokeWidth:0}}
                            activeDot={{r:6}}/>
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

            {/* 위치 판독 안내 뱃지 */}
            <div style={{background:`${C.card2}`,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 13px",marginBottom:10}}>
              <div style={{color:C.muted,fontSize:9,marginBottom:6,letterSpacing:"0.06em"}}>📐 QMA 가격 위치 밴드 기준</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {[
                  {label:"VL",  sub:"×0.6↓",color:"#3B7DD8"},
                  {label:"L",   sub:"×0.8",  color:C.blue},
                  {label:"QMA",sub:"×1.0",  color:C.goldL},
                  {label:"H",   sub:"×1.5",  color:C.orange},
                  {label:"VH",  sub:"×2.0",  color:C.red},
                  {label:"EH", sub:"×2.5↑", color:C.purple},
                ].map(b=>(
                  <div key={b.label} style={{display:"flex",alignItems:"center",gap:4,
                    background:`${b.color}18`,borderRadius:6,padding:"3px 8px",
                    border:`1px solid ${b.color}44`}}>
                    <div style={{width:8,height:8,borderRadius:2,background:b.color,flexShrink:0}}/>
                    <span style={{color:b.color,fontSize:9,fontWeight:700}}>{b.label}</span>
                    <span style={{color:C.muted,fontSize:8}}>{b.sub}</span>
                  </div>
                ))}
              </div>
            </div>

            <ST accent={C.gold} right="QMA 배수 기준 위치 밴드">가격 위치 밴드</ST>
            <CW h={310}>
              <ComposedChart data={withPositionBands} margin={{top:8,right:40,left:0,bottom:8}}>
                <defs>
                  <linearGradient id="floorShade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.blue} stopOpacity={0.0}/>
                    <stop offset="100%" stopColor={C.blue} stopOpacity={0.18}/>
                  </linearGradient>
                  <linearGradient id="peakShade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.purple} stopOpacity={0.18}/>
                    <stop offset="100%" stopColor={C.purple} stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp()}/>
                <YAxis {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                <Tooltip content={<MTip/>} cursor={false}/>
                <Legend wrapperStyle={{fontSize:9}} iconSize={10}/>
                <Area dataKey="bFloor"    name="VL ×0.6"  stroke="#3B7DD8"   strokeWidth={1}   strokeDasharray="3 4" fill={`${C.blue}00`}    dot={false} legendType="line"/>
                <Area dataKey="bKnee"     name="L ×0.8"   stroke={C.blue}    strokeWidth={2}   strokeDasharray="6 3" fill="url(#floorShade)" dot={false} legendType="line"/>
                <Line dataKey="bBase"     name="QMA" stroke={C.goldL} strokeWidth={2.5} dot={false} legendType="line"/>
                <Line dataKey="bShoulder" name="H ×1.5"   stroke={C.orange}  strokeWidth={2}   strokeDasharray="8 3" dot={false}/>
                <Line dataKey="bTop"      name="VH ×2.0"  stroke={C.red}     strokeWidth={2}   strokeDasharray="5 3" dot={false}/>
                <Area dataKey="bPeak"     name="EH ×2.5" stroke={C.purple}  strokeWidth={1.5} strokeDasharray="3 4" fill="url(#peakShade)"  dot={false} legendType="line"/>
                <Line dataKey="price"     name="주가"      stroke={C.blueL}   strokeWidth={3}   dot={false} legendType="line"/>
                {(()=>{
                  const last=withPositionBands.filter(d=>d.bBase!=null).slice(-1)[0];
                  if(!last)return null;
                  return[
                    {key:"bPeak",    color:C.purple, label:"EH"},
                    {key:"bTop",     color:C.red,    label:"VH"},
                    {key:"bShoulder",color:C.orange, label:"H"},
                    {key:"bBase",    color:C.goldL,  label:"QMA"},
                    {key:"bFloor",   color:"#3B7DD8",label:"VL"},
                    {key:"bKnee",    color:C.blue,   label:"L"},
                  ].map(b=>(
                    <ReferenceDot key={b.key} x={last.label} y={last[b.key]} r={0}
                      label={{value:b.label,position:"right",fill:b.color,fontSize:9,fontWeight:700}}/>
                  ));
                })()}
                {signalPts.map((pt,i)=>(
                  <ReferenceDot key={i} x={pt.label} y={pt.price} r={0}
                    label={{value:pt.arrow,position:pt.pos==="bottom"?"bottom":"top",fill:pt.color,fontSize:16,fontWeight:900}}/>
                ))}
              </ComposedChart>
            </CW>


            {/* 현재 위치 상태 카드 */}
            {lastGap!==null&&(()=>{
              const last=withPositionBands.filter(d=>d.bBase!=null).slice(-1)[0];
              if(!last)return null;
              const {priceZone,priceZoneColor,gap}=readingEngine;
              return(
                <div style={{
                  background:`${priceZoneColor}12`,
                  border:`1.5px solid ${priceZoneColor}44`,
                  borderRadius:10,padding:"10px 14px",marginBottom:10,
                  display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,
                }}>
                  <div>
                    <div style={{color:C.muted,fontSize:9,marginBottom:3}}>현재 가격 위치</div>
                    <div style={{color:priceZoneColor,fontSize:20,fontWeight:900,fontFamily:"monospace"}}>{priceZone}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{color:C.muted,fontSize:9,marginBottom:2}}>QMA 이격도</div>
                    <div style={{color:priceZoneColor,fontSize:18,fontWeight:900,fontFamily:"monospace"}}>
                      {gap>0?"+":""}{gap}%
                    </div>
                  </div>
                  <div style={{flex:1,minWidth:120}}>
                    <div style={{color:C.muted,fontSize:8,marginBottom:4}}>구간 기준</div>
                    <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                      {/* QMA 종류 뱃지 */}
                      <span style={{
                        fontSize:9,color:C.goldL,fontWeight:700,
                        background:`${C.goldL}18`,border:`1px solid ${C.goldL}44`,
                        borderRadius:4,padding:"2px 8px",display:"inline-block",marginBottom:4,
                      }}>
                        기준선: QMA
                      </span>
                      {[
                        {z:"VL",  r:"-40%↓", c:"#3B7DD8"},
                        {z:"L",   r:"-20%",  c:C.blue},
                        {z:"M",   r:"0~+50%",c:C.green},
                        {z:"H",   r:"+50%",  c:C.orange},
                        {z:"VH",  r:"+100%", c:C.red},
                        {z:"EH",  r:"+150%↑",c:C.purple},
                      ].map(z=>(
                        <span key={z.z} style={{
                          background:priceZone===z.z?`${z.c}30`:"transparent",
                          color:priceZone===z.z?z.c:C.muted,
                          border:`1px solid ${priceZone===z.z?z.c:C.border}`,
                          borderRadius:4,padding:"2px 5px",fontSize:8,fontWeight:700,
                        }}>{z.z}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
            <ST accent={C.green}>RSI (14개월)</ST>
            <CW h={148}>
              <ComposedChart data={withRSI} margin={{top:4,right:20,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>} cursor={false}/>
                <ReferenceArea y1={70} y2={100} fill={`${C.red}12`}/><ReferenceArea y1={0} y2={30} fill={`${C.green}12`}/>
                <ReferenceLine y={70} stroke={C.red}   strokeDasharray="4 2" label={{value:"과매수70",fill:C.red,  fontSize:9}}/>
                <ReferenceLine y={30} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도30",fill:C.green,fontSize:9}}/>
                <Area dataKey="rsi" name="RSI(%)" stroke={C.green} strokeWidth={2} fill={`${C.green}18`} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.blueL}>MACD</ST>
            <CW h={148}>
              <ComposedChart data={withMACD} margin={{top:4,right:20,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("",38)}/>
                <Tooltip content={<MTip/>} cursor={false}/>
                <ReferenceLine y={0} stroke={C.dim}/>
                <Bar dataKey="hist" name="히스토그램" maxBarSize={6} radius={[2,2,0,0]} fill={C.blueL} fillOpacity={0.65}/>
                <Line dataKey="macd"   name="MACD"   stroke={C.blueL}  strokeWidth={2}   dot={false}/>
                <Line dataKey="signal" name="Signal" stroke={C.orange} strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </CW>
            <ST accent={C.teal}>OBV</ST>
            <CW h={128}>
              <AreaChart data={withOBV} margin={{top:4,right:20,left:0,bottom:8}}>
                <defs><linearGradient id="obvG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.teal} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.teal} stopOpacity={0}/>
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis {...yp("",44)} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/>
                <Tooltip content={<MTip/>} cursor={false}/>
                <Area dataKey="obv" name="OBV" stroke={C.teal} strokeWidth={2} fill="url(#obvG)" dot={false}/>
              </AreaChart>
            </CW>
            <ST accent={C.pink}>MFI</ST>
            <CW h={128}>
              <ComposedChart data={withMFI} margin={{top:4,right:20,left:0,bottom:8}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                <XAxis {...xp(rangeIdx===0)}/><YAxis domain={[0,100]} {...yp("%")}/>
                <Tooltip content={<MTip/>} cursor={false}/>
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
              {(()=>{
                const DCF_DEFAULT={bondYield:3.5,riskPrem:2.0,gr:8.0,reqReturn:10.0,capexRatio:50};
                const fields=[
                  {key:"bondYield",label:"국고채 금리(%)",min:0,max:10,step:0.1},
                  {key:"riskPrem", label:"리스크 프리미엄(%)",min:0,max:10,step:0.5},
                  {key:"gr",       label:"기업 성장률(%)",min:0,max:30,step:0.5},
                  {key:"reqReturn",label:"요구수익률(%)",min:1,max:20,step:0.5},
                  {key:"capexRatio",label:"유지CAPEX 비율(%)",min:0,max:100,step:5},
                ];
                return(<>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:12}}>
                  {fields.map(f=>{
                    const isModified=dcfDraft[f.key]!=null&&dcfDraft[f.key]!==DCF_DEFAULT[f.key];
                    return(
                    <div key={f.key}>
                      <div style={{color:C.muted,fontSize:10,marginBottom:4}}>{f.label}</div>
                      <input type="number" min={f.min} max={f.max} step={f.step}
                        value={dcfDraft[f.key]??''}
                        placeholder={String(DCF_DEFAULT[f.key])}
                        onChange={e=>setDcfDraft(p=>({...p,[f.key]:e.target.value===""?null:+e.target.value}))}
                        onFocus={e=>e.target.select()}
                        style={{width:"100%",background:C.card2,color:C.text,
                          border:`1px solid ${isModified?C.purple:C.border}`,
                          borderRadius:6,padding:"5px 8px",fontSize:12,outline:"none",
                          fontFamily:"monospace",boxSizing:"border-box"}}/>
                    </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                  <div style={{color:C.muted,fontSize:11}}>
                    할인율: <span style={{color:C.gold,fontWeight:700}}>{((dcfDraft.bondYield??DCF_DEFAULT.bondYield)+(dcfDraft.riskPrem??DCF_DEFAULT.riskPrem)).toFixed(1)}%</span>
                  </div>
                  <div style={{display:"flex",gap:8,marginLeft:"auto"}}>
                    <button onClick={()=>{setDcfDraft({});setDcfApplied({...DCF_DEFAULT});}}
                      style={{background:C.card2,color:C.muted,border:`1px solid ${C.border}`,
                        borderRadius:8,padding:"7px 14px",fontSize:11,cursor:"pointer"}}>
                      기본값
                    </button>
                    <button onClick={()=>setDcfApplied({...DCF_DEFAULT,...Object.fromEntries(Object.entries(dcfDraft).filter(([,v])=>v!=null&&v!==''))})}
                      style={{background:`linear-gradient(135deg,${C.blue},${C.blueL})`,color:"#fff",
                        border:"none",borderRadius:8,padding:"7px 18px",fontSize:12,cursor:"pointer",fontWeight:700}}>
                      ⚡ DCF 재계산 적용
                    </button>
                  </div>
                </div>
                </>);
              })()}
            </Box>
            <Box style={{border:`2px solid ${C.gold}33`}}>
              <ST accent={C.gold}>내재가치 교차검증 ({lastAnn.year||"—"}년 기준)</ST>
              {hasFinData?(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:12}}>
                    {[
                      {label:"A. DCF(오너이익)",sub:`버핏 방식 · 유지CAPEX ${dcfApplied.capexRatio}% 적용`,val:dcfResults.d,color:C.orange},
                      {label:"B. DCF(금리기반)",sub:`할인율 ${(dcfApplied.bondYield+dcfApplied.riskPrem).toFixed(1)}% · 성장률 ${dcfApplied.gr}%`,val:dcfResults.a,color:C.blue},
                      {label:"C. 그레이엄멀티플",sub:"V=EPS×(8.5+2g)×4.4/Y",val:dcfResults.b,color:C.purple},
                      {label:"D. ROE멀티플",sub:"적정가=ROE×EPS (적정PER=ROE)",val:dcfResults.c,color:C.teal},
                      {label:"내재가치 평균",sub:"4가지 방식 교차검증 종합",val:dcfResults.avg,color:C.gold},
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

                  {/* 역DCF 박스 */}
                  {dcfResults.impliedGr!==null&&price>0&&(
                    <div style={{background:`linear-gradient(135deg,${C.cyan}10,${C.card2})`,border:`1.5px solid ${C.cyan}44`,borderRadius:12,padding:"12px 14px",marginBottom:12}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                        <div>
                          <div style={{color:C.cyan,fontSize:11,fontWeight:800,marginBottom:3}}>🔍 역DCF — 버핏의 질문</div>
                          <div style={{color:C.muted,fontSize:9,lineHeight:1.6}}>
                            현재 주가 <span style={{color:C.text,fontWeight:700}}>{price.toLocaleString()}원</span>이 정당하려면<br/>
                            앞으로 <span style={{color:C.cyan,fontSize:13,fontWeight:900,fontFamily:"monospace"}}>{dcfResults.impliedGr}%</span> 연간 성장이 필요합니다.
                          </div>
                        </div>
                        <div style={{textAlign:"center",background:C.bg,borderRadius:10,padding:"8px 14px"}}>
                          <div style={{color:C.muted,fontSize:8,marginBottom:2}}>내재 성장률</div>
                          <div style={{color:dcfResults.impliedGr<=dcfApplied.gr?C.green:dcfResults.impliedGr<=dcfApplied.gr*1.5?C.gold:C.red,
                            fontSize:22,fontWeight:900,fontFamily:"monospace"}}>{dcfResults.impliedGr}%</div>
                          <div style={{marginTop:4}}>
                            <Tag color={dcfResults.impliedGr<=dcfApplied.gr?C.green:dcfResults.impliedGr<=dcfApplied.gr*1.5?C.gold:C.red} size={8}>
                              {dcfResults.impliedGr<=dcfApplied.gr?"달성가능":dcfResults.impliedGr<=dcfApplied.gr*1.5?"도전적":"매우높음"}
                            </Tag>
                          </div>
                        </div>
                      </div>
                      <div style={{marginTop:10,padding:"8px 10px",background:C.bg,borderRadius:8,fontSize:9,color:C.muted,lineHeight:1.7}}>
                        💡 설정 성장률 <span style={{color:C.gold,fontWeight:700}}>{dcfApplied.gr}%</span> 대비 내재 성장률이
                        <span style={{color:dcfResults.impliedGr<=dcfApplied.gr?C.green:C.red,fontWeight:700}}>
                          {dcfResults.impliedGr<=dcfApplied.gr?" 낮으면 저평가":" 높으면 고평가"}
                        </span> 가능성 — 할인율 {(dcfApplied.bondYield+dcfApplied.riskPrem).toFixed(1)}% 기준
                      </div>
                    </div>
                  )}
                  {dcfHistory.length>=2&&(()=>{
                    const {unit:du,scale:ds}=autoUnit(dcfHistory,["fcf"]);
                    const dcfScaled=scaleData(dcfHistory,["fcf"],ds);
                    return(
                    <>
                      <ST accent={C.gold}>연도별 적정주가 추이 (4가지 방식)</ST>
                      <CW h={260}>
                        <ComposedChart data={dcfScaled} margin={{top:4,right:12,left:0,bottom:8}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                          <XAxis dataKey="year" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                          <YAxis yAxisId="left" {...yp("원",56)} tickFormatter={v=>v.toLocaleString()}/>
                          <YAxis yAxisId="right" orientation="right" {...yp(du,44)} tickFormatter={v=>v.toLocaleString()}/>
                          <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10}}/>
                          <Bar  yAxisId="right" dataKey="fcf"    name={`FCF(${du})`}   fill={C.teal}   opacity={0.4} maxBarSize={28}/>
                          <Line yAxisId="left"  dataKey="owner"  name="DCF(오너이익)"  stroke={C.orange} strokeWidth={2.5} dot={{r:4,fill:C.orange}} connectNulls/>
                          <Line yAxisId="left"  dataKey="rate"   name="DCF(금리기반)"  stroke={C.blue}   strokeWidth={2}   dot={{r:3,fill:C.blue}}   connectNulls strokeDasharray="5 2"/>
                          <Line yAxisId="left"  dataKey="graham" name="그레이엄멀티플" stroke={C.purple} strokeWidth={2}   dot={{r:3,fill:C.purple}} connectNulls strokeDasharray="3 2"/>
                          <Line yAxisId="left"  dataKey="roe"    name="ROE멀티플"      stroke={C.pink}   strokeWidth={2}   dot={{r:3,fill:C.pink}}   connectNulls strokeDasharray="2 2"/>
                          {price>0&&<ReferenceLine yAxisId="left" y={price} stroke={C.blueL} strokeDasharray="4 2"
                            label={{value:`현재가 ${price.toLocaleString()}원`,fill:C.blueL,fontSize:9,position:"insideTopRight"}}/>}
                        </ComposedChart>
                      </CW>
                    </>
                    );
                  })()}

                      {/* 유지CAPEX 비율 업종 참조표 */}
                      <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginTop:4}}>
                        <div style={{color:C.gold,fontSize:10,fontWeight:700,marginBottom:8}}>📋 유지CAPEX 비율 업종별 참조</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                          {[
                            ["🏭 중공업·조선·철강","80~90%"],
                            ["⚙️ 자동차·부품 제조","70~80%"],
                            ["🔬 의료기기·정밀기계","50~65%"],
                            ["💊 제약·바이오","40~55%"],
                            ["🏗 건설·건자재","60~75%"],
                            ["🛒 유통·소비재","40~55%"],
                            ["💻 IT·소프트웨어","20~35%"],
                            ["📱 플랫폼·인터넷","15~30%"],
                            ["🏦 금융·보험","10~20%"],
                            ["⚡ 전기·에너지·유틸리티","75~85%"],
                          ].map(([sector,ratio])=>(
                            <div key={sector} style={{display:"flex",justifyContent:"space-between",
                              padding:"5px 8px",background:C.bg,borderRadius:6,alignItems:"center"}}>
                              <span style={{color:C.muted,fontSize:sector==="⚡ 전기·에너지·유틸리티"?9:10}}>{sector}</span>
                              <span style={{color:C.gold,fontSize:10,fontWeight:700,fontFamily:"monospace"}}>{ratio}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{color:C.dim,fontSize:8,marginTop:8,lineHeight:1.5}}>
                          ※ 유지CAPEX = 사업 현상유지에 필요한 최소 설비투자. 높을수록 보수적 평가. DCF 파라미터에서 조정 가능.
                        </div>
                      </div>
            
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
                  <ST accent={C.teal}>자본유보율(좌축) · 부채비율(우축)</ST>
                  <CW h={230}>
                    <ComposedChart data={data} margin={{top:4,right:12,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis yAxisId="left"  {...yp("%",52)} domain={[0,"auto"]}/>
                      <YAxis yAxisId="right" orientation="right" {...yp("%",48)} domain={[0,"auto"]}/>
                      <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10}}/>
                      <ReferenceLine yAxisId="right" y={100} stroke={C.orange} strokeDasharray="4 2" label={{value:"부채100%",fill:C.orange,fontSize:9,position:"insideTopRight"}}/>
                      <Bar  yAxisId="right" dataKey="debt"     name="부채비율%"   fill={C.red}  opacity={0.55} maxBarSize={28}/>
                      <Line yAxisId="left"  dataKey="retained" name="자본유보율%" stroke={C.teal} strokeWidth={2.5} dot={{r:3}}/>
                    </ComposedChart>
                  </CW>
                  {(()=>{const {unit:ua,scale:sa}=autoUnit(data,["assets","liab","equity"]);const da=scaleData(data,["assets","liab","equity"],sa);return(<>
                  <ST accent={C.green}>자산·부채·자본 ({ua}원)</ST>
                  <CW h={220}>
                    <ComposedChart data={da} margin={{top:4,right:20,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis {...yp(ua)}/>
                      <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="assets" name="자산총계" fill={C.blue}  opacity={0.6} maxBarSize={24}/>
                      <Bar dataKey="liab"   name="부채총계" fill={C.red}   opacity={0.6} maxBarSize={24}/>
                      <Bar dataKey="equity" name="자본총계" fill={C.green} opacity={0.7} maxBarSize={24}/>
                    </ComposedChart>
                  </CW>
                  <ST accent={C.blue}>자본·부채 적층(좌축) + 부채비율 꺾은선(우축)</ST>
                  <CW h={230}>
                    <ComposedChart data={da} margin={{top:4,right:12,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="period" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                      <YAxis yAxisId="left"  {...yp(ua,48)}/>
                      <YAxis yAxisId="right" orientation="right" {...yp("%",52)} domain={[0,"auto"]}/>
                      <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10}}/>
                      <Bar yAxisId="left" dataKey="equity" name="자본총계" stackId="s" fill={C.green} opacity={0.75} maxBarSize={28}/>
                      <Bar yAxisId="left" dataKey="liab"   name="부채총계" stackId="s" fill={C.red}   opacity={0.65} maxBarSize={28}/>
                      <Line yAxisId="right" dataKey="debt" name="부채비율%" stroke={C.orange} strokeWidth={2.5} dot={{r:3}}/>
                      <ReferenceLine yAxisId="right" y={100} stroke={C.orange} strokeDasharray="4 2" label={{value:"100%",fill:C.orange,fontSize:9,position:"insideTopRight"}}/>
                    </ComposedChart>
                  </CW></>);})()}
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
                  <ComposedChart data={co.divData} margin={{top:4,right:20,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={{stroke:C.border}}/>
                    <YAxis {...yp("원")}/><Tooltip content={<MTip/>} cursor={false}/>
                    <Bar dataKey="dps" name="DPS(원)" fill={C.gold} opacity={0.8} maxBarSize={40} radius={[4,4,0,0]}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.green}>배당수익률(막대·우축) · 배당성향(꺾은선·좌축)</ST>
                <CW h={200}>
                  <ComposedChart data={co.divData} margin={{top:4,right:12,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={{stroke:C.border}}/>
                    <YAxis yAxisId="left"  {...yp("%",48)} domain={[0,"auto"]}/>
                    <YAxis yAxisId="right" orientation="right" {...yp("%",52)} domain={[0,"auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10}}/>
                    <Bar  yAxisId="right" dataKey="divYield"  name="배당수익률%" fill={C.green}  opacity={0.8} maxBarSize={36} radius={[4,4,0,0]}/>
                    <Line yAxisId="left"  dataKey="divPayout" name="배당성향%"   stroke={C.purple} strokeWidth={2.5} dot={{r:4}}/>
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


        {/* ════ 투자거장의 말 ════ */}
        {tab==="buffett"&&(()=>{
          const CATS=["전체","시장심리","기업분석","장기투자","리스크","경영진","가치평가","인생"];
          const CAT_COLOR={"시장심리":C.orange,"기업분석":C.blue,"장기투자":C.green,"리스크":C.red,"경영진":C.purple,"가치평가":C.gold,"인생":C.cyan};
          const CAT_ICON={"시장심리":"🌊","기업분석":"🔍","장기투자":"🌳","리스크":"⚠️","경영진":"👔","가치평가":"💎","인생":"🌟"};
          const Q=[
            // ── 시장심리
            {id:1,cat:"시장심리",en:"Be fearful when others are greedy, and greedy when others are fearful.",ko:"다른 사람들이 탐욕스러울 때 두려워하고, 두려워할 때 탐욕스러워져라.",src:"워런 버핏 — 2004 버크셔 주주서한"},
            {id:2,cat:"시장심리",en:"The stock market is a device for transferring money from the impatient to the patient.",ko:"주식시장은 참을성 없는 사람에게서 참을성 있는 사람에게로 돈을 이전하는 장치다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:3,cat:"시장심리",en:"Only when the tide goes out do you discover who's been swimming naked.",ko:"썰물이 빠져야 비로소 누가 알몸으로 수영했는지 알 수 있다.",src:"워런 버핏 — 2001 버크셔 주주서한"},
            {id:4,cat:"시장심리",en:"Widespread fear is your friend as an investor because it serves up bargain purchases.",ko:"광범위한 두려움은 투자자의 친구다. 헐값에 살 기회를 주기 때문이다.",src:"워런 버핏 — 2008 버크셔 주주서한"},
            {id:5,cat:"시장심리",en:"Price is what you pay. Value is what you get.",ko:"가격은 당신이 지불하는 것이고, 가치는 당신이 얻는 것이다.",src:"워런 버핏 — 2008 버크셔 주주서한"},
            {id:6,cat:"시장심리",en:"In the short run, the market is a voting machine but in the long run it is a weighing machine.",ko:"단기적으로 시장은 투표 기계지만, 장기적으로는 저울이다.",src:"워런 버핏 — 그레이엄 인용"},
            {id:7,cat:"시장심리",en:"Mr. Market is there to serve you, not to guide you.",ko:"Mr. Market은 당신을 안내하기 위해서가 아니라 섬기기 위해 존재한다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:8,cat:"시장심리",en:"When it rains gold, put out the bucket, not the thimble.",ko:"금이 쏟아질 때는 골무가 아닌 양동이를 내밀어라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:9,cat:"시장심리",en:"Bad news is an investor's best friend. It lets you buy a slice of America's future at a marked-down price.",ko:"나쁜 소식은 투자자의 가장 좋은 친구다. 미래를 할인된 가격에 살 수 있게 해주기 때문이다.",src:"워런 버핏 — 2008 뉴욕타임스 기고"},
            {id:10,cat:"시장심리",en:"The investor of today does not profit from yesterday's growth.",ko:"오늘의 투자자는 어제의 성장으로 수익을 올리지 않는다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:11,cat:"시장심리",en:"What the wise man does in the beginning, the fool does in the end.",ko:"현명한 사람이 처음에 하는 것을, 어리석은 사람은 마지막에 한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:12,cat:"시장심리",en:"For some reason, people take their cues from price action rather than from values.",ko:"어떤 이유에서인지 사람들은 가치가 아닌 가격 움직임에서 단서를 얻는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:13,cat:"시장심리",en:"The most common cause of low prices is pessimism. We want to do business in such an environment not because we like pessimism but because we like the prices it produces.",ko:"낮은 가격의 가장 흔한 원인은 비관론이다. 비관론이 좋아서가 아니라 그것이 만들어내는 가격이 좋아서다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:14,cat:"시장심리",en:"Opportunities come infrequently. When it rains gold, put out the bucket, not the thimble.",ko:"기회는 드물게 온다. 금비가 내릴 때는 골무 대신 양동이를 내밀어라.",src:"워런 버핏 — 버크셔 주주총회"},
            // ── 기업분석
            {id:15,cat:"기업분석",en:"I try to invest in businesses that are so wonderful that an idiot can run them. Because sooner or later, one will.",ko:"나는 바보라도 운영할 수 있을 만큼 훌륭한 사업에 투자하려 한다. 조만간 반드시 그런 일이 생기기 때문이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:16,cat:"기업분석",en:"The single most important decision in evaluating a business is pricing power.",ko:"기업을 평가할 때 가장 중요한 한 가지는 가격 결정력이다.",src:"워런 버핏 — CNBC 인터뷰"},
            {id:17,cat:"기업분석",en:"Our favorite holding period is forever.",ko:"우리가 선호하는 보유 기간은 영원이다.",src:"워런 버핏 — 1988 버크셔 주주서한"},
            {id:18,cat:"기업분석",en:"It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price.",ko:"공정한 가격의 훌륭한 회사를 사는 것이 훌륭한 가격의 공정한 회사를 사는 것보다 훨씬 낫다.",src:"워런 버핏 — 1989 버크셔 주주서한"},
            {id:19,cat:"기업분석",en:"I never invest in anything that I don't understand.",ko:"이해하지 못하는 것에는 절대 투자하지 않는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:20,cat:"기업분석",en:"I am a better investor because I am a businessman, and a better businessman because I am an investor.",ko:"나는 사업가이기 때문에 더 좋은 투자자이고, 투자자이기 때문에 더 좋은 사업가다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:21,cat:"기업분석",en:"When a management with a reputation for brilliance tackles a business with a reputation for bad economics, it is the reputation of the business that remains intact.",ko:"뛰어난 경영진이 나쁜 경제성으로 유명한 사업을 맡으면, 온전히 유지되는 것은 사업의 명성이다.",src:"워런 버핏 — 1989 버크셔 주주서한"},
            {id:22,cat:"기업분석",en:"A good business is like a strong fortress. The wider the moat, the better the castle.",ko:"좋은 사업은 견고한 요새와 같다. 해자가 넓을수록 더 좋은 성이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:23,cat:"기업분석",en:"The key to investing is not assessing how much an industry is going to affect society, but determining the competitive advantage of any given company.",ko:"투자의 핵심은 산업이 사회에 미치는 영향이 아니라 특정 기업의 경쟁 우위를 파악하는 것이다.",src:"워런 버핏 — Fortune 인터뷰 1999"},
            {id:24,cat:"기업분석",en:"A horse that can count to ten is a remarkable horse, not a remarkable mathematician.",ko:"열까지 셀 수 있는 말은 놀라운 말이지, 놀라운 수학자가 아니다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:25,cat:"기업분석",en:"When we own portions of outstanding businesses with outstanding managements, our favorite holding period is forever.",ko:"뛰어난 경영진의 훌륭한 사업 일부를 소유할 때, 우리의 보유 기간은 영원이다.",src:"워런 버핏 — 1988 버크셔 주주서한"},
            {id:26,cat:"기업분석",en:"The ideal business is one that earns very high returns on capital and can keep investing that capital back at equally high returns.",ko:"이상적인 사업은 자본에 대한 수익률이 높고 같은 수익률로 재투자할 수 있는 사업이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:27,cat:"기업분석",en:"Your premium brand had better be delivering something special, or it's not going to get the business.",ko:"프리미엄 브랜드는 반드시 특별한 무언가를 제공해야 한다. 그렇지 않으면 사업을 유지할 수 없다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:28,cat:"기업분석",en:"Accounting is the language of business.",ko:"회계는 비즈니스의 언어다.",src:"워런 버핏 — 버크셔 주주총회"},
            // ── 장기투자
            {id:29,cat:"장기투자",en:"If you aren't willing to own a stock for ten years, don't even think about owning it for ten minutes.",ko:"10년간 보유할 의사가 없다면 10분도 생각하지 마라.",src:"워런 버핏 — 1996 버크셔 주주서한"},
            {id:30,cat:"장기투자",en:"Time is the friend of the wonderful company, the enemy of the mediocre.",ko:"시간은 훌륭한 기업의 친구이고, 평범한 기업의 적이다.",src:"워런 버핏 — 1989 버크셔 주주서한"},
            {id:31,cat:"장기투자",en:"Someone's sitting in the shade today because someone planted a tree a long time ago.",ko:"오늘 누군가가 그늘 아래 앉아 있는 것은 오래전 누군가가 나무를 심었기 때문이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:32,cat:"장기투자",en:"Inactivity strikes us as intelligent behavior.",ko:"비활동성이야말로 우리에게는 지적인 행동으로 보인다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:33,cat:"장기투자",en:"Buy a stock the way you would buy a house. Understand and like it such that you'd be content to own it in the absence of any market.",ko:"집을 살 때처럼 주식을 사라. 시장이 없어도 편안하게 보유할 수 있을 만큼 이해하고 좋아하라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:34,cat:"장기투자",en:"Lethargy bordering on sloth remains the cornerstone of our investment style.",ko:"나태함에 가까운 게으름이 우리 투자 스타일의 초석으로 남아있다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:35,cat:"장기투자",en:"The stock market is a no-called-strike game. You don't have to swing at everything.",ko:"주식시장은 스트라이크를 선언하지 않는 야구다. 모든 공에 방망이를 휘두를 필요가 없다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:36,cat:"장기투자",en:"We don't have to be smarter than the rest. We have to be more disciplined than the rest.",ko:"우리는 다른 사람들보다 더 똑똑할 필요는 없다. 단지 더 규율 있으면 된다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:37,cat:"장기투자",en:"The business schools reward difficult complex behavior more than simple behavior, but simple behavior is more effective.",ko:"경영대학원은 복잡한 행동에 더 많은 보상을 한다. 하지만 단순한 행동이 더 효과적이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:38,cat:"장기투자",en:"Do not save what is left after spending, but spend what is left after saving.",ko:"지출하고 남은 것을 저축하지 말고, 저축하고 남은 것을 지출하라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:39,cat:"장기투자",en:"I don't look to jump over seven-foot bars. I look around for one-foot bars that I can step over.",ko:"7피트 장대를 뛰어넘으려 하지 않는다. 내가 넘을 수 있는 1피트 장대를 찾는다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:40,cat:"장기투자",en:"We simply attempt to be fearful when others are greedy and to be greedy only when others are fearful.",ko:"우리는 단순히 남들이 탐욕스러울 때 두려워하고, 남들이 두려워할 때만 탐욕스러워지려 할 뿐이다.",src:"워런 버핏 — 1986 버크셔 주주서한"},
            {id:41,cat:"장기투자",en:"The stock market is designed to transfer money from the Active to the Patient.",ko:"주식시장은 활동적인 사람에게서 참을성 있는 사람에게로 돈을 이전하도록 설계되어 있다.",src:"워런 버핏 — 버크셔 주주총회"},
            // ── 리스크
            {id:42,cat:"리스크",en:"Rule No.1: Never lose money. Rule No.2: Never forget rule No.1.",ko:"규칙 1번: 절대 돈을 잃지 마라. 규칙 2번: 절대 규칙 1번을 잊지 마라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:43,cat:"리스크",en:"Risk comes from not knowing what you're doing.",ko:"리스크는 자신이 무엇을 하고 있는지 모르는 데서 온다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:44,cat:"리스크",en:"Diversification is protection against ignorance. It makes little sense if you know what you are doing.",ko:"분산투자는 무지에 대한 보호막이다. 자신이 무엇을 하는지 안다면 별 의미가 없다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:45,cat:"리스크",en:"It takes 20 years to build a reputation and five minutes to ruin it.",ko:"명성을 쌓는 데는 20년이 걸리지만 망치는 데는 5분이면 된다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:46,cat:"리스크",en:"You don't need to be a rocket scientist. Investing is not a game where the guy with the 160 IQ beats the guy with 130 IQ.",ko:"로켓 과학자일 필요는 없다. 투자는 IQ 160이 IQ 130을 이기는 게임이 아니다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:47,cat:"리스크",en:"We have long felt that the only value of stock forecasters is to make fortune tellers look good.",ko:"주식 예측가의 유일한 가치는 점쟁이를 그럴듯해 보이게 만드는 것이라고 오래전부터 느꼈다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:48,cat:"리스크",en:"What we learn from history is that people don't learn from history.",ko:"역사에서 우리가 배우는 것은, 사람들이 역사에서 배우지 않는다는 것이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:49,cat:"리스크",en:"Never invest in a business you can't understand.",ko:"이해할 수 없는 사업에는 절대 투자하지 마라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:50,cat:"리스크",en:"Beware of geeks bearing formulas.",ko:"공식을 들고 오는 괴짜들을 조심하라.",src:"워런 버핏 — 2009 버크셔 주주서한"},
            {id:51,cat:"리스크",en:"Should you find yourself in a chronically leaking boat, energy devoted to changing vessels is likely to be more productive than energy devoted to patching leaks.",ko:"만성적으로 새는 배에 타고 있다면 구멍을 막는 것보다 배를 바꾸는 데 에너지를 쏟는 게 낫다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:52,cat:"리스크",en:"The most important quality for an investor is temperament, not intellect.",ko:"투자자에게 가장 중요한 자질은 지능이 아니라 기질이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:53,cat:"리스크",en:"You never know who's swimming naked until the tide goes out.",ko:"썰물이 빠져나가야 누가 알몸으로 수영하고 있었는지 알 수 있다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:54,cat:"리스크",en:"After 25 years of buying and supervising a great variety of businesses, Charlie and I have not learned how to solve difficult business problems. What we have learned is to avoid them.",ko:"사업을 25년간 사고 감독한 후, 찰리와 나는 어려운 문제를 해결하는 법이 아니라 피하는 법을 배웠다.",src:"워런 버핏 — 버크셔 주주서한"},
            // ── 경영진
            {id:55,cat:"경영진",en:"Somebody once said that in looking for people to hire, you look for three qualities: integrity, intelligence, and energy. And if you don't have the first, the other two will kill you.",ko:"인재를 고를 때 세 가지를 본다: 정직성, 지능, 에너지. 첫 번째가 없으면 나머지 둘이 오히려 당신을 죽일 것이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:56,cat:"경영진",en:"Of the billionaires I have known, money just brings out the basic traits in them. If they were jerks before they had money, they are simply jerks with a billion dollars.",ko:"돈은 기본 특성을 드러낼 뿐이다. 돈이 없을 때도 나쁜 사람이었다면, 10억 달러를 가진 나쁜 사람일 뿐이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:57,cat:"경영진",en:"I want employees to ask themselves whether they would be comfortable if their CEO could see exactly what they are doing and why.",ko:"직원들이 CEO가 자신의 행동과 이유를 정확히 볼 수 있다면 편안하겠는지 스스로에게 물어보길 바란다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:58,cat:"경영진",en:"You can't make a good deal with a bad person.",ko:"나쁜 사람과는 좋은 거래를 할 수 없다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:59,cat:"경영진",en:"The best thing I did was to choose the right heroes.",ko:"내가 한 일 중 가장 잘한 것은 올바른 영웅을 선택한 것이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:60,cat:"경영진",en:"Tell me who your heroes are and I'll tell you who you'll turn out to be.",ko:"당신의 영웅이 누구인지 말해주면, 당신이 어떤 사람이 될지 말해주겠다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:61,cat:"경영진",en:"It's better to hang out with people better than you. Pick out associates whose behavior is better than yours and you'll drift in that direction.",ko:"당신보다 나은 사람들과 어울리는 것이 낫다. 더 나은 동료를 선택하면 그 방향으로 나아가게 된다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:62,cat:"경영진",en:"We look for three things when we hire people: intelligence, initiative or energy, and integrity.",ko:"채용할 때 세 가지를 본다: 지능, 주도성 또는 에너지, 그리고 정직성.",src:"워런 버핏 — 버크셔 주주총회"},
            // ── 가치평가
            {id:63,cat:"가치평가",en:"Intrinsic value is an all-important concept that offers the only logical approach to evaluating the relative attractiveness of investments and businesses.",ko:"내재가치는 투자와 사업의 매력도를 평가하는 유일한 논리적 접근법을 제공하는 가장 중요한 개념이다.",src:"워런 버핏 — 버크셔 주주서한 오너 매뉴얼"},
            {id:64,cat:"가치평가",en:"Whether we're talking about socks or stocks, I like buying quality merchandise when it is marked down.",ko:"양말이든 주식이든, 나는 품질 좋은 상품이 할인됐을 때 사는 것을 좋아한다.",src:"워런 버핏 — 2008 뉴욕타임스 기고"},
            {id:65,cat:"가치평가",en:"The best business to own is one that over an extended period can employ large amounts of incremental capital at very high rates of return.",ko:"가장 좋은 사업은 오랜 기간 매우 높은 수익률로 대규모 추가 자본을 투입할 수 있는 사업이다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:66,cat:"가치평가",en:"Growth and value investing are joined at the hip.",ko:"성장투자와 가치투자는 사실 같이 붙어있다.",src:"워런 버핏 — 1992 버크셔 주주서한"},
            {id:67,cat:"가치평가",en:"I would rather be approximately right than precisely wrong.",ko:"나는 정확히 틀리는 것보다 대략 맞는 것을 선호한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:68,cat:"가치평가",en:"A too-high purchase price for the stock of an excellent company can undo the effects of a subsequent decade of favorable business developments.",ko:"훌륭한 회사 주식을 너무 비싸게 사면 그 후 10년의 좋은 사업 발전도 소용이 없어진다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:69,cat:"가치평가",en:"We don't get paid for activity, just for being right.",ko:"우리는 활동량이 아니라 옳고 그름에 대한 보상을 받는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:70,cat:"가치평가",en:"Never count on making a good sale. Have the purchase price be so attractive that even a mediocre sale gives good results.",ko:"좋은 매도를 기대하지 마라. 매수 가격이 워낙 매력적이어서 평범한 매도도 좋은 결과를 낼 수 있도록 하라.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:71,cat:"가치평가",en:"ROE is the most critical metric. A company consistently generating 15%+ ROE without excessive leverage has a durable moat.",ko:"ROE는 가장 중요한 지표다. 과도한 레버리지 없이 지속적으로 15% 이상 ROE를 달성하는 회사는 해자를 가진 것이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:72,cat:"가치평가",en:"All there is to investing is picking good stocks at good times and staying with them as long as they remain good companies.",ko:"투자의 전부는 좋은 시기에 좋은 주식을 고르고, 좋은 회사로 남아있는 한 보유하는 것이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:73,cat:"가치평가",en:"A great business at a fair price is superior to a fair business at a great price.",ko:"공정한 가격의 훌륭한 사업이 훌륭한 가격의 공정한 사업보다 낫다.",src:"워런 버핏 — 버크셔 주주총회"},
            // ── 인생
            {id:74,cat:"인생",en:"The most important investment you can make is in yourself.",ko:"당신이 할 수 있는 가장 중요한 투자는 자기 자신에 대한 투자다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:75,cat:"인생",en:"If you get to my age in life and nobody thinks well of you, I don't care how big your bank account is, your life is a disaster.",ko:"내 나이가 됐을 때 아무도 당신을 좋게 생각하지 않는다면, 은행 잔고가 얼마든 당신의 인생은 실패다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:76,cat:"인생",en:"I always knew I was going to be rich. I don't think I ever doubted it for a minute.",ko:"나는 항상 부자가 될 것이라고 알았다. 단 한 순간도 의심한 적이 없다.",src:"워런 버핏 — Becoming Warren Buffett"},
            {id:77,cat:"인생",en:"Chains of habit are too light to be felt until they are too heavy to be broken.",ko:"습관의 사슬은 느끼기엔 너무 가볍고, 끊기엔 너무 무거워질 때까지 느껴지지 않는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:78,cat:"인생",en:"It's only when the tide goes out that you learn who has been swimming naked.",ko:"썰물이 빠지고 나서야 누가 알몸으로 수영했는지 알게 된다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:79,cat:"인생",en:"The difference between successful people and really successful people is that really successful people say no to almost everything.",ko:"성공한 사람과 정말 성공한 사람의 차이는, 정말 성공한 사람은 거의 모든 것에 '아니오'라고 말한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:80,cat:"인생",en:"Honesty is a very expensive gift. Don't expect it from cheap people.",ko:"정직은 매우 값비싼 선물이다. 싸구려 사람에게 기대하지 마라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:81,cat:"인생",en:"I just sit in my office and read all day.",ko:"나는 그냥 사무실에 앉아 하루 종일 읽는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:82,cat:"인생",en:"I measure success by how many people love me.",ko:"나는 얼마나 많은 사람들이 나를 사랑하는지로 성공을 측정한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:83,cat:"인생",en:"You only have to do a very few things right in your life so long as you don't do too many things wrong.",ko:"너무 많은 것을 잘못하지 않는 한, 인생에서 소수의 것만 잘해도 충분하다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:84,cat:"인생",en:"Someone is sitting in the shade today because someone planted a tree a long time ago.",ko:"오늘 누군가가 그늘에 앉아 있는 것은 오래전 누군가가 나무를 심었기 때문이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:85,cat:"인생",en:"Spend each day trying to be a little wiser than you were when you woke up.",ko:"매일 아침보다 조금 더 현명해지려는 노력을 하며 하루를 보내라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:86,cat:"인생",en:"The best thing I can do is read.",ko:"내가 할 수 있는 최선은 읽는 것이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:87,cat:"인생",en:"I don't try to jump over seven-foot hurdles. I look for one-foot hurdles to step over.",ko:"7피트 허들을 넘으려 하지 않는다. 1피트 허들을 찾아 넘는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:88,cat:"인생",en:"We can afford to lose money — even a lot of money. But we can't afford to lose reputation — even a shred of reputation.",ko:"돈은 잃어도, 심지어 많이 잃어도 괜찮다. 하지만 평판은 조금도 잃을 수 없다.",src:"워런 버핏 — 버크셔 주주서한"},
            // ── 추가 혼합
            {id:89,cat:"시장심리",en:"The stock market is the only market where things go on sale and all the customers run out of the store.",ko:"주식시장은 세일이 시작되면 고객들이 도망치는 유일한 시장이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:90,cat:"기업분석",en:"I look for businesses in which I think I can predict what they're going to look like in ten to fifteen years.",ko:"나는 10~15년 후의 모습을 예측할 수 있다고 생각하는 사업을 찾는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:91,cat:"장기투자",en:"An investor needs to do very few things right as long as he or she avoids big mistakes.",ko:"투자자는 큰 실수를 피하는 한 소수의 것만 잘해도 된다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:92,cat:"리스크",en:"It's not whether you're right or wrong that's important, but how much money you make when you're right and how much you lose when you're wrong.",ko:"중요한 것은 맞고 틀리느냐가 아니라, 맞을 때 얼마나 버느냐와 틀릴 때 얼마나 잃느냐다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:93,cat:"경영진",en:"Lose money for the firm and I will be understanding. Lose a shred of reputation for the firm, and I will be ruthless.",ko:"회사의 돈을 잃으면 이해하겠다. 하지만 회사의 평판을 조금이라도 잃으면 가차 없이 대응할 것이다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:94,cat:"가치평가",en:"Price is what you pay; value is what you get.",ko:"가격은 지불하는 것이고, 가치는 얻는 것이다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:95,cat:"인생",en:"The best investment you can make is an investment in yourself. The more you learn, the more you'll earn.",ko:"최고의 투자는 자기 자신에 대한 투자다. 더 많이 배울수록 더 많이 벌 수 있다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:96,cat:"시장심리",en:"Look at market fluctuations as your friend rather than your enemy; profit from folly rather than participate in it.",ko:"시장의 변동성을 적이 아닌 친구로 보라. 어리석음에 참여하지 말고 거기서 이익을 얻어라.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:97,cat:"장기투자",en:"The stock market is a giant distraction to the business of investing.",ko:"주식시장은 투자라는 사업에 있어 거대한 방해물이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:98,cat:"리스크",en:"You don't have to make money back the same way you lost it.",ko:"잃은 방식과 같은 방식으로 되찾을 필요는 없다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:99,cat:"가치평가",en:"I always invest in simple businesses. If there's lots of technology, I don't understand it.",ko:"나는 항상 단순한 사업에 투자한다. 기술이 복잡하면 이해할 수 없기 때문이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:100,cat:"인생",en:"It's better to hang out with people better than you.",ko:"당신보다 나은 사람들과 어울리는 것이 낫다.",src:"워런 버핏 — 버크셔 주주총회"},
            // ── 벤저민 그레이엄 ─────────────────────────────────────
            {id:151,cat:"가치평가",who:"그레이엄",en:"The intelligent investor is a realist who sells to optimists and buys from pessimists.",ko:"현명한 투자자는 낙관론자에게 팔고 비관론자에게서 사는 현실주의자다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:152,cat:"리스크",who:"그레이엄",en:"The margin of safety is always dependent on the price paid.",ko:"안전마진은 항상 지불한 가격에 달려 있다.",src:"벤저민 그레이엄 — 증권분석"},
            {id:153,cat:"시장심리",who:"그레이엄",en:"Mr. Market is your servant, not your guide.",ko:"미스터 마켓은 당신의 안내자가 아니라 하인이다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:154,cat:"장기투자",who:"그레이엄",en:"The stock investor is neither right nor wrong because others agreed or disagreed with him; he is right because his facts and analysis are right.",ko:"투자자가 옳고 그름은 다른 사람의 동의 여부가 아니라 그의 사실과 분석이 옳기 때문이다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:155,cat:"시장심리",who:"그레이엄",en:"The investor who permits himself to be stampeded by unjustified market declines is perversely transforming his basic advantage into a basic disadvantage.",ko:"부당한 시장 하락에 겁먹는 투자자는 자신의 기본 이점을 기본 불이점으로 바꾸는 것이다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:156,cat:"가치평가",who:"그레이엄",en:"Investment is most intelligent when it is most businesslike.",ko:"투자는 가장 사업적일 때 가장 현명하다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:157,cat:"리스크",who:"그레이엄",en:"The individual investor should act consistently as an investor and not as a speculator.",ko:"개인 투자자는 투기자가 아닌 투자자로서 일관되게 행동해야 한다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:158,cat:"시장심리",who:"그레이엄",en:"Obvious prospects for physical growth in a business do not translate into obvious profits for investors.",ko:"기업의 물리적 성장에 대한 명백한 전망이 투자자에게 명백한 이익으로 이어지지는 않는다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:159,cat:"인생",who:"그레이엄",en:"The chief losses to investors come from the purchase of low-quality securities at times of favorable business conditions.",ko:"투자자의 주된 손실은 호황기에 저품질 증권을 매수하는 데서 온다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            // ── 피터 린치 ─────────────────────────────────────────────
            {id:160,cat:"기업분석",who:"피터 린치",en:"Invest in what you know.",ko:"당신이 아는 것에 투자하라.",src:"피터 린치 — 전설로 떠나는 월가의 영웅"},
            {id:161,cat:"장기투자",who:"피터 린치",en:"The person that turns over the most rocks wins the game.",ko:"가장 많은 돌을 뒤집는 사람이 이긴다.",src:"피터 린치 — 전설로 떠나는 월가의 영웅"},
            {id:162,cat:"시장심리",who:"피터 린치",en:"Far more money has been lost by investors trying to anticipate corrections than lost in the corrections themselves.",ko:"조정을 예측하려다 잃은 돈이 조정 자체에서 잃은 돈보다 훨씬 많다.",src:"피터 린치 — 전설로 떠나는 월가의 영웅"},
            {id:163,cat:"가치평가",who:"피터 린치",en:"The P/E ratio of any company that's fairly priced will equal its growth rate.",ko:"공정하게 평가된 기업의 PER은 성장률과 같다.",src:"피터 린치 — 전설로 떠나는 월가의 영웅"},
            {id:164,cat:"시장심리",who:"피터 린치",en:"When you sell in desperation, you always sell cheap.",ko:"절망적인 심정으로 팔 때는 항상 싸게 판다.",src:"피터 린치"},
            {id:165,cat:"장기투자",who:"피터 린치",en:"The key to making money in stocks is not to get scared out of them.",ko:"주식에서 돈을 버는 핵심은 겁먹어서 팔지 않는 것이다.",src:"피터 린치 — 전설로 떠나는 월가의 영웅"},
            {id:166,cat:"기업분석",who:"피터 린치",en:"Know what you own, and know why you own it.",ko:"무엇을 보유하는지 알고, 왜 보유하는지 알아라.",src:"피터 린치"},
            {id:167,cat:"리스크",who:"피터 린치",en:"Your ultimate success or failure will depend on your ability to ignore the worries of the world long enough to allow your investments to succeed.",ko:"최종 성공 또는 실패는 세상의 걱정을 충분히 무시하고 투자가 성공할 때까지 기다리는 능력에 달려 있다.",src:"피터 린치"},
            {id:168,cat:"인생",who:"피터 린치",en:"Everyone has the brain power to make money in stocks. Not everyone has the stomach.",ko:"누구나 주식으로 돈을 벌 지적 능력은 있다. 모두가 버텨낼 배짱을 가진 것은 아니다.",src:"피터 린치"},
            // ── 하워드 막스 ───────────────────────────────────────────
            {id:169,cat:"리스크",who:"하워드 막스",en:"The biggest investing errors come not from factors that are informational or analytical, but from those that are psychological.",ko:"가장 큰 투자 실수는 정보나 분석의 문제가 아니라 심리적 요인에서 비롯된다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:170,cat:"시장심리",who:"하워드 막스",en:"The most important thing is to be attentive to cycles and be positioned appropriately.",ko:"가장 중요한 것은 사이클에 주의를 기울이고 적절하게 포지셔닝하는 것이다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:171,cat:"리스크",who:"하워드 막스",en:"Risk means more things can happen than will happen.",ko:"리스크란 일어날 수 있는 일이 실제로 일어날 일보다 더 많다는 것을 의미한다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:172,cat:"시장심리",who:"하워드 막스",en:"Being too far ahead of your time is indistinguishable from being wrong.",ko:"시대를 너무 앞서는 것은 틀린 것과 구별할 수 없다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:173,cat:"장기투자",who:"하워드 막스",en:"You can't predict. You can prepare.",ko:"예측할 수 없다. 준비할 수는 있다.",src:"하워드 막스 — 마스터링 더 마켓 사이클"},
            {id:174,cat:"리스크",who:"하워드 막스",en:"The riskiest thing in the world is the belief that there is no risk.",ko:"세상에서 가장 위험한 것은 위험이 없다는 믿음이다.",src:"하워드 막스 — 오크트리 메모"},
            {id:175,cat:"시장심리",who:"하워드 막스",en:"When everyone believes something is risky, their unwillingness to buy reduces its price to the point where it's not risky at all.",ko:"모두가 무언가 위험하다고 믿을 때 가격이 내려가고 결국 전혀 위험하지 않게 된다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:176,cat:"가치평가",who:"하워드 막스",en:"The most important thing is not to make great investments, but to avoid terrible ones.",ko:"가장 중요한 것은 훌륭한 투자가 아니라 끔찍한 투자를 피하는 것이다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:177,cat:"장기투자",who:"하워드 막스",en:"Bull markets are born on pessimism, grown on skepticism, mature on optimism, and die on euphoria.",ko:"강세장은 비관론에서 태어나고, 회의론에서 성장하며, 낙관론에서 성숙하고, 도취감에서 죽는다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:178,cat:"인생",who:"하워드 막스",en:"Move forward, but with caution.",ko:"전진하되, 신중하게.",src:"하워드 막스 — 마스터링 더 마켓 사이클"},
            // ── 필립 피셔 ─────────────────────────────────────────────
            {id:179,cat:"장기투자",who:"필립 피셔",en:"The stock market is filled with individuals who know the price of everything, but the value of nothing.",ko:"주식시장은 모든 것의 가격은 알지만 가치는 아무것도 모르는 사람들로 가득 차 있다.",src:"필립 피셔 — 위대한 기업에 투자하라"},
            {id:180,cat:"기업분석",who:"필립 피셔",en:"I don't want a lot of good investments; I want a few outstanding ones.",ko:"많은 좋은 투자가 아니라 소수의 탁월한 투자를 원한다.",src:"필립 피셔 — 위대한 기업에 투자하라"},
            {id:181,cat:"장기투자",who:"필립 피셔",en:"If the job has been correctly done when a common stock is purchased, the time to sell it is almost never.",ko:"주식을 매수할 때 일을 올바르게 했다면, 매도할 시점은 거의 결코 오지 않는다.",src:"필립 피셔 — 위대한 기업에 투자하라"},
            {id:182,cat:"기업분석",who:"필립 피셔",en:"Outstanding companies have unusually capable management, together with products that give them a strong competitive position.",ko:"탁월한 기업은 비범하게 유능한 경영진과 강력한 경쟁적 위치를 주는 제품을 가진다.",src:"필립 피셔 — 위대한 기업에 투자하라"},
            {id:183,cat:"인생",who:"필립 피셔",en:"It is the young companies with intelligent management that produce the most outstanding long-term investments.",ko:"가장 탁월한 장기 투자를 만들어내는 것은 지능적인 경영진을 가진 젊은 기업들이다.",src:"필립 피셔 — 위대한 기업에 투자하라"},
            // ── 세스 클라만 ───────────────────────────────────────────
            {id:184,cat:"리스크",who:"세스 클라만",en:"Value investing is at its core the marriage of a contrarian streak and a calculator.",ko:"가치투자의 핵심은 역발상 성향과 계산기의 결합이다.",src:"세스 클라만 — 안전마진"},
            {id:185,cat:"가치평가",who:"세스 클라만",en:"The most important word in investing is margin of safety.",ko:"투자에서 가장 중요한 단어는 안전마진이다.",src:"세스 클라만 — 안전마진"},
            {id:186,cat:"시장심리",who:"세스 클라만",en:"The stock market is the only place where things go on sale and everyone runs out of the store.",ko:"주식시장은 세일이 시작되면 모두가 매장 밖으로 뛰어나가는 유일한 곳이다.",src:"세스 클라만 — 안전마진"},
            {id:187,cat:"리스크",who:"세스 클라만",en:"Avoiding loss should be the primary goal of every investor.",ko:"손실을 피하는 것이 모든 투자자의 주요 목표가 되어야 한다.",src:"세스 클라만 — 안전마진"},
            {id:188,cat:"인생",who:"세스 클라만",en:"Humility and intellectual honesty are the most important traits for investors.",ko:"겸손함과 지적 정직함이 투자자에게 가장 중요한 덕목이다.",src:"세스 클라만"},
            // ── 존 템플턴 ─────────────────────────────────────────────
            {id:189,cat:"시장심리",who:"존 템플턴",en:"The time of maximum pessimism is the best time to buy, and the time of maximum optimism is the best time to sell.",ko:"최대 비관론의 시기가 최적의 매수 시점이고, 최대 낙관론의 시기가 최적의 매도 시점이다.",src:"존 템플턴"},
            {id:190,cat:"장기투자",who:"존 템플턴",en:"The four most dangerous words in investing are: this time it's different.",ko:"투자에서 가장 위험한 네 단어는 '이번엔 다르다'이다.",src:"존 템플턴"},
            {id:191,cat:"리스크",who:"존 템플턴",en:"If you want to have a better performance than the crowd, you must do things differently from the crowd.",ko:"군중보다 더 나은 성과를 원한다면 군중과 다르게 행동해야 한다.",src:"존 템플턴"},
            {id:192,cat:"시장심리",who:"존 템플턴",en:"Bull markets are born on pessimism, grown on skepticism, mature on optimism, and die on euphoria.",ko:"강세장은 비관론에서 태어나고, 회의론에서 성장하며, 낙관론에서 성숙하고, 도취감에서 죽는다.",src:"존 템플턴"},
            {id:193,cat:"가치평가",who:"존 템플턴",en:"Invest at the point of maximum pessimism.",ko:"최대 비관론의 지점에서 투자하라.",src:"존 템플턴"},
            {id:194,cat:"인생",who:"존 템플턴",en:"An investor who has all the answers doesn't even understand the questions.",ko:"모든 답을 가진 투자자는 질문조차 이해하지 못한 것이다.",src:"존 템플턴"},
            // ── 모니시 파브라이 ───────────────────────────────────────
            {id:195,cat:"리스크",who:"파브라이",en:"Heads I win, tails I don't lose much.",ko:"앞면이 나오면 내가 이기고, 뒷면이 나와도 많이 잃지 않는다.",src:"모니시 파브라이 — Dhandho Investor"},
            {id:196,cat:"가치평가",who:"파브라이",en:"Bet heavily when the odds are overwhelmingly in your favor.",ko:"확률이 압도적으로 유리할 때 크게 베팅하라.",src:"모니시 파브라이 — Dhandho Investor"},
            {id:197,cat:"기업분석",who:"파브라이",en:"Cloning great investors is a great way to make money. I am a shameless cloner.",ko:"위대한 투자자를 복제하는 것은 훌륭한 방법이다. 나는 부끄럼 없이 복제한다.",src:"모니시 파브라이"},
            {id:198,cat:"장기투자",who:"파브라이",en:"The Dhandho investor minimizes risk while maximizing returns.",ko:"단도 투자자는 수익을 극대화하면서 리스크를 최소화한다.",src:"모니시 파브라이 — Dhandho Investor"},
            {id:199,cat:"인생",who:"파브라이",en:"Keep life simple. Focus on what matters. Remove noise.",ko:"삶을 단순하게 유지하라. 중요한 것에 집중하라. 소음을 제거하라.",src:"모니시 파브라이"},
            // ── 리루 ──────────────────────────────────────────────────
            {id:200,cat:"장기투자",who:"리루",en:"Every era has value investors who produce good long-term results. Without exception, they are all value investors.",ko:"모든 시대에는 좋은 장기 결과를 낼 수 있는 가치 투자자들이 있다. 예외 없이 모두 가치 투자자다.",src:"리루 — 컬럼비아 대학 강연"},
            {id:201,cat:"기업분석",who:"리루",en:"I look for businesses that can reinvest at high rates of return for decades. That is where the real magic is.",ko:"수십 년간 높은 수익률로 재투자할 수 있는 사업을 찾는다. 진짜 마법은 거기에 있다.",src:"리루"},
            {id:202,cat:"가치평가",who:"리루",en:"Value investing is not just about discovering cheap stocks. It is about discovering value and adding value.",ko:"가치투자는 싼 주식을 찾는 것만이 아니다. 가치를 발견하고 가치를 더하는 것이다.",src:"리루"},
            {id:203,cat:"인생",who:"리루",en:"The greatest competitive advantage in life is being a learning machine.",ko:"인생에서 가장 큰 경쟁 우위는 학습하는 기계가 되는 것이다.",src:"리루"},
            // ── 테리 스미스 ───────────────────────────────────────────
            {id:204,cat:"기업분석",who:"테리 스미스",en:"Buy good companies. Don't overpay. Do nothing.",ko:"좋은 기업을 사라. 과도하게 지불하지 마라. 아무것도 하지 마라.",src:"테리 스미스 — Fundsmith 주주서한"},
            {id:205,cat:"장기투자",who:"테리 스미스",en:"Activity is the enemy of investment returns.",ko:"활동은 투자 수익의 적이다.",src:"테리 스미스 — Fundsmith 주주서한"},
            {id:206,cat:"가치평가",who:"테리 스미스",en:"We look for companies that can generate high returns on capital without requiring too much capital to do so.",ko:"너무 많은 자본 없이도 높은 자본 수익률을 창출할 수 있는 기업을 찾는다.",src:"테리 스미스 — Fundsmith"},
            {id:207,cat:"기업분석",who:"테리 스미스",en:"If the business model is broken, no amount of cheap valuation can save you.",ko:"비즈니스 모델이 망가졌다면 아무리 싼 밸류에이션도 당신을 구할 수 없다.",src:"테리 스미스"},
            {id:208,cat:"시장심리",who:"테리 스미스",en:"Most people know the price of everything and the value of nothing.",ko:"대부분의 사람은 모든 것의 가격은 알지만 가치는 아무것도 모른다.",src:"테리 스미스"},
            {id:209,cat:"인생",who:"테리 스미스",en:"Compounding is the eighth wonder of the world. Those who understand it earn it; those who do not pay it.",ko:"복리는 세계 8대 불가사의다. 이해하는 자는 그것을 얻고, 이해하지 못하는 자는 그것을 낸다.",src:"테리 스미스 — Fundsmith 주주서한"},
            // ── 찰리 멍거 ─────────────────────────────────────────────
            {id:101,cat:"시장심리",who:"찰리 멍거",en:"Invert, always invert.",ko:"역으로 생각하라. 항상 역으로.",src:"찰리 멍거, Poor Charlie's Almanack"},
            {id:102,cat:"리스크",who:"찰리 멍거",en:"All I want to know is where I'm going to die, so I'll never go there.",ko:"내가 알고 싶은 것은 내가 어디서 죽을지뿐이다. 그곳에는 절대 가지 않을 것이다.",src:"찰리 멍거, Poor Charlie's Almanack"},
            {id:103,cat:"기업분석",who:"찰리 멍거",en:"I have nothing to add.",ko:"추가할 것이 없습니다.",src:"찰리 멍거, 버크셔 주주총회"},
            {id:104,cat:"장기투자",who:"찰리 멍거",en:"The big money is not in the buying and the selling, but in the waiting.",ko:"큰돈은 사고파는 것이 아니라 기다리는 것에서 나온다.",src:"찰리 멍거"},
            {id:105,cat:"인생",who:"찰리 멍거",en:"It's not supposed to be easy. Anyone who finds it easy is stupid.",ko:"쉬울 리가 없다. 쉽다고 생각하는 사람은 어리석은 것이다.",src:"찰리 멍거, 버크셔 주주총회"},
            {id:106,cat:"기업분석",who:"찰리 멍거",en:"Show me the incentive and I'll show you the outcome.",ko:"인센티브를 보여주면 결과를 보여주겠다.",src:"찰리 멍거"},
            {id:107,cat:"인생",who:"찰리 멍거",en:"I never allow myself to have an opinion on anything that I don't know the other side's argument better than they do.",ko:"상대방보다 더 잘 알지 못하는 어떤 것에도 내 의견을 갖지 않는다.",src:"찰리 멍거"},
            {id:108,cat:"리스크",who:"찰리 멍거",en:"The best thing a human being can do is to help another human being know more.",ko:"인간이 할 수 있는 최선은 다른 사람이 더 많이 알도록 돕는 것이다.",src:"찰리 멍거"},
            {id:109,cat:"가치평가",who:"찰리 멍거",en:"A great business at a fair price is superior to a fair business at a great price.",ko:"공정한 가격의 훌륭한 사업이 훌륭한 가격의 공정한 사업보다 낫다.",src:"찰리 멍거"},
            {id:110,cat:"인생",who:"찰리 멍거",en:"Spend each day trying to be a little wiser than you were when you woke up.",ko:"매일 눈을 떴을 때보다 조금 더 현명해지려는 노력을 하며 하루를 보내라.",src:"찰리 멍거, Poor Charlie's Almanack"},
            {id:111,cat:"기업분석",who:"찰리 멍거",en:"I want to think about things where I have an advantage over other people. I don't want to play a game where people have an advantage over me.",ko:"나는 다른 사람보다 유리한 곳에서만 생각하고 싶다. 남들이 유리한 게임은 하고 싶지 않다.",src:"찰리 멍거"},
            {id:112,cat:"리스크",who:"찰리 멍거",en:"It's not enough to have a good mind; the main thing is to use it well.",ko:"좋은 두뇌를 갖는 것으로는 충분하지 않다. 핵심은 그것을 잘 사용하는 것이다.",src:"찰리 멍거"},
            {id:113,cat:"장기투자",who:"찰리 멍거",en:"Patience combined with opportunity is a great thing to have.",ko:"인내와 기회가 결합되면 위대한 것이 된다.",src:"찰리 멍거"},
            {id:114,cat:"인생",who:"찰리 멍거",en:"Three rules for a career: 1) Don't sell anything you wouldn't buy yourself. 2) Don't work for anyone you don't respect. 3) Work only with people you enjoy.",ko:"경력에 대한 세 가지 규칙: 1) 자신이 사지 않을 것은 팔지 마라. 2) 존경하지 않는 사람 밑에서 일하지 마라. 3) 좋아하는 사람하고만 일하라.",src:"찰리 멍거"},
            {id:115,cat:"기업분석",who:"찰리 멍거",en:"Knowing what you don't know is more useful than being brilliant.",ko:"모르는 것을 아는 것이 뛰어난 것보다 더 유용하다.",src:"찰리 멍거"},
            {id:116,cat:"가치평가",who:"찰리 멍거",en:"If you take the best text in economics by Mankiw, he says people respond to incentives. And if you really internalize that simple idea, you look for logical, predictable patterns in human behavior.",ko:"인간은 인센티브에 반응한다는 단순한 생각을 진정으로 내면화하면, 인간 행동에서 논리적이고 예측 가능한 패턴을 찾게 된다.",src:"찰리 멍거"},
            {id:117,cat:"시장심리",who:"찰리 멍거",en:"The market is not perfectly efficient and not completely inefficient — it's partially efficient and partially inefficient.",ko:"시장은 완전히 효율적이지도, 완전히 비효율적이지도 않다. 부분적으로 효율적이고 부분적으로 비효율적이다.",src:"찰리 멍거"},
            {id:118,cat:"경영진",who:"찰리 멍거",en:"Never wrestle with pigs. You both get dirty and the pig likes it.",ko:"돼지와 씨름하지 마라. 둘 다 더러워지는데 돼지는 그것을 즐긴다.",src:"찰리 멍거"},
            {id:119,cat:"인생",who:"찰리 멍거",en:"I observe what works and what doesn't and why.",ko:"나는 무엇이 효과가 있고 없는지, 그리고 왜 그런지를 관찰한다.",src:"찰리 멍거"},
            {id:120,cat:"리스크",who:"찰리 멍거",en:"If something is too hard, we move on to something else. What could be simpler than that?",ko:"어떤 것이 너무 어려우면 다른 것으로 넘어간다. 이보다 더 간단한 것이 어디 있겠는가?",src:"찰리 멍거"},
            {id:121,cat:"장기투자",who:"찰리 멍거",en:"We have three baskets for investing: yes, no, and too tough to understand.",ko:"우리의 투자 바구니는 세 개다: 예, 아니오, 그리고 이해하기 너무 어려운 것.",src:"찰리 멍거"},
            {id:122,cat:"기업분석",who:"찰리 멍거",en:"I have a friend who says the first rule of fishing is to fish where the fish are.",ko:"내 친구는 낚시의 첫 번째 규칙은 물고기가 있는 곳에서 낚시하는 것이라고 말한다.",src:"찰리 멍거"},
            {id:123,cat:"인생",who:"찰리 멍거",en:"In my whole life, I have known no wise people who didn't read all the time — none, zero.",ko:"내 삶 전체에서 항상 읽지 않는 현명한 사람을 단 한 명도 알지 못했다.",src:"찰리 멍거"},
            {id:124,cat:"가치평가",who:"찰리 멍거",en:"I would rather throw a rock at a moose than argue about the efficient market hypothesis.",ko:"나는 효율적 시장 가설을 논쟁하느니 차라리 무스에게 돌을 던지겠다.",src:"찰리 멍거"},
            {id:125,cat:"경영진",who:"찰리 멍거",en:"The best armor of old age is a well-spent life preceding it.",ko:"노년의 최고 갑옷은 앞서 잘 보낸 인생이다.",src:"찰리 멍거"},
            // ── 버핏 추가 어록 ─────────────────────────────────────────
            {id:126,cat:"시장심리",en:"I will tell you how to become rich. Close the doors. Be fearful when others are greedy. Be greedy when others are fearful.",ko:"부자가 되는 방법을 알려주겠다. 문을 닫고 들어와라. 남들이 탐욕스러울 때 두려워하고, 남들이 두려워할 때 탐욕스러워져라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:127,cat:"기업분석",en:"I don't look to jump over seven-foot bars; I look around for one-foot bars that I can step over.",ko:"7피트 장대를 뛰어넘으려 하지 않는다. 넘을 수 있는 1피트 장대를 찾는다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:128,cat:"장기투자",en:"We don't have to be smarter than the rest, we have to be more disciplined than the rest.",ko:"다른 사람들보다 더 똑똑할 필요는 없다. 단지 더 규율 있으면 된다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:129,cat:"리스크",en:"The most important thing to do if you find yourself in a hole is to stop digging.",ko:"구멍에 빠졌다면 가장 중요한 것은 파기를 멈추는 것이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:130,cat:"가치평가",en:"I put heavy weight on certainty. If you do that, the whole idea of a risk factor doesn't make much sense to me.",ko:"나는 확실성에 큰 비중을 둔다. 그렇게 한다면 리스크 요인이라는 개념은 별 의미가 없다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:131,cat:"경영진",en:"A public opinion poll is no substitute for thought.",ko:"여론 조사는 생각의 대체물이 아니다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:132,cat:"인생",en:"Without passion, you don't have energy. Without energy, you have nothing.",ko:"열정이 없으면 에너지가 없다. 에너지가 없으면 아무것도 없다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:133,cat:"시장심리",en:"I don't try to jump over seven-foot hurdles; I look for one-foot hurdles I can step over.",ko:"7피트 허들을 뛰어넘으려 하지 않는다. 1피트 허들을 찾는다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:134,cat:"기업분석",en:"An investor should act as though he had a lifetime decision card with just twenty punches on it.",ko:"투자자는 평생 단 20번의 결정만 내릴 수 있는 카드를 가진 것처럼 행동해야 한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:135,cat:"장기투자",en:"The most important quality for an investor is temperament, not intellect.",ko:"투자자에게 가장 중요한 자질은 지능이 아니라 기질이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:136,cat:"리스크",en:"You only find out who is swimming naked when the tide goes out.",ko:"썰물이 빠져야 누가 알몸으로 수영하고 있었는지 알 수 있다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:137,cat:"가치평가",en:"You pay a very high price in the stock market for a cheery consensus.",ko:"주식시장에서 낙관적 합의에 대해서는 매우 높은 가격을 치러야 한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:138,cat:"경영진",en:"I try to buy stock in businesses that are so wonderful that an idiot can run them because sooner or later, one will.",ko:"바보도 운영할 수 있는 훌륭한 사업을 찾아 투자한다. 조만간 그런 일이 생기기 때문이다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:139,cat:"인생",en:"Predicting rain doesn't count, building arks does.",ko:"비를 예측하는 것은 의미 없다. 방주를 만드는 것이 중요하다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:140,cat:"시장심리",en:"In the business world, the rearview mirror is always clearer than the windshield.",ko:"비즈니스 세계에서 백미러는 항상 앞 유리보다 더 선명하다.",src:"워런 버핏 — 버크셔 주주총회"},
            // ── 찰리 멍거 추가 ─────────────────────────────────────────
            {id:141,cat:"기업분석",who:"찰리 멍거",en:"Understanding both the power of compound interest and the difficulty of getting it is the heart and soul of understanding a lot of things.",ko:"복리의 힘과 그것을 얻는 어려움 모두를 이해하는 것이 많은 것을 이해하는 핵심이다.",src:"찰리 멍거"},
            {id:142,cat:"장기투자",who:"찰리 멍거",en:"The best thing a human being can do is to help another human being know more.",ko:"인간이 할 수 있는 최선은 다른 사람이 더 많이 알도록 돕는 것이다.",src:"찰리 멍거"},
            {id:143,cat:"리스크",who:"찰리 멍거",en:"Mimicking the herd invites regression to the mean.",ko:"군중을 모방하면 평균으로의 회귀를 부른다.",src:"찰리 멍거"},
            {id:144,cat:"가치평가",who:"찰리 멍거",en:"It takes character to sit there with all that cash and do nothing. I didn't get to where I am by going after mediocre opportunities.",ko:"현금을 들고 아무것도 하지 않는 데는 인내가 필요하다. 나는 평범한 기회를 쫓아서 지금의 자리에 오지 않았다.",src:"찰리 멍거"},
            {id:145,cat:"경영진",who:"찰리 멍거",en:"I have nothing to add — but remember, it takes a village to raise an idiot too.",ko:"추가할 것이 없습니다. 하지만 바보를 키우는 데도 온 마을이 필요하다는 것을 기억하세요.",src:"찰리 멍거, 버크셔 주주총회"},
            {id:146,cat:"인생",who:"찰리 멍거",en:"The best results I've ever gotten in life came from ignoring conventional wisdom.",ko:"내 인생에서 최고의 결과는 항상 통념을 무시했을 때 나왔다.",src:"찰리 멍거"},
            {id:147,cat:"시장심리",who:"찰리 멍거",en:"Most people are too fretful, they worry too much. Success means being very patient, but aggressive when it's time.",ko:"대부분의 사람들은 너무 초조하고, 너무 걱정한다. 성공은 매우 인내하다가 때가 됐을 때 공격적이 되는 것이다.",src:"찰리 멍거"},
            {id:148,cat:"기업분석",who:"찰리 멍거",en:"The difference between a good business and a bad one: A good business earns high returns on capital and can reinvest those returns at equally high rates.",ko:"좋은 사업과 나쁜 사업의 차이: 좋은 사업은 자본에서 높은 수익을 얻고 같은 높은 수익률로 재투자할 수 있다.",src:"찰리 멍거"},
            {id:149,cat:"장기투자",who:"찰리 멍거",en:"Rapid change of any kind is poison to a long-term investor.",ko:"어떤 종류의 급격한 변화도 장기 투자자에게는 독이다.",src:"찰리 멍거"},
            {id:150,cat:"리스크",who:"찰리 멍거",en:"Opportunity cost is a huge filter in life. If you've got two suitors who are each asking for your hand in marriage, and one is way better than the other, you do not have to spend much time with the other.",ko:"기회비용은 삶의 거대한 필터다. 두 구혼자가 있을 때 한 명이 훨씬 낫다면 다른 쪽에 시간을 많이 쓸 필요가 없다.",src:"찰리 멍거"},
            // ── 버핏 추가 ─────────────────────────────────────────
            {id:210,cat:"시장심리",en:"The stock market is designed to transfer money from the active to the patient.",ko:"주식시장은 활동적인 사람에게서 인내하는 사람에게로 돈을 이전하도록 설계되어 있다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:211,cat:"가치평가",en:"It is far better to buy a wonderful company at a fair price than a fair company at a wonderful price.",ko:"공정한 가격의 훌륭한 회사가 훌륭한 가격의 공정한 회사보다 훨씬 낫다.",src:"워런 버핏 — 1989 버크셔 주주서한"},
            {id:212,cat:"장기투자",en:"An investor needs to do very few things right as long as he or she avoids big mistakes.",ko:"큰 실수만 피한다면 투자자는 소수의 것만 잘해도 충분하다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:213,cat:"기업분석",en:"A great business throws off cash. A mediocre one consumes it.",ko:"훌륭한 사업은 현금을 창출하고, 평범한 사업은 그것을 소비한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:214,cat:"리스크",en:"The less prudence with which others conduct their affairs, the greater the prudence with which we should conduct our own affairs.",ko:"다른 사람들이 덜 신중할수록, 우리는 더 신중해야 한다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:215,cat:"시장심리",en:"The market is there to serve you, not to instruct you.",ko:"시장은 당신을 가르치는 것이 아니라 섬기기 위해 존재한다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:216,cat:"장기투자",en:"Only buy something that you'd be perfectly happy to hold if the market shut down for 10 years.",ko:"시장이 10년 동안 문을 닫아도 완전히 행복하게 보유할 수 있는 것만 사라.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:217,cat:"경영진",en:"Lose money for the firm and I will be understanding. Lose a shred of reputation for the firm and I will be ruthless.",ko:"회사의 돈을 잃으면 이해하겠다. 회사의 평판을 조금이라도 잃으면 가차 없이 대응할 것이다.",src:"워런 버핏 — 버크셔 주주서한"},
            {id:218,cat:"가치평가",en:"The best investment you can make is in yourself.",ko:"당신이 할 수 있는 최고의 투자는 자기 자신에 대한 투자다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:219,cat:"기업분석",en:"A business that needs a genius to run it is not a good business.",ko:"천재가 있어야 운영되는 사업은 좋은 사업이 아니다.",src:"워런 버핏 — 버크셔 주주총회"},
            {id:220,cat:"시장심리",en:"Forecasts may tell you a great deal about the forecaster; they tell you nothing about the future.",ko:"예측은 예측자에 대해 많은 것을 알려준다. 미래에 대해서는 아무것도 알려주지 않는다.",src:"워런 버핏 — 버크셔 주주서한"},
            // ── 찰리 멍거 추가 ────────────────────────────────────────
            {id:221,cat:"기업분석",who:"찰리 멍거",en:"You must know the big ideas in the big disciplines, and use them routinely.",ko:"큰 분야의 큰 아이디어를 알아야 하고, 그것을 일상적으로 사용해야 한다.",src:"찰리 멍거 — Poor Charlie's Almanack"},
            {id:222,cat:"리스크",who:"찰리 멍거",en:"Avoiding stupidity is easier than seeking brilliance.",ko:"멍청함을 피하는 것이 탁월함을 추구하는 것보다 쉽다.",src:"찰리 멍거"},
            {id:223,cat:"인생",who:"찰리 멍거",en:"The best thing a human being can do is to help another human being know more.",ko:"인간이 할 수 있는 최선은 다른 사람이 더 많이 알도록 돕는 것이다.",src:"찰리 멍거 — Poor Charlie's Almanack"},
            {id:224,cat:"장기투자",who:"찰리 멍거",en:"The desire to get rich fast is pretty dangerous.",ko:"빨리 부자가 되고 싶은 욕망은 꽤 위험하다.",src:"찰리 멍거 — 버크셔 주주총회"},
            {id:225,cat:"가치평가",who:"찰리 멍거",en:"All intelligent investing is value investing. Acquiring more than you are paying for.",ko:"모든 현명한 투자는 가치투자다. 지불하는 것보다 더 많은 것을 얻는 것이다.",src:"찰리 멍거"},
            // ── 그레이엄 추가 ─────────────────────────────────────────
            {id:226,cat:"리스크",who:"그레이엄",en:"Even the intelligent investor is likely to need considerable willpower to keep from following the crowd.",ko:"현명한 투자자조차 군중을 따르지 않으려면 상당한 의지력이 필요하다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:227,cat:"시장심리",who:"그레이엄",en:"The genuine investor in common stocks does not need a great equipment of brains and knowledge, but rather an unusual firmness of character.",ko:"주식의 진정한 투자자에게 필요한 것은 뛰어난 지능과 지식이 아니라 비범한 성격의 견고함이다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            {id:228,cat:"가치평가",who:"그레이엄",en:"Investing is most intelligent when it is most businesslike. This is the most important sentence in this book.",ko:"투자는 가장 사업적일 때 가장 현명하다. 이것이 이 책에서 가장 중요한 문장이다.",src:"벤저민 그레이엄 — 현명한 투자자"},
            // ── 피터 린치 추가 ────────────────────────────────────────
            {id:229,cat:"기업분석",who:"피터 린치",en:"Behind every stock is a company. Find out what it's doing.",ko:"모든 주식 뒤에는 기업이 있다. 그것이 무엇을 하는지 알아내라.",src:"피터 린치 — 전설로 떠나는 월가의 영웅"},
            {id:230,cat:"시장심리",who:"피터 린치",en:"Absent a lot of surprises, stocks are relatively predictable over 20 years. As to whether they'll be higher or lower in 2 to 3 years, you might as well flip a coin.",ko:"큰 이변이 없으면 주식은 20년에 걸쳐 상대적으로 예측 가능하다. 2~3년 후에 오를지 내릴지는 동전 던지기나 다름없다.",src:"피터 린치"},
            {id:231,cat:"장기투자",who:"피터 린치",en:"The real key to making money in stocks is not to get scared out of them.",ko:"주식에서 돈을 버는 진짜 핵심은 겁먹고 팔지 않는 것이다.",src:"피터 린치 — 전설로 떠나는 월가의 영웅"},
            // ── 하워드 막스 추가 ──────────────────────────────────────
            {id:232,cat:"리스크",who:"하워드 막스",en:"There's only one way to describe most investors: trend followers.",ko:"대부분의 투자자를 묘사하는 방법은 하나뿐이다: 추세 추종자.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:233,cat:"시장심리",who:"하워드 막스",en:"The biggest investing errors come not from factors that are informational or analytical, but from those that are psychological.",ko:"가장 큰 투자 오류는 정보나 분석이 아니라 심리에서 비롯된다.",src:"하워드 막스 — 투자에 대한 생각"},
            {id:234,cat:"가치평가",who:"하워드 막스",en:"The most dangerous thing is to buy something at the peak of its popularity.",ko:"가장 위험한 것은 인기의 절정에 있는 것을 사는 것이다.",src:"하워드 막스 — 오크트리 메모"},
            {id:235,cat:"장기투자",who:"하워드 막스",en:"Successful investing requires second-level thinking.",ko:"성공적인 투자는 2단계 사고를 요구한다.",src:"하워드 막스 — 투자에 대한 생각"},
            // ── 필립 피셔 추가 ────────────────────────────────────────
            {id:236,cat:"장기투자",who:"필립 피셔",en:"The time to sell a stock is almost never.",ko:"주식을 팔 시점은 거의 없다.",src:"필립 피셔 — 위대한 기업에 투자하라"},
            {id:237,cat:"기업분석",who:"필립 피셔",en:"I sought out people who could give me the most information on a company.",ko:"나는 기업에 대해 가장 많은 정보를 줄 수 있는 사람을 찾았다.",src:"필립 피셔 — 위대한 기업에 투자하라"},
            {id:238,cat:"리스크",who:"필립 피셔",en:"More money has been lost by investors holding a stock they really did not want until they could at least come out even.",ko:"적어도 본전이라도 뽑으려고 원치 않는 주식을 보유하다가 잃은 돈이 더 많다.",src:"필립 피셔"},
            // ── 세스 클라만 추가 ──────────────────────────────────────
            {id:239,cat:"가치평가",who:"세스 클라만",en:"When you find a real bargain, you must have the courage to buy.",ko:"진짜 헐값을 찾았을 때 살 용기가 있어야 한다.",src:"세스 클라만 — 안전마진"},
            {id:240,cat:"리스크",who:"세스 클라만",en:"The stock market is not always right. But it is always loud.",ko:"주식시장이 항상 옳은 것은 아니다. 하지만 항상 시끄럽다.",src:"세스 클라만"},
            {id:241,cat:"시장심리",who:"세스 클라만",en:"In an uncertain and sometimes frightening world, price becomes less important than not losing money.",ko:"불확실하고 때로 무서운 세상에서 가격보다 돈을 잃지 않는 것이 더 중요해진다.",src:"세스 클라만 — 안전마진"},
            // ── 존 템플턴 추가 ────────────────────────────────────────
            {id:242,cat:"장기투자",who:"존 템플턴",en:"The only investors who shouldn't diversify are those who are right 100% of the time.",ko:"분산투자를 하지 않아도 되는 유일한 투자자는 100% 맞는 사람이다.",src:"존 템플턴"},
            {id:243,cat:"기업분석",who:"존 템플턴",en:"The best time to invest is when you have money. History suggests it is not timing that matters, but time.",ko:"투자하기 가장 좋은 시점은 돈이 있을 때다. 역사는 타이밍이 아니라 시간이 중요하다고 말한다.",src:"존 템플턴"},
            // ── 파브라이 추가 ─────────────────────────────────────────
            {id:244,cat:"가치평가",who:"파브라이",en:"Focus on the downside. The upside will take care of itself.",ko:"하락 리스크에 집중하라. 상승은 스스로 알아서 된다.",src:"모니시 파브라이 — Dhandho Investor"},
            {id:245,cat:"장기투자",who:"파브라이",en:"Patience is the rarest commodity on Wall Street.",ko:"인내는 월스트리트에서 가장 희귀한 상품이다.",src:"모니시 파브라이"},
            // ── 리루 추가 ─────────────────────────────────────────────
            {id:246,cat:"기업분석",who:"리루",en:"The longer you hold a great business, the more you benefit from its compounding power.",ko:"훌륭한 사업을 오래 보유할수록 복리의 힘에서 더 많은 이익을 얻는다.",src:"리루"},
            {id:247,cat:"시장심리",who:"리루",en:"In a market downturn, your job is not to panic but to think clearly about value.",ko:"시장 침체에서 당신이 할 일은 공황이 아니라 가치에 대해 명확하게 생각하는 것이다.",src:"리루"},
            // ── 테리 스미스 추가 ──────────────────────────────────────
            {id:248,cat:"기업분석",who:"테리 스미스",en:"A high return on capital is the hallmark of a great business. Everything else is secondary.",ko:"높은 자본 수익률은 훌륭한 사업의 특징이다. 그 외 모든 것은 부차적이다.",src:"테리 스미스 — Fundsmith"},
            {id:249,cat:"시장심리",who:"테리 스미스",en:"The best returns come from owning great businesses and doing as little as possible.",ko:"최고의 수익은 훌륭한 사업을 보유하고 가능한 한 아무것도 하지 않는 데서 나온다.",src:"테리 스미스 — Fundsmith 주주서한"},
            {id:250,cat:"장기투자",who:"테리 스미스",en:"Time in the market beats timing the market.",ko:"시장 타이밍보다 시장 안에 있는 시간이 중요하다.",src:"테리 스미스 — Fundsmith"},
          ];

          // 날짜 기반 오늘의 어록 인덱스 (자정 기준 자동 변경)
          const todaySeed=(()=>{const d=new Date();return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();})();
          const todayQ=Q[todaySeed%Q.length];

          return <BuffettTabInner Q={Q} todayQ={todayQ} CATS={CATS} CAT_COLOR={CAT_COLOR} CAT_ICON={CAT_ICON}/>;
        })()}

        {/* ════ 시장 탭 ════ */}
        {tab==="market"&&(()=>{
          const kp60=(arr)=>{
            if(!arr.length)return[];
            const len=arr.length;
            const N=len>=60?60:len>=15?15:len>=3?len:0;
            if(N===0)return arr.map(d=>({...d,ma60:null,gap60:null}));
            return arr.map((d,i,a)=>{
              if(i<N-1)return{...d,ma60:null,gap60:null};
              const avg=a.slice(i-N+1,i+1).reduce((s,x)=>s+(x.price||0),0)/N;
              const ma60=+avg.toFixed(0);
              return{...d,ma60,gap60:+((d.price/ma60-1)*100).toFixed(2)};
            });
          };
          const kospiMA=kp60(kospiMonthly);
          const kosdaqMA=kp60(kosdaqMonthly);
          const kospiRSI=calcRSI(kospiMonthly);
          const kosdaqRSI=calcRSI(kosdaqMonthly);

          // ── 거시+코스피 병합
          const macroMerged=(()=>{
            if(!macroData||!kospiMonthly.length)return[];
            const expMap={},rateMap={},fxMap={},ppiMap={};
            (macroData.dailyExport||[]).forEach(r=>{expMap[r.date.slice(0,6)]=r.value;});
            (macroData.rate||[]).forEach(r=>{rateMap[r.date.slice(0,6)]=r.value;});
            (macroData.fx||[]).forEach(r=>{fxMap[r.date.slice(0,6)]=r.value;});
            (macroData.ppi||[]).forEach(r=>{ppiMap[r.date.slice(0,6)]=r.yoy;});
            return kospiMonthly.slice(-84).map(d=>{
              const ym=d.date?.slice(0,6)||"";
              return{...d,dailyExport:expMap[ym]??null,rate:rateMap[ym]??null,
                     fx:fxMap[ym]??null,ppiYoy:ppiMap[ym]??null};
            });
          })();

          // ── 신호등
          const lastRate=(macroData?.rate||[]).slice(-1)[0]?.value??null;
          const lastFX=(macroData?.fx||[]).slice(-1)[0]?.value??null;
          const lastExp=(macroData?.dailyExport||[]).slice(-1)[0]?.value??null;
          const prevExp=(macroData?.dailyExport||[]).slice(-2,-1)[0]?.value??null;
          const lastGDP=(macroData?.gdp||[]).slice(-1)[0]?.value??null;
          const lastPPI=[...(macroData?.ppi||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;
          const lastBSI=(macroData?.bsi||[]).slice(-1)[0]?.value??null;
          const lastCPI=[...(macroData?.cpi||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;
          const signals=[
            {label:"기준금리", val:lastRate!=null?`${lastRate}%`:"-",
             color:lastRate==null?"#888":lastRate<=2.5?C.green:lastRate<=3.5?C.gold:C.red,
             tip:lastRate==null?"":lastRate<=2.5?"완화적":lastRate<=3.5?"중립":"긴축적"},
            {label:"원/달러",  val:lastFX!=null?`${Math.round(lastFX).toLocaleString()}원`:"-",
             color:lastFX==null?"#888":lastFX<=1200?C.green:lastFX<=1350?C.gold:C.red,
             tip:lastFX==null?"":lastFX<=1200?"원화강세":lastFX<=1350?"중립":"원화약세"},
            {label:"일평균수출",val:lastExp!=null?`$${lastExp?.toFixed(0)}M`:"-",
             color:lastExp==null||prevExp==null?"#888":lastExp>=prevExp?C.green:C.red,
             tip:lastExp==null||prevExp==null?"":lastExp>=prevExp?"증가↑":"감소↓"},
            {label:"GDP성장률",val:lastGDP!=null?`${lastGDP}%`:"-",
             color:lastGDP==null?"#888":lastGDP>=3?C.green:lastGDP>=1?C.gold:C.red,
             tip:lastGDP==null?"":lastGDP>=3?"견조":lastGDP>=1?"완만":"부진"},
            {label:"PPI(YoY)",val:lastPPI!=null?`${lastPPI>0?"+":""}${lastPPI}%`:"-",
             color:lastPPI==null?"#888":lastPPI>4?C.red:lastPPI>2?C.gold:C.green,
             tip:lastPPI==null?"":lastPPI>4?"원가압력↑":lastPPI>2?"보통":"안정"},
            {label:"BSI제조업",val:lastBSI!=null?`${lastBSI}`:"-",
             color:lastBSI==null?"#888":lastBSI>=100?C.green:lastBSI>=90?C.gold:C.red,
             tip:lastBSI==null?"":lastBSI>=100?"확장":lastBSI>=90?"중립":"수축"},
            {label:"CPI(YoY)",val:lastCPI!=null?`${lastCPI>0?"+":""}${lastCPI}%`:"-",
             color:lastCPI==null?"#888":lastCPI>5?C.red:lastCPI>3?C.orange:lastCPI>1?C.gold:C.green,
             tip:lastCPI==null?"":lastCPI>5?"고인플레":lastCPI>3?"경계":lastCPI>1?"보통":"안정"},
            {label:"가계신용YoY", val:(()=>{const v=[...(macroData?.hhCreditYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v!=null?`${v>0?"+":""}${v}%`:"-";})(),
             color:(()=>{const v=[...(macroData?.hhCreditYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"#888":v>=8?C.red:v>=5?C.orange:v>=2?C.gold:C.green;})(),
             tip:(()=>{const v=[...(macroData?.hhCreditYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"":v>=8?"과열↑":v>=5?"경계":v>=2?"완만":"감소↓";})()},
            {label:"10Y-3Y금리차", val:(()=>{const v=(macroData?.yieldSpread||[]).slice(-1)[0]?.value??null;return v!=null?`${v>0?"+":""}${v}%p`:"-";})(),
             color:(()=>{const v=(macroData?.yieldSpread||[]).slice(-1)[0]?.value??null;return v==null?"#888":v<-0.5?C.red:v<0?C.orange:v<0.5?C.gold:C.green;})(),
             tip:(()=>{const v=(macroData?.yieldSpread||[]).slice(-1)[0]?.value??null;return v==null?"":v<-0.5?"역전↓":v<0?"평탄":v<0.5?"보통":"정상화↑";})()},
          ];

          // ── IndexChart — 주가탭 위치밴드 스타일
          const IndexChart=({title,maData,rsiData,color})=>{
            // 위치밴드 계산 (maData에 price 필드 있음)
            const bandData=calcPositionBands(maData);
            const lastValid=bandData.filter(d=>d.bBase!=null).slice(-1)[0];
            const lastGap=lastValid?.gap60??null;
            const gapColor=lastGap==null?"#888":lastGap>100?C.red:lastGap>50?C.orange:lastGap>0?C.gold:lastGap>-20?C.teal:C.green;
            const gapLabel=lastGap==null?"":lastGap>100?"VH이상":lastGap>50?"H이상":lastGap>0?"QMA위":lastGap>-20?"L위":"VL근접";
            return(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <ST accent={color}>{title} — QMA 위치밴드</ST>
                {lastGap!=null&&(
                  <div style={{background:`${gapColor}20`,border:`1px solid ${gapColor}66`,
                    borderRadius:6,padding:"3px 9px",fontSize:10,fontWeight:700,color:gapColor,fontFamily:"monospace"}}>
                    이격도 {lastGap>0?"+":""}{lastGap}% {gapLabel}
                  </div>
                )}
              </div>
              {/* 위치밴드 차트 */}
              <CW h={300}>
                <ComposedChart data={bandData} margin={{top:16,right:44,left:0,bottom:8}}>
                  <defs>
                    <linearGradient id={`floorShade_${title}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.blue} stopOpacity={0.0}/>
                      <stop offset="100%" stopColor={C.blue} stopOpacity={0.14}/>
                    </linearGradient>
                    <linearGradient id={`peakShade_${title}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.purple} stopOpacity={0.14}/>
                      <stop offset="100%" stopColor={C.purple} stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={Math.floor(bandData.length/7)||1}/>
                  <YAxis {...yp("",52)} tickFormatter={v=>v.toLocaleString()} domain={["auto","auto"]}/>
                  <Tooltip content={<MTip/>} cursor={false}/>
                  <Legend wrapperStyle={{fontSize:9}} iconSize={10}/>
                  <Area dataKey="bFloor"    name="VL ×0.6"  stroke="#3B7DD8"  strokeWidth={1}   strokeDasharray="3 4" fill={`${C.blue}00`}                    dot={false} legendType="line"/>
                  <Area dataKey="bKnee"     name="L ×0.8"   stroke={C.blue}   strokeWidth={1.5} strokeDasharray="6 3" fill={`url(#floorShade_${title})`}       dot={false} legendType="line"/>
                  <Line dataKey="bBase"     name="QMA"    stroke={C.goldL}  strokeWidth={2}                         dot={false}/>
                  <Line dataKey="bShoulder" name="H ×1.5"   stroke={C.orange} strokeWidth={1.5} strokeDasharray="8 3" dot={false}/>
                  <Line dataKey="bTop"      name="VH ×2.0"  stroke={C.red}    strokeWidth={1.5} strokeDasharray="5 3" dot={false}/>
                  <Area dataKey="bPeak"     name="EH ×2.5"  stroke={C.purple} strokeWidth={1}   strokeDasharray="3 4" fill={`url(#peakShade_${title})`}        dot={false} legendType="line"/>
                  <Area dataKey="price"     name={title}    stroke={color}    strokeWidth={2.5} fill={`${color}14`}   dot={false}/>
                  {lastValid&&[
                    {key:"bPeak",    color:C.purple,  label:"EH"},
                    {key:"bTop",     color:C.red,     label:"VH"},
                    {key:"bShoulder",color:C.orange,  label:"H"},
                    {key:"bBase",    color:C.goldL,   label:"QMA"},
                    {key:"bKnee",    color:C.blue,    label:"L"},
                    {key:"bFloor",   color:"#3B7DD8", label:"VL"},
                  ].map(b=>(
                    <ReferenceDot key={b.key} x={lastValid.date} y={lastValid[b.key]} r={0}
                      label={{value:b.label,position:"right",fill:b.color,fontSize:9,fontWeight:700}}/>
                  ))}
                </ComposedChart>
              </CW>
              {/* 이격도 바 차트 */}
              <ST accent={C.teal}>QMA 이격도 (%)</ST>
              <CW h={170}>
                <ComposedChart data={bandData.filter(d=>d.gap60!=null)} margin={{top:4,right:20,left:0,bottom:8}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={Math.floor(bandData.length/7)||1}/>
                  <YAxis {...yp("%",44)}/>
                  <Tooltip content={<MTip/>} cursor={false}/>
                  <ReferenceArea y1={-100} y2={-40} fill={`${C.green}10`}/>
                  <ReferenceArea y1={150}  y2={500} fill={`${C.red}08`}/>
                  <ReferenceLine y={0}   stroke={C.dim}    strokeDasharray="2 2"/>
                  <ReferenceLine y={-40} stroke={C.green}  strokeDasharray="4 2" label={{value:"VL -40%", fill:C.green, fontSize:8,position:"insideTopLeft"}}/>
                  <ReferenceLine y={-20} stroke={C.teal}   strokeDasharray="4 2" label={{value:"L -20%",  fill:C.teal,  fontSize:8,position:"insideTopLeft"}}/>
                  <ReferenceLine y={50}  stroke={C.gold}   strokeDasharray="4 2" label={{value:"H +50%",  fill:C.gold,  fontSize:8,position:"insideTopLeft"}}/>
                  <ReferenceLine y={100} stroke={C.orange} strokeDasharray="4 2" label={{value:"VH +100%",fill:C.orange,fontSize:8,position:"insideTopLeft"}}/>
                  <ReferenceLine y={150} stroke={C.red}    strokeDasharray="4 2" label={{value:"EH +150%",fill:C.red,  fontSize:8,position:"insideTopLeft"}}/>
                  <Bar dataKey="gap60" name="이격도(%)" maxBarSize={8} radius={[2,2,0,0]} fill={C.teal}/>
                </ComposedChart>
              </CW>
              {/* RSI */}
              <ST accent={C.green}>RSI (14개월)</ST>
              <CW h={120}>
                <ComposedChart data={rsiData} margin={{top:4,right:20,left:0,bottom:8}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={Math.floor(rsiData.length/7)||1}/>
                  <YAxis domain={[0,100]} {...yp("%")}/>
                  <Tooltip content={<MTip/>} cursor={false}/>
                  <ReferenceArea y1={70} y2={100} fill={`${C.red}12`}/>
                  <ReferenceArea y1={0}  y2={30}  fill={`${C.green}12`}/>
                  <ReferenceLine y={70} stroke={C.red}   strokeDasharray="4 2" label={{value:"과매수70",fill:C.red,  fontSize:9}}/>
                  <ReferenceLine y={30} stroke={C.green} strokeDasharray="4 2" label={{value:"과매도30",fill:C.green,fontSize:9}}/>
                  <Area dataKey="rsi" name="RSI(%)" stroke={C.green} strokeWidth={2} fill={`${C.green}18`} dot={false}/>
                </ComposedChart>
              </CW>
            </>
            );
          };

          const dc=macroData?.defconData;
          const DL=[
            {n:1,color:"#FF1A1A"},{n:2,color:"#FF6B00"},
            {n:3,color:"#F0C800"},{n:4,color:"#38BDF8"},{n:5,color:"#00C878"},
          ];

          return(
          <div style={{animation:"fadeIn 0.3s ease"}}>
            {marketLoading&&(
              <Box><div style={{color:C.muted,textAlign:"center",padding:24,fontSize:12}}>
                🌐 거시경제 데이터 로딩중...
              </div></Box>
            )}

            {/* ── 서브탭 버튼 */}
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              {[["econ","E-CON"],["kospi","코스피"],["kosdaq","코스닥"]].map(([k,label])=>(
                <button key={k} onClick={()=>setMarketSub(k)}
                  style={{flex:1,padding:"7px 0",borderRadius:8,border:`1.5px solid ${marketSub===k?C.teal:C.border}`,
                    background:marketSub===k?`${C.teal}22`:C.card2,
                    color:marketSub===k?C.teal:C.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>
                  {label}
                </button>
              ))}
            </div>

            {/* ══ E-CON 섹션 ══ */}
            {marketSub==="econ"&&<>
            {/* ══ ECON DEFCON ══ */}
            {dc&&(
            <div style={{background:C.card,border:`2px solid ${dc.defconColor}55`,
              borderRadius:14,padding:"14px 14px 12px",marginBottom:10,
              boxShadow:`0 0 24px ${dc.defconColor}22`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div>
                  <div style={{color:C.muted,fontSize:8,letterSpacing:"0.1em",marginBottom:2}}>ECONOMIC DEFCON — RAY DALIO 빅사이클 기반</div>
                  <div style={{color:dc.defconColor,fontSize:20,fontWeight:900,fontFamily:"monospace"}}>{dc.defconLabel}</div>
                  <div style={{color:`${C.muted}99`,fontSize:7,marginTop:2}}>
                    데이터 기준: {macroData?.updatedAt ? new Date(macroData.updatedAt).toLocaleDateString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}) : "-"}
                  </div>
                </div>
                <div style={{display:"flex",gap:5,alignItems:"flex-end"}}>
                  {DL.map(l=>(
                    <div key={l.n} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <div style={{width:22,height:20+(6-l.n)*2,borderRadius:4,
                        background:dc.defcon===l.n?l.color:`${l.color}28`,
                        border:`1.5px solid ${dc.defcon===l.n?l.color:l.color+"44"}`,
                        boxShadow:dc.defcon===l.n?`0 0 10px ${l.color}88`:"none"}}/>
                      <div style={{color:dc.defcon===l.n?l.color:C.muted,fontSize:7,fontWeight:700}}>{l.n}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{color:C.muted,fontSize:8}}>위기 ← 종합점수 → 안정</span>
                  <span style={{color:dc.defconColor,fontSize:9,fontWeight:700,fontFamily:"monospace"}}>
                    {dc.totalScore>0?"+":""}{dc.totalScore} / {dc.maxScore}
                  </span>
                </div>
                <div style={{background:C.dim,borderRadius:6,height:7,overflow:"hidden"}}>
                  <div style={{width:`${Math.max(2,Math.round((dc.totalScore+dc.maxScore)/(dc.maxScore*2)*100))}%`,
                    height:"100%",borderRadius:6,
                    background:"linear-gradient(90deg,#FF1A1A,#FF6B00,#F0C800,#38BDF8,#00C878)",
                    transition:"width 0.6s ease"}}/>
                </div>
              </div>
              <div style={{color:C.muted,fontSize:9,marginBottom:8,lineHeight:1.5,
                background:C.card2,borderRadius:7,padding:"5px 8px",
                borderLeft:`3px solid ${dc.defconColor}`}}>{dc.defconDesc}</div>
              {/* ── ECON 판정 상세 해설 */}
              <div style={{background:C.card2,borderRadius:8,padding:"8px 10px",marginBottom:8,fontSize:8,color:C.muted,lineHeight:1.7}}>
                <div style={{color:C.gold,fontWeight:700,marginBottom:4,fontSize:8}}>📋 판정 근거</div>
                {dc.indicators.map(ind=>{
                  const sc=ind.score;
                  const bc=sc>=1?C.green:sc<=-1?C.red:C.gold;
                  const arrow=sc>=2?"▲▲":sc===1?"▲":sc===-1?"▼":"▼▼";
                  const vStr=ind.val!=null?(ind.unit==="원"?Math.round(ind.val).toLocaleString():ind.val)+ind.unit:"—";
                  const reason=sc>=2?`${vStr} — ${ind.good} 구간으로 경제에 우호적`
                    :sc===1?`${vStr} — 양호하나 추가 관찰 필요`
                    :sc===-1?`${vStr} — 경계 구간 진입, 주의 필요`
                    :sc<=-2?`${vStr} — ${ind.bad} 상태로 투자 위험 신호`
                    :`${vStr} — 중립`;
                  return(
                  <div key={ind.key} style={{display:"flex",gap:6,alignItems:"baseline",marginBottom:2}}>
                    <span style={{color:bc,fontWeight:700,width:14,flexShrink:0}}>{sc!==0?arrow:"—"}</span>
                    <span style={{color:"#aaa",width:62,flexShrink:0}}>{ind.label}</span>
                    <span style={{color:C.muted}}>{reason}</span>
                  </div>
                  );
                })}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 8px"}}>
                {dc.indicators.map(ind=>{
                  const sc=ind.score;
                  const bc=sc>=1?C.green:sc<=-1?C.red:C.gold;
                  const st=sc>=2?ind.good:sc<=-2?ind.bad:ind.warn;
                  const vStr=ind.val!=null
                    ?(ind.unit==="원"?Math.round(ind.val).toLocaleString()
                      :ind.unit==="%"?(ind.val>0?"+":"")+ind.val:ind.val)+ind.unit:"—";
                  return(
                  <div key={ind.key} style={{display:"flex",alignItems:"center",gap:5,
                    background:C.card2,borderRadius:6,padding:"4px 7px"}}>
                    <div style={{flex:"0 0 60px"}}>
                      <div style={{color:C.muted,fontSize:7,marginBottom:1}}>{ind.label}</div>
                      <div style={{color:bc,fontSize:9,fontWeight:700,fontFamily:"monospace"}}>{vStr}</div>
                    </div>
                    <div style={{flex:1,display:"flex",alignItems:"center",gap:3}}>
                      <div style={{flex:1,background:C.dim,borderRadius:3,height:5,position:"relative"}}>
                        <div style={{position:"absolute",left:sc<0?`${50+sc*25}%`:"50%",
                          width:`${Math.abs(sc)*25}%`,height:"100%",background:bc,borderRadius:3}}/>
                      </div>
                      <div style={{color:bc,fontSize:7,width:28,textAlign:"right",flexShrink:0}}>{st}</div>
                    </div>
                  </div>
                  );
                })}
              </div>
              <div style={{color:`${C.muted}66`,fontSize:7,marginTop:6,textAlign:"right"}}>
                Ray Dalio 빅사이클 · 단기부채사이클 기반 / 투자 참고용
              </div>
            </div>
            )}

            {/* ── 거시 신호등 */}
            <Box>
              <ST accent={C.teal}>거시경제 신호등</ST>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
                {signals.map(s=>(
                  <div key={s.label} style={{background:C.card2,border:`1px solid ${s.color}44`,borderRadius:10,padding:"9px 6px",textAlign:"center"}}>
                    <div style={{color:C.muted,fontSize:8,marginBottom:3}}>{s.label}</div>
                    <div style={{width:9,height:9,borderRadius:"50%",background:s.color,margin:"0 auto 3px"}}/>
                    <div style={{color:s.color,fontSize:10,fontWeight:700,fontFamily:"monospace"}}>{s.val}</div>
                    <div style={{color:C.muted,fontSize:8,marginTop:2}}>{s.tip}</div>
                  </div>
                ))}
              </div>
            </Box>

            {/* ── 수출+코스피 동행 */}
            {macroMerged.length>0&&(
              <Box>
                <ST accent={C.teal}>일평균수출 · 코스피 동행 추이 (정규화 비교)</ST>
                {(()=>{
                  // Z-Score 정규화 (편차 1.5배 확대)
                  const expVals=macroMerged.map(d=>d.dailyExport).filter(v=>v!=null);
                  const kpVals=macroMerged.map(d=>d.price).filter(v=>v!=null);
                  const mean=arr=>arr.reduce((s,v)=>s+v,0)/arr.length;
                  const std=arr=>{const m=mean(arr);return Math.sqrt(arr.map(v=>(v-m)**2).reduce((s,v)=>s+v,0)/arr.length)||1;};
                  const eM=mean(expVals),eS=std(expVals),kM=mean(kpVals),kS=std(kpVals);
                  const AMP=1.5; // 시인성 확대 계수
                  const normalized=macroMerged.map(d=>({
                    date:d.date,
                    수출Z:d.dailyExport!=null?+((d.dailyExport-eM)/eS*AMP).toFixed(2):null,
                    코스피Z:d.price!=null?+((d.price-kM)/kS*AMP).toFixed(2):null,
                  }));
                  // 최신 고/저평가 계산
                  const last=normalized.filter(d=>d.수출Z!=null&&d.코스피Z!=null).slice(-1)[0];
                  const gap=last?+(last.코스피Z-last.수출Z).toFixed(2):null;
                  const gapLabel=gap==null?"":gap>1.5?"강한 과열":gap>0.5?"과열":gap>-0.5?"중립":gap>-1.5?"저평가":"강한 저평가";
                  const gapColor=gap==null?"#888":gap>1?"#FF6B00":gap>0?"#F0C800":gap>-1?"#38BDF8":"#00C878";
                  return(<>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                    <span style={{fontSize:8,color:C.muted}}>📌 Z-Score 기반 — 코스피가 수출 대비</span>
                    {gap!=null&&(
                      <span style={{fontSize:10,fontWeight:700,color:gapColor,fontFamily:"monospace"}}>
                        {gap>0?"+":""}{gap}σ {gapLabel}
                      </span>
                    )}
                  </div>
                  <CW h={240}>
                    <ComposedChart data={normalized} margin={{top:6,right:8,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={11} tickFormatter={v=>v?.slice(0,4)||""}/>
                      <YAxis tick={{fill:C.muted,fontSize:9}} width={32} tickFormatter={v=>`${v>0?"+":""}${v}`} domain={["auto","auto"]}/>
                      <Tooltip content={<MTip/>} cursor={false}/>
                      <Legend wrapperStyle={{fontSize:9}}/>
                      <ReferenceLine y={0}    stroke={C.muted}           strokeDasharray="4 2"/>
                      <ReferenceLine y={1.5}  stroke={`${C.red}55`}      strokeDasharray="3 3" label={{value:"과열",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                      <ReferenceLine y={-1.5} stroke={`${C.green}55`}    strokeDasharray="3 3" label={{value:"침체",fill:C.green,fontSize:7,position:"insideBottomRight"}}/>
                      <Line dataKey="수출Z"   name="수출(Z)"   stroke={C.teal}   strokeWidth={2}   dot={false} connectNulls/>
                      <Line dataKey="코스피Z" name="코스피(Z)" stroke="#38BDF8" strokeWidth={2.5} dot={false}/>
                    </ComposedChart>
                  </CW>
                  </>);
                })()}

                {(macroData?.ppi||[]).filter(r=>r.yoy!=null).length>0&&(
                  <>
                  <ST accent={C.orange} right="생산자물가 전년비%">PPI — 원가 압력 선행지표</ST>
                  <CW h={180}>
                    <ComposedChart data={(macroData.ppi||[]).filter(r=>r.yoy!=null).slice(-60)} margin={{top:4,right:20,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={11} tickFormatter={v=>v?.slice(0,4)||""}/>
                      <YAxis {...yp("%",42)} domain={["auto","auto"]}/>
                      <Tooltip content={<MTip/>} cursor={false}/>
                      <ReferenceLine y={0}  stroke={C.muted}  strokeDasharray="4 2"/>
                      <ReferenceLine y={3}  stroke={C.orange} strokeDasharray="3 3" label={{value:"주의+3%",fill:C.orange,fontSize:8,position:"insideTopRight"}}/>
                      <ReferenceLine y={-3} stroke={C.blueL}  strokeDasharray="3 3" label={{value:"디플레-3%",fill:C.blueL,fontSize:8,position:"insideBottomRight"}}/>
                      <Bar dataKey="yoy" name="PPI YoY%" maxBarSize={12} radius={[2,2,0,0]} fill={C.orange} opacity={0.75}/>
                    </ComposedChart>
                  </CW>
                  </>
                )}
                {(macroData?.bsi||[]).length>0&&(()=>{
                  const bsiRaw=(macroData.bsi||[]).slice(-60);
                  const withMA=bsiRaw.map((r,i,a)=>{
                    const ma3=i>=2?+((a[i].value+a[i-1].value+a[i-2].value)/3).toFixed(1):null;
                    const ma6=i>=5?+(a.slice(i-5,i+1).reduce((s,x)=>s+x.value,0)/6).toFixed(1):null;
                    return{...r,ma3,ma6};
                  });
                  const ma6arr=withMA.filter(d=>d.ma6!=null);
                  const lastMA6=ma6arr.slice(-1)[0];
                  const prevMA6=ma6arr.slice(-4,-1)[0];
                  const trend=lastMA6&&prevMA6?(lastMA6.ma6>prevMA6.ma6?"개선↑":"둔화↓"):null;
                  const trendColor=trend?.includes("개선")?C.green:C.red;
                  return(<>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <ST accent={C.purple}>BSI 제조업 — 경기 방향성 선행</ST>
                    {lastMA6&&trend&&(
                      <span style={{fontSize:10,fontWeight:700,color:trendColor,fontFamily:"monospace",marginBottom:4}}>
                        6MA {lastMA6.ma6} {trend}
                      </span>
                    )}
                  </div>
                  <CW h={190}>
                    <ComposedChart data={withMA} margin={{top:4,right:20,left:0,bottom:8}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                      <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={11} tickFormatter={v=>v?.slice(0,4)||""}/>
                      <YAxis {...yp("",42)} domain={["auto","auto"]}/>
                      <Tooltip content={<MTip/>} cursor={false}/>
                      <ReferenceArea y1={100} y2={200} fill={`${C.green}08`}/>
                      <ReferenceArea y1={0}   y2={100} fill={`${C.red}08`}/>
                      <ReferenceLine y={100} stroke={C.green} strokeDasharray="4 2" label={{value:"기준100",fill:C.green,fontSize:8,position:"insideTopRight"}}/>
                      <Line dataKey="value" name="원시값"   stroke={`${C.purple}55`} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="3 2"/>
                      <Line dataKey="ma3"   name="3MA단기"  stroke={C.purple}         strokeWidth={2}   dot={false} connectNulls/>
                      <Line dataKey="ma6"   name="6MA추세"  stroke={C.gold}           strokeWidth={2.5} dot={false} connectNulls/>
                    </ComposedChart>
                  </CW>
                  </>);
                })()}
              </Box>
            )}

            {/* ── 가계신용 증가율 그래프 */}
            {(macroData?.hhCreditYoY||[]).filter(r=>r.yoy!=null).length>0&&(
            <Box>
              <ST accent={C.orange}>가계신용 증가율 (전년동기비 %)</ST>
              {(()=>{
                const data=(macroData.hhCreditYoY||[]).filter(r=>r.yoy!=null);
                const last=data.slice(-1)[0];
                const v=last?.yoy??null;
                const vc=v==null?"#888":v>=8?C.red:v>=5?C.orange:v>=2?C.gold:C.green;
                const vl=v==null?"":v>=8?"과열":v>=5?"경계":v>=2?"완만":"감소";
                return(<>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"5px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>달리오 단기부채사이클 — 가계신용 팽창 모니터</span>
                  {v!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{v>0?"+":""}{v}% {vl}</span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs>
                      <linearGradient id="hhGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.orange} stopOpacity={0.35}/>
                        <stop offset="100%" stopColor={C.orange} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={3} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v>0?"+":""}${v}%`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={0}   stroke={C.muted}        strokeDasharray="4 2"/>
                    <ReferenceLine y={8}   stroke={`${C.red}66`}   strokeDasharray="3 3" label={{value:"과열 8%",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={5}   stroke={`${C.orange}66`}strokeDasharray="3 3" label={{value:"경계 5%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={2}   stroke={`${C.gold}55`}  strokeDasharray="3 3" label={{value:"완만 2%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="yoy" name="가계신용YoY" stroke={C.orange} strokeWidth={2.5} fill="url(#hhGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 장단기 금리차 그래프 */}
            {(macroData?.yieldSpread||[]).length>0&&(
            <Box>
              <ST accent={C.teal}>장단기 금리차 — 국고채 10Y − 3Y (%p)</ST>
              {(()=>{
                const data=macroData.yieldSpread||[];
                const last=data.slice(-1)[0];
                const v=last?.value??null;
                const vc=v==null?"#888":v<-0.5?C.red:v<0?C.orange:v<0.5?C.gold:C.green;
                const vl=v==null?"":v<-0.5?"역전":v<0?"평탄":v<0.5?"보통":"정상화";
                return(<>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"5px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>달리오 빅사이클 — 역전 시 경기침체 선행 신호</span>
                  {v!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{v>0?"+":""}{v}%p {vl}</span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs>
                      <linearGradient id="ysGradPos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.teal} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.teal} stopOpacity={0.02}/>
                      </linearGradient>
                      <linearGradient id="ysGradNeg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.red} stopOpacity={0.02}/>
                        <stop offset="100%" stopColor={C.red} stopOpacity={0.3}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={11} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v>0?"+":""}${v}`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={0}    stroke={C.red}          strokeWidth={1.5} strokeDasharray="4 2" label={{value:"역전선",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={0.5}  stroke={`${C.gold}55`}  strokeDasharray="3 3" label={{value:"0.5%p",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={-0.5} stroke={`${C.red}55`}   strokeDasharray="3 3" label={{value:"-0.5%p",fill:C.red,fontSize:7,position:"insideBottomRight"}}/>
                    <Area dataKey="value" name="10Y-3Y" stroke={C.teal} strokeWidth={2.5} fill="url(#ysGradPos)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}
            </> /* econ 섹션 끝 */}

            {/* ══ 코스피 섹션 ══ */}
            {marketSub==="kospi"&&(
            <>
            {/* ── 코스피 기술분석 */}
            {kospiMonthly.length>0?(
              <Box>
                <IndexChart title="코스피" maData={kospiMA} rsiData={kospiRSI} color="#38BDF8"/>
              </Box>
            ):(
              <Box><div style={{color:C.muted,fontSize:11,textAlign:"center",padding:16}}>코스피 데이터 로딩 중...</div></Box>
            )}
            </>
            )}

            {/* ══ 코스닥 섹션 ══ */}
            {marketSub==="kosdaq"&&(
            <>
            {/* ── 코스닥 기술분석 */}
            {kosdaqMonthly.length>0?(
              <Box>
                <IndexChart title="코스닥" maData={kosdaqMA} rsiData={kosdaqRSI} color={C.purple}/>
              </Box>
            ):(
              <Box><div style={{color:C.muted,fontSize:11,textAlign:"center",padding:16}}>코스닥 데이터 로딩 중...</div></Box>
            )}
            </>
            )}
          </div>
          );
        })()}

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
          padding:"8px 12px",display:"flex",justifyContent:"space-between",
          alignItems:"center",flexWrap:"wrap",gap:4,marginTop:12}}>
          <div style={{color:C.gold,fontSize:11,fontWeight:700}}>🌲 SEQUOIA v3.3</div>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            <Tag color={C.blue}  size={8}>주가:한투API</Tag>
            <Tag color={C.green} size={8}>재무:엑셀입력</Tag>
            <Tag color={C.purple} size={8}>DB:Supabase</Tag>
            <Tag color={C.gold}  size={8}>투자참고용</Tag>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        html,body{overflow-x:hidden;background:${C.bg};min-height:100%;}
        html,body,#root{background:${C.bg};}
        @media (hover:none) and (pointer:coarse){html,body{overscroll-behavior-y:contain;}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        *{-webkit-tap-highlight-color:transparent;}
        /* 기본: 스크롤바 전체 숨김 (모바일 포함 모든 환경) */
        ::-webkit-scrollbar{display:none !important;}
        *{scrollbar-width:none !important;}
        /* PC 마우스 환경에서만 .show-scrollbar 클래스로 되살림 */
        .show-scrollbar ::-webkit-scrollbar{display:block !important;width:6px;height:6px;}
        .show-scrollbar ::-webkit-scrollbar-track{background:transparent;}
        .show-scrollbar ::-webkit-scrollbar-thumb{background:${C.border};border-radius:6px;}
        .show-scrollbar ::-webkit-scrollbar-thumb:hover{background:${C.muted};}
        .show-scrollbar *{scrollbar-width:thin !important;scrollbar-color:${C.border} transparent;}
      `}</style>
    </div>
  );
}
