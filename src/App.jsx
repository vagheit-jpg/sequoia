import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  ComposedChart, AreaChart, Area, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, ReferenceArea, ReferenceDot,
} from "recharts";
import { DARK, LIGHT } from "./constants/theme";
import { PRICE_CACHE_TTL } from "./constants/cache";
import {
  calcMACD,
  calcRSI,
  calcOBV,
  calcMFI,
  calcMA60,
  calcMAN,
  calcSignalPoints,
  calcPositionBands,
  calc3LineSignal,
  buildBandsFromQtr,
} from "./engines/technicalEngine";
import {
  calcDCF_rate,
  calcDCF_graham,
  calcDCF_roe,
  buildDCFHistory,
  calcOwnerEarnings,
  calcDCF_owner,
  calcReverseDCF,
} from "./engines/dcfEngine";
import {
  sbGetStocks,
  sbUpsertStock,
  sbUpsertPredictionSnapshot,
  sbDeleteStock,
  rowToStock,
} from "./services/supabaseService";
import { fetchPrice } from "./services/priceService";
// ══════════════════════════════════════════════════════════════
// 0. 색상
// ══════════════════════════════════════════════════════════════

let C=DARK;

// ══════════════════════════════════════════════════════════════
// 2. 주가: 키움 REST API 서버리스 중계 + localStorage 캐시
// ══════════════════════════════════════════════════════════════

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
// 3-A. AEGIS 시장 스냅샷 엔진 — 월 1회 Supabase 저장용
// ══════════════════════════════════════════════════════════════
const sqClamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const sqNum=(v,d=2)=>Number.isFinite(Number(v))?+Number(v).toFixed(d):null;
const sqMonthKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;


// ══════════════════════════════════════════════════════════════
// 3-B. Bubble Energy v1 — 급등 에너지/평균회귀 위험 추정 엔진
// ══════════════════════════════════════════════════════════════
// 주의: 아래 사례값은 정밀 예언이 아니라 역사적 버블·충격 구간의 대표 범위(anchor)입니다.
// 향후 sefcon_prediction_snapshots의 실제 검증값이 쌓이면 이 anchor보다 자체 경험 데이터 가중치를 높입니다.
const BUBBLE_ENERGY_ARCHETYPES=[
  {id:"NASDAQ_2000", name:"1999~2000 NASDAQ", type:"IT 초버블형", energy:96, drawdown:"약 -78%", duration:"약 31개월 하락 · 장기 회복", dd:[55,78], months:[24,36], tags:["초고속상승","기술주집중","밸류팽창","모멘텀붕괴"]},
  {id:"JAPAN_1989", name:"1987~1989 일본 자산버블", type:"장기 자산버블형", energy:98, drawdown:"약 -60%~-80%", duration:"수년 하락 · 초장기 횡보", dd:[45,70], months:[36,120], tags:["자산버블","신용팽창","장기횡보","정책전환"]},
  {id:"KOSDAQ_2000", name:"1999~2000 코스닥", type:"한국 성장주 광풍형", energy:99, drawdown:"약 -80%~-90%", duration:"24~48개월 급락/침체", dd:[60,90], months:[24,48], tags:["소형성장주","개인투기","초과열","유동성축소"]},
  {id:"GFC_2008", name:"2007~2008 글로벌 금융위기", type:"금융위기 붕괴형", energy:82, drawdown:"약 -45%~-60%", duration:"12~24개월 하락", dd:[35,60], months:[12,24], tags:["신용경색","은행위기","레버리지","패닉"]},
  {id:"COVID_2020_LIQ", name:"2020~2021 코로나 유동성장", type:"유동성 과열형", energy:72, drawdown:"이후 성장주 -30%~-60%", duration:"12~30개월 조정", dd:[25,55], months:[12,30], tags:["초저금리","유동성","성장주","정책회수"]},
  {id:"BATTERY_2021", name:"2021~2023 2차전지/성장주", type:"테마 버블형", energy:88, drawdown:"주도주 -50%~-75%", duration:"18~36개월 조정", dd:[40,75], months:[18,36], tags:["테마집중","개인수급","밸류확장","후행조정"]},
  {id:"QT_2022", name:"2022 금리/QT 쇼크", type:"긴축충격형", energy:67, drawdown:"지수 -20%~-35%", duration:"9~18개월 조정", dd:[18,35], months:[9,18], tags:["금리급등","멀티플축소","달러강세","성장주압박"]},
  {id:"AI_SEMI_2026", name:"2024~2026 AI 반도체 집중장", type:"AI 집중 과열형", energy:90, drawdown:"가정범위 -35%~-60%", duration:"12~36개월 가능", dd:[30,60], months:[12,36], tags:["AI집중","대형주쏠림","실적기대","후행검증"]},
];

const buildBubbleEnergyModel=({market,monthly,lastGap,lastRSI,lastMFI,bandLevel,sefScore=50,macdWeak=false,obvWeak=false,techTotal=0})=>{
  if(!monthly?.length)return null;
  const last=monthly[monthly.length-1]?.price??null;
  const priceN=(n)=>monthly.length>n?monthly[monthly.length-1-n]?.price:null;
  const p12=priceN(12),p24=priceN(24),p36=priceN(36);
  const ret12=last&&p12?((last/p12-1)*100):null;
  const ret24=last&&p24?((last/p24-1)*100):null;
  const ret36=last&&p36?((last/p36-1)*100):null;

  const gapAbs=lastGap==null?0:Math.max(0,lastGap);
  const gapScore=sqClamp(gapAbs/2.2,0,42);                 // +100% 이격 ≈ 45점 한도 내 핵심 에너지
  const rsiScore=lastRSI==null?0:lastRSI>=88?18:lastRSI>=82?14:lastRSI>=75?10:lastRSI>=68?6:0;
  const mfiScore=lastMFI==null?0:lastMFI>=90?8:lastMFI>=80?5:lastMFI>=65?2:0;
  const retScore=(ret12==null?0:sqClamp(ret12/8,0,22)) + (ret24==null?0:sqClamp(ret24/18,0,14));
  const accelScore=(ret12!=null&&ret24!=null&&ret12>(ret24/2))?6:0;
  const bandScore=bandLevel==="EH"?14:bandLevel==="VH"?10:bandLevel==="H"?5:0;
  const macroScore=sefScore<35?10:sefScore<50?6:sefScore<65?2:0;
  const exhaustScore=(macdWeak?5:0)+(obvWeak?4:0)+(techTotal<0?3:0);
  const concentrationScore=market==="KOSPI"&&ret12!=null&&ret12>80?5:market==="KOSDAQ"&&ret12!=null&&ret12>60?4:0;
  const score=Math.round(sqClamp(gapScore+rsiScore+mfiScore+retScore+accelScore+bandScore+macroScore+exhaustScore+concentrationScore,0,100));

  const level=score>=88?"EXTREME":score>=75?"VERY HIGH":score>=60?"HIGH":score>=42?"ELEVATED":"LOW";
  const levelKo=score>=88?"극단 과열":score>=75?"매우 높음":score>=60?"높음":score>=42?"주의":"낮음";
  const levelIcon=score>=88?"🔥":score>=75?"🔴":score>=60?"🟠":score>=42?"🟡":"🟢";

  const enriched=BUBBLE_ENERGY_ARCHETYPES.map(c=>{
    const energyDiff=Math.abs(score-c.energy);
    const tagScore=(bandLevel==="EH"&&c.tags.includes("초과열")?6:0)
      +(bandLevel==="VH"&&c.tags.some(t=>t.includes("테마")||t.includes("집중"))?4:0)
      +(sefScore<50&&c.tags.some(t=>t.includes("신용")||t.includes("금리")||t.includes("정책"))?5:0)
      +(market==="KOSDAQ"&&c.id.includes("KOSDAQ")?7:0)
      +(market==="KOSPI"&&c.id.includes("AI_SEMI")?7:0)
      +(ret12!=null&&ret12>80&&c.tags.some(t=>t.includes("초고속")||t.includes("집중"))?5:0);
    const similarity=Math.round(sqClamp(100-energyDiff*1.4+tagScore,0,99));
    return{...c,similarity};
  }).sort((a,b)=>b.similarity-a.similarity).slice(0,3);

  const avg=(arr)=>arr.reduce((s,v)=>s+v,0)/Math.max(1,arr.length);
  const weightSum=enriched.reduce((s,c)=>s+c.similarity,0)||1;
  const wavg=(fn)=>enriched.reduce((s,c)=>s+fn(c)*c.similarity,0)/weightSum;
  let ddLow=Math.round(wavg(c=>c.dd[0]));
  let ddHigh=Math.round(wavg(c=>c.dd[1]));
  let moLow=Math.round(wavg(c=>c.months[0]));
  let moHigh=Math.round(wavg(c=>c.months[1]));

  // 현재 에너지가 낮으면 과거 극단 사례 평균을 완충하고, 극단이면 상단을 열어둡니다.
  const energyAdj=(score-70)/100;
  ddLow=Math.max(5,Math.round(ddLow*(0.75+energyAdj)));
  ddHigh=Math.max(ddLow+5,Math.round(ddHigh*(0.85+energyAdj)));
  moLow=Math.max(3,Math.round(moLow*(0.8+energyAdj/2)));
  moHigh=Math.max(moLow+3,Math.round(moHigh*(0.85+energyAdj/2)));

  const action=score>=88?"추격매수 금지 · 반등 시 리스크 축소 우선":score>=75?"신규매수 신중 · 현금비중 점진 확대":score>=60?"과열권 진입 · 분할 대응 필요":score>=42?"주의 관찰 · 변동성 확대 대비":"정상 범위 · 다른 엔진 신호 우선";
  const summary=score>=88?"역사적 과열 사례와 유사한 평균회귀 압력이 매우 큽니다.":score>=75?"급등 에너지가 누적되어 후행 조정 가능성이 높아진 구간입니다.":score>=60?"과열 에너지가 높아지고 있으나 아직 극단 붕괴권은 아닙니다.":score>=42?"일부 과열 신호가 있으나 방향성 확인이 필요합니다.":"버블 에너지 자체는 낮거나 중립입니다.";

  return{
    score,level,levelKo,levelIcon,summary,action,
    ret12:sqNum(ret12,1),ret24:sqNum(ret24,1),ret36:sqNum(ret36,1),
    expectedDrawdown:{low:ddLow,high:ddHigh,text:`-${ddLow}~-${ddHigh}%`},
    expectedDuration:{low:moLow,high:moHigh,text:`${moLow}~${moHigh}개월`},
    similarCases:enriched.map(c=>({id:c.id,name:c.name,type:c.type,energy:c.energy,similarity:c.similarity,actualDrawdown:c.drawdown,actualDuration:c.duration,rangeDrawdown:`-${c.dd[0]}~-${c.dd[1]}%`,rangeMonths:`${c.months[0]}~${c.months[1]}개월`,tags:c.tags})),
    inputs:{market,gapQma:sqNum(lastGap,2),rsi:sqNum(lastRSI,1),mfi:sqNum(lastMFI,1),bandLevel,sefconScore:sefScore,macdWeak,obvWeak,techTotal:sqNum(techTotal,2)}
  };
};

const buildAegisMarketSnapshot=({market,monthly,macroData})=>{
  if(!monthly?.length)return null;
  const maData=calcMA60(monthly);
  const rsiData=calcRSI(monthly);
  const macdData=calcMACD(monthly);
  const obvData=calcOBV(monthly);
  const mfiData=calcMFI(monthly);
  const bandData=calcPositionBands(maData);
  const lastPrice=monthly.slice(-1)[0]?.price??null;
  const lastValid=bandData.filter(d=>d.bBase!=null).slice(-1)[0];
  const lastGap=lastValid?.gap60??null;
  const lastRSI=rsiData.slice(-1)[0]?.rsi??null;
  const lastMACD=macdData.slice(-1)[0]??null;
  const prevMACD=macdData.slice(-2,-1)[0]??null;
  const lastOBV=obvData.slice(-1)[0]?.obv??null;
  const prevOBV=obvData.slice(-2,-1)[0]?.obv??null;
  const lastMFI=mfiData.slice(-1)[0]?.mfi??null;
  const sefScore=macroData?.defconData?.totalScore??50;

  const sRSIbase=lastRSI==null?0:lastRSI<20?2:lastRSI<30?1:lastRSI>85?-2.5:lastRSI>78?-1.5:lastRSI>70?-1:lastRSI>60?-0.5:lastRSI<40?0.5:0;
  const sMACD=lastMACD==null?0:(lastMACD.macd??0)>(lastMACD.signal??0)?1:-1;
  const sOBV=lastOBV==null||prevOBV==null?0:lastOBV>prevOBV?0.5:-0.5;
  const sMFI=lastMFI==null?0:lastMFI<10?2:lastMFI<20?1:lastMFI>90?-2:lastMFI>80?-1:lastMFI>65?-0.5:lastMFI<35?0.5:0;
  const sGap=lastGap==null?0:lastGap>300?-2.5:lastGap>150?-2:lastGap>80?-1.5:lastGap>40?-1:lastGap>20?-0.5:lastGap<-50?2:lastGap<-30?1.5:lastGap<-15?1:lastGap<-5?0.5:0;
  const sZone=lastGap==null?0:lastGap<-30?1.5:lastGap<-15?0.8:lastGap>200?-1.5:lastGap>100?-1.5:lastGap>50?-1:0;

  const iRsiArr=rsiData.slice(-3), iMaArr=maData.slice(-3);
  let sIDivergence=0;
  if(iRsiArr.length===3&&iMaArr.length===3){
    const pH=iMaArr[2]?.price??null, pPH=iMaArr[0]?.price??null;
    const rH=iRsiArr[2]?.rsi??null, rPH=iRsiArr[0]?.rsi??null;
    if(pH!=null&&pPH!=null&&rH!=null&&rPH!=null){
      if(pH>pPH&&rH<rPH)sIDivergence=-2;
      else if(pH<pPH&&rH>rPH)sIDivergence=2;
    }
  }
  const iLastHist=(lastMACD?.macd??0)-(lastMACD?.signal??0);
  const iPrevHist=(prevMACD?.macd??0)-(prevMACD?.signal??0);
  let sIHistSlope=0;
  if(lastMACD&&prevMACD){
    if(iLastHist>0&&iLastHist<iPrevHist)sIHistSlope=-0.5;
    else if(iLastHist<0&&iLastHist>iPrevHist)sIHistSlope=0.5;
  }
  const sICross=(lastGap!=null&&lastGap<-15&&iLastHist>0)?1.5:(lastGap!=null&&lastGap>50&&iLastHist<0)?-1.5:0;
  const iBullSignals=[sRSIbase>0,sMACD>0,sOBV>0,sMFI>0,sGap>0,sZone>0].filter(Boolean).length;
  const iBearSignals=[sRSIbase<0,sMACD<0,sOBV<0,sMFI<0,sGap<0,sZone<0].filter(Boolean).length;
  const sIConfirm=iBullSignals>=4?1:iBullSignals===3?0.5:iBearSignals>=4?-1:iBearSignals===3?-0.5:0;
  const techTotal=sRSIbase+sMACD+sOBV+sMFI+sGap+sZone+sIDivergence+sIHistSlope+sICross+sIConfirm;
  const upProb=sqClamp(Math.round(50+techTotal*7),5,95);
  const downProb=100-upProb;

  const bandLevel=lastGap==null?"QMA":lastGap>=150?"EH":lastGap>=100?"VH":lastGap>=50?"H":lastGap<=-40?"VL":lastGap<=-20?"L":"QMA";
  const macdWeak=lastMACD&&prevMACD?iLastHist<iPrevHist:false;
  const macdStrong=lastMACD&&prevMACD?iLastHist>iPrevHist:false;
  const obvWeak=lastOBV!=null&&prevOBV!=null?lastOBV<prevOBV:false;
  const obvStrong=lastOBV!=null&&prevOBV!=null?lastOBV>prevOBV:false;
  const macroRisk=sefScore<35?"위험":sefScore<50?"경계":sefScore<70?"중립":"양호";
  const outlook=upProb>=80?"강한 상승":upProb>=70?"상승 우세":upProb>=60?"소폭 상승":upProb>=55?"약한 상승":upProb>=46?"중립":upProb>=41?"약한 하락":upProb>=36?"소폭 하락 우세":upProb>=21?"하락 우세":"강한 하락";

  const scenario=(()=>{
    const overheat=(bandLevel==="EH"||bandLevel==="VH"||lastGap>=100);
    const extreme=(bandLevel==="EH"||lastGap>=150||(lastRSI??0)>=85);
    const bottom=(bandLevel==="VL"||bandLevel==="L"||lastGap<=-20);
    const deepBottom=(bandLevel==="VL"||lastGap<=-40);
    const macroBad=sefScore<50;
    const macroGood=sefScore>=70;
    const momentumWeak=macdWeak||obvWeak||sIHistSlope<0||sMACD<0;
    const momentumStrong=macdStrong||obvStrong||sIHistSlope>0||sMACD>0;
    if(extreme&&momentumWeak&&macroBad)return{base:"1~3개월 내 변동성 확대 경계",alt:"유동성 지속 시 EH 과열 연장 가능",note:`${bandLevel} 과열 · RSI ${lastRSI!=null?lastRSI.toFixed(0):"-"} · SEFCON ${sefScore}pt`};
    if(overheat&&momentumWeak)return{base:"3~6개월 내 과열 해소 우세",alt:macroGood?"거시 양호 시 EH 확장 가능":"반등 실패 시 조정 가속 가능",note:`${bandLevel}권 · 이격 ${lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"-"} · 모멘텀 둔화`};
    if(overheat)return{base:"과열 유지 중, 단기 변동성 경계",alt:"추세 지속 시 추가 상승 후 후행 조정",note:`${bandLevel}권 · RSI ${lastRSI!=null?lastRSI.toFixed(0):"-"} · 수급 확인 필요`};
    if(deepBottom&&momentumStrong)return{base:"1~3개월 내 평균회귀 반등 우세",alt:"경기충격 지속 시 저평가 장기화",note:`${bandLevel} 저평가 · MACD/수급 개선 확인`};
    if(bottom)return{base:"1~6개월 내 반등 시도 가능",alt:"거시 악화 시 바닥권 횡보 지속",note:`${bandLevel}권 · 이격 ${lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"-"}`};
    if(upProb>=60&&momentumStrong)return{base:"1~3개월 상승 흐름 유지 가능",alt:"과열권 접근 시 속도 조절 필요",note:`QMA 상단 · 모멘텀 개선 · SEFCON ${sefScore}pt`};
    if(downProb>=60&&momentumWeak)return{base:"1~3개월 약세 압력 우세",alt:"QMA 방어 시 중립 복귀 가능",note:"QMA 부근 · 모멘텀 둔화 · 수급 확인 필요"};
    return{base:"방향성 확인 구간",alt:"상방·하방 모두 열려 있음",note:`QMA 중립권 · SEFCON ${sefScore}pt · 추가 신호 대기`};
  })();

  const bubbleEnergy=buildBubbleEnergyModel({market,monthly,lastGap,lastRSI,lastMFI,bandLevel,sefScore,macdWeak,obvWeak,techTotal});

  const now=new Date();
  const month=sqMonthKey(now);
  const signal=downProb>=75?"위험회피/현금확대":downProb>=60?"비중축소/신규매수주의":upProb>=75?"공격적 분할매수":upProb>=60?"분할매수/회복관찰":"중립관망";
  const snapshotKey=`AEGIS_MARKET_V3_${month}_${market}`;
  const raw={
    version:"AEGIS_MARKET_V3.1",
    createdAt:now.toISOString(),
    month,market,
    price:sqNum(lastPrice,2),
    bandLevel,gapQma:sqNum(lastGap,2),
    rsi:sqNum(lastRSI,1),mfi:sqNum(lastMFI,1),
    macd:sqNum(lastMACD?.macd,3),macdSignal:sqNum(lastMACD?.signal,3),macdHist:sqNum(iLastHist,3),
    obv:lastOBV??null,
    sefconScore:sefScore,macroRisk,
    scores:{rsi:sRSIbase,macd:sMACD,obv:sOBV,mfi:sMFI,gap:sGap,zone:sZone,divergence:sIDivergence,histSlope:sIHistSlope,cross:sICross,confirm:sIConfirm,total:techTotal},
    probabilities:{up:upProb,down:downProb},
    outlook,signal,
    scenario,
    bubbleEnergy,
    validation:{status:"pending",return1m:null,return3m:null,return6m:null,maxDrawdown6m:null,baseHit:null,altHit:null,checkedAt:null}
  };
  return{
    snapshot_key:snapshotKey,
    engine:"AEGIS_MARKET_V3",
    target_market:market,
    snapshot_month:month,
    index_price:raw.price,
    regime:bandLevel,
    signal,
    base_scenario:scenario.base,
    alt_scenario:scenario.alt,
    up_probability:upProb,
    down_probability:downProb,
    sefcon_score:sefScore,
    // Bubble Energy: Supabase Table Editor에서 바로 보이도록 핵심값을 별도 컬럼에도 저장
    bubble_energy_score:bubbleEnergy?.score??null,
    bubble_energy_level:bubbleEnergy?.level??null,
    bubble_energy_level_ko:bubbleEnergy?.levelKo??null,
    bubble_expected_drawdown:bubbleEnergy?.expectedDrawdown?.text??null,
    bubble_expected_duration:bubbleEnergy?.expectedDuration?.text??null,
    bubble_ret12:bubbleEnergy?.ret12??null,
    bubble_ret24:bubbleEnergy?.ret24??null,
    bubble_similar_cases:bubbleEnergy?.similarCases??[],
    raw_data:raw,
    updated_at:now.toISOString(),
  };
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
      <span style={{color:p.color||C.text,fontFamily:"monospace",fontWeight:700}}>{typeof p.value==="number"?(Number.isInteger(p.value)?p.value.toLocaleString():p.value.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})):p.value}</span>
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
// OutsiderTab — 아웃사이더 CEO 경영방식 적합도 (현금의 재발견)
// ══════════════════════════════════════════════════════════════
function OutsiderTab({annData,hasFinData,price}){
  if(!hasFinData||!annData?.length){
    return(
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"24px",textAlign:"center"}}>
        <div style={{fontSize:28,marginBottom:10}}>📖</div>
        <div style={{color:C.gold,fontSize:13,fontWeight:700,marginBottom:6}}>아웃사이더 CEO 적합도 분석</div>
        <div style={{color:C.muted,fontSize:11}}>재무제표를 업로드하면 분석을 시작합니다.</div>
      </div>
    );
  }

  const rows=annData.filter(r=>r.year).slice(-5);
  const n=rows.length;
  const avg=(arr)=>arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:null;
  const lastRow=rows[rows.length-1];

  // ── 1. 현금배분 철학 (35점)
  // A. FCF 마진 — 오너이익 마인드
  const fcfMarginArr=rows.filter(r=>r.fcf!=null&&r.rev!=null&&r.rev>0).map(r=>r.fcf/r.rev*100);
  const avgFcfMargin=fcfMarginArr.length?avg(fcfMarginArr):null;
  let fcfMarginScore=0;
  if(avgFcfMargin!=null){
    if(avgFcfMargin>=20)fcfMarginScore=15;
    else if(avgFcfMargin>=12)fcfMarginScore=11;
    else if(avgFcfMargin>=7)fcfMarginScore=7;
    else if(avgFcfMargin>=3)fcfMarginScore=3;
  }

  // B. 자사주 매입 / 배당 보다 자본배분 우선 (재무CF에서 추정)
  // cff<0 = 자본환원(자사주+배당 지급) 우세 → 아웃사이더 선호
  const cffArr=rows.filter(r=>r.cff!=null).map(r=>r.cff);
  const avgCff=cffArr.length?avg(cffArr):null;
  let buybackScore=0;
  if(avgCff!=null){
    if(avgCff<0){
      const ratio=Math.abs(avgCff)/(Math.abs(avg(rows.filter(r=>r.rev>0).map(r=>r.rev)))||1)*100;
      if(ratio>=5)buybackScore=12;
      else if(ratio>=2)buybackScore=8;
      else buybackScore=5;
    } else {
      buybackScore=1;
    }
  }

  // C. FCF/순이익 전환율
  const fcfConvArr=rows.filter(r=>r.fcf!=null&&r.net!=null&&r.net>0).map(r=>r.fcf/r.net*100);
  const avgFcfConv=fcfConvArr.length?avg(fcfConvArr):null;
  let fcfConvScore=0;
  if(avgFcfConv!=null){
    if(avgFcfConv>=100)fcfConvScore=8;
    else if(avgFcfConv>=80)fcfConvScore=6;
    else if(avgFcfConv>=50)fcfConvScore=3;
    else fcfConvScore=1;
  } else if(rows.filter(r=>r.fcf!=null&&r.fcf>0).length===rows.length){
    fcfConvScore=4;
  }
  const cashDistScore=fcfMarginScore+buybackScore+fcfConvScore;

  // ── 2. 자본효율성 극대화 (30점)
  // A. ROE (자기자본 복리)
  const roeArr=rows.filter(r=>r.roe!=null).map(r=>r.roe);
  const avgROE=roeArr.length?avg(roeArr):null;
  let roeScore=0;
  if(avgROE!=null){
    if(avgROE>=25)roeScore=15;
    else if(avgROE>=20)roeScore=12;
    else if(avgROE>=15)roeScore=8;
    else if(avgROE>=10)roeScore=4;
  }

  // B. 낮은 CAPEX 집약도 (경량 자산 모델 선호)
  const capexRevArr=rows.filter(r=>r.capex!=null&&r.rev!=null&&r.rev>0).map(r=>Math.abs(r.capex)/r.rev*100);
  const avgCapexRev=capexRevArr.length?avg(capexRevArr):null;
  let capexLightScore=0;
  if(avgCapexRev!=null){
    if(avgCapexRev<3)capexLightScore=15;
    else if(avgCapexRev<6)capexLightScore=11;
    else if(avgCapexRev<10)capexLightScore=7;
    else if(avgCapexRev<20)capexLightScore=3;
    else capexLightScore=1;
  }
  const capitalEffScore=roeScore+capexLightScore;

  // ── 3. 보수적 레버리지 (20점)
  const debtRatio=lastRow?.debt??null;
  const debtTrendArr=rows.filter(r=>r.debt!=null).map(r=>r.debt);
  const debtTrend=debtTrendArr.length>=2?debtTrendArr[debtTrendArr.length-1]-debtTrendArr[0]:null;
  let leverageScore=0;
  if(debtRatio!=null){
    if(debtRatio<50)leverageScore=12;
    else if(debtRatio<100)leverageScore=9;
    else if(debtRatio<150)leverageScore=5;
    else if(debtRatio<200)leverageScore=2;
  }
  // 부채 축소 추세 보너스
  let debtTrendScore=0;
  if(debtTrend!=null){
    if(debtTrend<-20)debtTrendScore=8;
    else if(debtTrend<0)debtTrendScore=5;
    else if(debtTrend<10)debtTrendScore=2;
  } else if(debtRatio!=null&&debtRatio<80){
    debtTrendScore=3;
  }
  const leverTotalScore=leverageScore+debtTrendScore;

  // ── 4. 오너십 마인드 (15점) — 수익성 집중 + 일관성
  // 영업이익률 지속성 (손다이크 CEO들은 수익성 희생하지 않음)
  const opmArr=rows.filter(r=>r.opm!=null).map(r=>r.opm);
  const avgOPM=opmArr.length?avg(opmArr):null;
  const opmMin=opmArr.length?Math.min(...opmArr):null;
  let ownershipScore=0;
  if(avgOPM!=null){
    if(avgOPM>=20&&opmMin>=10)ownershipScore=15;
    else if(avgOPM>=15&&opmMin>=7)ownershipScore=11;
    else if(avgOPM>=10&&opmMin>=5)ownershipScore=7;
    else if(avgOPM>=5)ownershipScore=4;
    else ownershipScore=1;
  }

  const total=cashDistScore+capitalEffScore+leverTotalScore+ownershipScore;

  // ── 등급
  let grade,gradeColor,gradeIcon,gradeDesc;
  if(total>=85){grade="아웃사이더 A+";gradeColor=C.green;gradeIcon="🏆";gradeDesc="손다이크 8인의 경영철학과 고도로 일치. 자본배분 천재형 기업.";}
  else if(total>=70){grade="아웃사이더 A";gradeColor=C.teal;gradeIcon="🌟";gradeDesc="현금 중심 경영이 뚜렷. 장기 복리 투자 적합 기업.";}
  else if(total>=55){grade="아웃사이더 B";gradeColor=C.gold;gradeIcon="✅";gradeDesc="부분적으로 아웃사이더 특성 보유. 세부 항목 점검 필요.";}
  else if(total>=35){grade="아웃사이더 C";gradeColor=C.orange;gradeIcon="⚠️";gradeDesc="일부 지표 부합. 성장형 또는 전통 경영 방식에 가까움.";}
  else{grade="비해당";gradeColor=C.red;gradeIcon="❌";gradeDesc="아웃사이더 기준과 거리 있음. 자본배분 철학 재확인 필요.";}

  const sections=[
    {
      title:"현금배분 철학",full:35,score:cashDistScore,
      desc:"이익보다 FCF, 배당보다 자사주·재투자 — 손다이크 CEO의 핵심 DNA",
      items:[
        {label:"FCF 마진",score:fcfMarginScore,max:15,
         val:avgFcfMargin!=null?`${avgFcfMargin.toFixed(1)}%`:"—",
         bench:"12% 이상",
         detail:avgFcfMargin!=null?(avgFcfMargin>=20?"탁월":avgFcfMargin>=12?"우수":avgFcfMargin>=7?"양호":avgFcfMargin>=3?"미흡":"미달"):"데이터 없음"},
        {label:"자본환원 성향 (재무CF)",score:buybackScore,max:12,
         val:avgCff!=null?`${avgCff<0?"환원":"확장"} (평균 ${avgCff!=null?Math.round(avgCff).toLocaleString()+"억":"—"})`:"—",
         bench:"재무CF 음수 (자사주·부채상환 우세)",
         detail:avgCff!=null?(avgCff<0?"자본환원 우세":"외부조달/배당 확장 성향"):"데이터 없음"},
        {label:"FCF/순이익 전환율",score:fcfConvScore,max:8,
         val:avgFcfConv!=null?`${avgFcfConv.toFixed(0)}%`:"—",
         bench:"80% 이상",
         detail:avgFcfConv!=null?(avgFcfConv>=100?"탁월":avgFcfConv>=80?"우수":avgFcfConv>=50?"양호":"미흡"):"데이터 없음"},
      ]
    },
    {
      title:"자본효율성 극대화",full:30,score:capitalEffScore,
      desc:"적은 자산으로 높은 이익 — 경량 비즈니스 모델을 선호",
      items:[
        {label:"ROE (자기자본 복리)",score:roeScore,max:15,
         val:avgROE!=null?`${avgROE.toFixed(1)}%`:"—",
         bench:"20% 이상",
         detail:avgROE!=null?(avgROE>=25?"탁월":avgROE>=20?"우수":avgROE>=15?"양호":avgROE>=10?"미흡":"미달"):"데이터 없음"},
        {label:"CAPEX 집약도 (매출 대비)",score:capexLightScore,max:15,
         val:avgCapexRev!=null?`${avgCapexRev.toFixed(1)}%`:"—",
         bench:"매출의 6% 이하",
         detail:avgCapexRev!=null?(avgCapexRev<3?"초경량 모델":avgCapexRev<6?"경량":avgCapexRev<10?"보통":avgCapexRev<20?"자산 집약":"중공업형"):"데이터 없음"},
      ]
    },
    {
      title:"보수적 레버리지",full:20,score:leverTotalScore,
      desc:"부채는 도구이지 습관이 아니다 — 재무 유연성 최우선",
      items:[
        {label:"현재 부채비율",score:leverageScore,max:12,
         val:debtRatio!=null?`${debtRatio}%`:"—",
         bench:"100% 이하",
         detail:debtRatio!=null?(debtRatio<50?"매우 보수적":debtRatio<100?"안전":debtRatio<150?"보통":debtRatio<200?"주의":"위험"):"데이터 없음"},
        {label:"부채 추세",score:debtTrendScore,max:8,
         val:debtTrend!=null?`${debtTrend>0?"+":""}${Math.round(debtTrend)}%p (${n}년간)`:"—",
         bench:"감소 또는 유지",
         detail:debtTrend!=null?(debtTrend<-20?"적극 축소":debtTrend<0?"감소":debtTrend<10?"유지":"증가 주의"):"데이터 부족"},
      ]
    },
    {
      title:"오너십 마인드 (수익성 집중)",full:15,score:ownershipScore,
      desc:"단기 성과보다 장기 수익성 — 경기 관계없이 일관된 영업이익률",
      items:[
        {label:"영업이익률 수준·일관성",score:ownershipScore,max:15,
         val:avgOPM!=null?`평균 ${avgOPM.toFixed(1)}% / 최저 ${opmMin!=null?opmMin.toFixed(1):"-"}%`:"—",
         bench:"평균 15% 이상 & 최저 7% 이상",
         detail:avgOPM!=null?(avgOPM>=20&&opmMin>=10?"탁월·일관":avgOPM>=15?"우수":avgOPM>=10?"양호":"개선 필요"):"데이터 없음"},
      ]
    },
  ];

  const arcLen=251.2;
  const dashOffset=arcLen*(1-total/100);

  return(
    <div style={{animation:"fadeIn 0.3s ease"}}>

      {/* ── 책 소개 + 방법론 범례 */}
      <div style={{
        background:`${C.gold}0A`,border:`1px solid ${C.gold}33`,
        borderRadius:12,padding:"14px 16px",marginBottom:12,
      }}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
          <div style={{fontSize:24,flexShrink:0}}>📖</div>
          <div>
            <div style={{fontSize:11,fontWeight:900,color:C.gold,letterSpacing:"0.04em",marginBottom:2}}>
              현금의 재발견 — 윌리엄 N. 손다이크 Jr. (The Outsiders, 2012)
            </div>
            <div style={{fontSize:9,color:C.muted,lineHeight:1.75}}>
              S&P500 대비 <span style={{color:C.teal,fontWeight:700}}>20배 이상의 초과수익</span>을 달성한 8인의 CEO를 분석한 저서.
              이들의 공통점은 화려한 비전 발표나 M&A가 아닌, <span style={{color:C.orange,fontWeight:700}}>조용한 자본배분 능력</span>이었습니다.
            </div>
          </div>
        </div>

        {/* 등급 척도 설명 */}
        <div style={{fontSize:9,color:C.gold,fontWeight:700,marginBottom:6,letterSpacing:"0.06em"}}>
          🏅 적합도 등급 척도 (100점 만점)
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
          {[
            {grade:"A+",score:"85~100",color:C.green, icon:"🏆",desc:"손다이크 8인과 고도로 일치. 자본배분 천재형 — 장기 핵심 보유 적합"},
            {grade:"A", score:"70~84", color:C.teal,  icon:"🌟",desc:"현금 중심 경영 뚜렷. 장기 복리 투자에 적합한 우수 기업"},
            {grade:"B", score:"55~69", color:C.gold,  icon:"✅",desc:"부분적 아웃사이더 특성. 세부 항목 점검 후 투자 고려"},
            {grade:"C", score:"35~54", color:C.orange,icon:"⚠️",desc:"일부 지표만 부합. 성장형·전통 경영 방식 혼재"},
            {grade:"비해당",score:"~34",color:C.red,  icon:"❌",desc:"아웃사이더 기준과 거리 있음. 자본배분 철학 재확인 필요"},
          ].map(({grade,score,color,icon,desc})=>(
            <div key={grade} style={{
              background:C.card2,borderRadius:7,padding:"6px 9px",
              border:`1px solid ${color}44`,flex:"1 1 calc(50% - 4px)",minWidth:140,
            }}>
              <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
                <span style={{fontSize:11}}>{icon}</span>
                <span style={{color:color,fontWeight:900,fontSize:10,fontFamily:"monospace"}}>{grade}</span>
                <span style={{color:`${C.muted}88`,fontSize:8,marginLeft:2}}>({score}점)</span>
              </div>
              <div style={{color:C.muted,fontSize:8,lineHeight:1.5}}>{desc}</div>
            </div>
          ))}
        </div>

        {/* 8인 소개 */}
        <div style={{fontSize:9,color:C.gold,fontWeight:700,marginBottom:6,letterSpacing:"0.06em"}}>
          📋 손다이크가 선정한 아웃사이더 CEO 8인
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:10}}>
          {[
            {ceo:"워런 버핏",company:"버크셔 해서웨이",ret:"S&P 대비 ×135",color:C.gold},
            {ceo:"헨리 싱글턴",company:"텔레다인",ret:"S&P 대비 ×12",color:C.teal},
            {ceo:"존 맬론",company:"TCI/리버티 미디어",ret:"S&P 대비 ×40 (절대 ×900)",color:C.purple},
            {ceo:"톰 머피",company:"캐피털 시티즈/ABC",ret:"S&P 대비 ×16.7",color:C.blue},
            {ceo:"딕 스미스",company:"제너럴 시네마",ret:"S&P 대비 ×15.8",color:C.orange},
            {ceo:"캐서린 그레이엄",company:"워싱턴 포스트",ret:"S&P 대비 ×18",color:C.cyan},
            {ceo:"빌 스털링",company:"랠스턴 퓨리나",ret:"S&P 대비 ×2.5",color:C.green},
            {ceo:"빌 앤더스",company:"제너럴 다이나믹스",ret:"S&P 대비 ×6.7",color:C.pink},
          ].map(({ceo,company,ret,color})=>(
            <div key={ceo} style={{
              background:C.card2,borderRadius:6,padding:"5px 8px",
              border:`1px solid ${color}33`,
            }}>
              <div style={{fontSize:9,fontWeight:700,color:color}}>{ceo}</div>
              <div style={{fontSize:8,color:C.muted}}>{company}</div>
              <div style={{fontSize:8,color:C.teal,fontFamily:"monospace"}}>{ret}</div>
            </div>
          ))}
        </div>

        {/* 핵심 원칙 */}
        <div style={{fontSize:9,color:C.gold,fontWeight:700,marginBottom:5,letterSpacing:"0.06em"}}>
          🎯 아웃사이더 CEO 5대 공통 원칙
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          {[
            {no:"①",title:"현금흐름 중심 사고",desc:"EPS보다 FCF. 장부 이익이 아닌 실제 현금을 기준으로 기업을 평가"},
            {no:"②",title:"자본배분이 최우선 임무",desc:"경영자의 가장 중요한 역할은 자본을 어디에 배치할지 결정하는 것"},
            {no:"③",title:"자사주 매입의 적극 활용",desc:"주가가 내재가치 대비 저평가될 때 자사주 매입이 최고의 투자"},
            {no:"④",title:"보수적 레버리지",desc:"부채는 전략적 도구. 과도한 레버리지로 재무 유연성을 훼손하지 않음"},
            {no:"⑤",title:"분권화 + 비용 절감",desc:"본사는 작게, 현장에 권한 위임. 군살 없는 조직 = 높은 FCF 마진"},
          ].map(({no,title,desc})=>(
            <div key={no} style={{display:"flex",gap:6,alignItems:"flex-start"}}>
              <span style={{color:C.teal,fontWeight:900,fontSize:9,flexShrink:0,marginTop:1}}>{no}</span>
              <div>
                <span style={{color:C.text,fontWeight:700,fontSize:9}}>{title}: </span>
                <span style={{color:C.muted,fontSize:9}}>{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 총점 헤더 카드 */}
      <div style={{
        background:C.card,border:`2px solid ${gradeColor}55`,
        borderRadius:14,padding:"18px 16px",marginBottom:12,
        boxShadow:`0 0 32px ${gradeColor}12`,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{position:"relative",width:90,height:90,flexShrink:0}}>
            <svg width="90" height="90" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="40" fill="none" stroke={C.dim} strokeWidth="8"/>
              <circle cx="45" cy="45" r="40" fill="none"
                stroke={gradeColor} strokeWidth="8"
                strokeDasharray={arcLen}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform="rotate(-90 45 45)"
                style={{transition:"stroke-dashoffset 0.8s ease"}}
              />
            </svg>
            <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
              <div style={{fontSize:20,fontWeight:900,fontFamily:"monospace",color:gradeColor,lineHeight:1}}>{total}</div>
              <div style={{fontSize:8,color:C.muted}}>/ 100</div>
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:9,color:C.muted,marginBottom:4,letterSpacing:"0.06em"}}>
              📖 아웃사이더 CEO 적합도 · {n}년 평균 기준
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{fontSize:20}}>{gradeIcon}</span>
              <span style={{fontSize:15,fontWeight:900,color:gradeColor,fontFamily:"monospace"}}>{grade}</span>
            </div>
            <div style={{fontSize:10,color:C.muted,lineHeight:1.6}}>{gradeDesc}</div>
            <div style={{
              fontSize:8,color:C.muted,marginTop:6,
              background:C.card2,borderRadius:6,padding:"4px 8px",
              border:`1px solid ${C.border}`,display:"inline-block",
            }}>
              현금배분35 + 자본효율30 + 레버리지20 + 오너십15
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

      {/* ── 한계 및 유의사항 */}
      <div style={{
        background:`${C.blue}08`,border:`1px solid ${C.blue}30`,
        borderRadius:10,padding:"12px 14px",
      }}>
        <div style={{fontSize:9,color:C.blue,fontWeight:700,marginBottom:5,letterSpacing:"0.06em"}}>
          ⚠️ 분석 유의사항
        </div>
        <div style={{fontSize:9,color:C.muted,lineHeight:1.75}}>
          • 본 분석은 DART 공시 재무데이터 기반 <span style={{color:C.text,fontWeight:600}}>정량 근사치</span>입니다. 실제 아웃사이더 여부는 경영진 지분율·M&A 전략·분권화 구조 등 정성 요소 포함 필요.<br/>
          • <span style={{color:C.text,fontWeight:600}}>자본환원 항목</span>은 재무CF 전체로 근사하므로, 차입금 상환과 자사주 매입을 합산한 수치입니다.<br/>
          • 한국 기업의 경우 지배구조·오너 일가 특성상 서구 아웃사이더 기준과 문화적 차이가 있을 수 있습니다.
        </div>
        <div style={{fontSize:8,color:`${C.muted}88`,textAlign:"right",marginTop:6}}>
          — 참고: William N. Thorndike Jr., <i>The Outsiders</i> (2012) / 국내판: 현금의 재발견
        </div>
      </div>
    </div>
  );
}

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
  const [darkMode,setDarkMode]=useState(false);
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
  const [stockList,setStockList]=useState([]);
  const fileRef=useRef();
  const searchRef=useRef();
  const RANGES=[{label:"10년",months:120},{label:"5년",months:60},{label:"3년",months:36},{label:"1년",months:12}];

  // ── 시장탭: 거시경제 + 코스피/코스닥 지수 데이터
  const [macroData,setMacroData]=useState(null);
  const [kospiMonthly,setKospiMonthly]=useState([]);
  const [kosdaqMonthly,setKosdaqMonthly]=useState([]);
  const [marketLoading,setMarketLoading]=useState(false);
  const [marketLoaded,setMarketLoaded]=useState(false);
  const [marketSub,setMarketSub]=useState("defcon"); // defcon | macro | kospi | kosdaq

  useEffect(()=>{
    if(tab!=="market"||marketLoaded)return;
    setMarketLoading(true);
    // localStorage 캐시 우선 (24시간 TTL)
    const MACRO_CACHE_TTL=6*60*60*1000;
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

  // AEGIS 시장 스냅샷: KOSPI/KOSDAQ 월 1회 자동 Supabase upsert
  // snapshot_key = AEGIS_MARKET_V3_YYYY-MM_KOSPI / KOSDAQ
  // 주의: 로컬 전송 캐시는 앱 저장 스키마 버전까지 포함한다.
  //      그래서 Bubble Energy 같은 신규 필드가 추가되면 같은 달이라도 1회 재전송되어 DB가 보강된다.
  useEffect(()=>{
    if(!marketLoaded||!macroData)return;
    const SNAPSHOT_STORAGE_SCHEMA="BE_COLUMNS_V1";
    const items=[
      buildAegisMarketSnapshot({market:"KOSPI",monthly:kospiMonthly,macroData}),
      buildAegisMarketSnapshot({market:"KOSDAQ",monthly:kosdaqMonthly,macroData}),
    ].filter(Boolean);
    if(!items.length)return;

    items.forEach(async(snapshot)=>{
      const localKey=`sq_snapshot_sent_${SNAPSHOT_STORAGE_SCHEMA}_${snapshot.snapshot_key}`;
      try{
        // 같은 브라우저에서는 월+스키마버전 기준 1회만 전송. 다른 기기에서는 같은 snapshot_key로 upsert되어 중복 저장 방지.
        if(localStorage.getItem(localKey))return;
        await sbUpsertPredictionSnapshot(snapshot);
        localStorage.setItem(localKey,new Date().toISOString());
        console.info("[AEGIS snapshot saved]",snapshot.snapshot_key,snapshot.bubble_energy_score);
      }catch(e){
        console.warn("[AEGIS snapshot save failed]",snapshot.snapshot_key,e?.message||e);
      }
    });
  },[marketLoaded,macroData,kospiMonthly,kosdaqMonthly]);

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
    {id:"moat",label:"🛡 경제적 해자"},{id:"outsider",label:"📖 아웃사이더"},
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
          <span style={{color:C.gold,fontSize:13,fontWeight:900,fontFamily:"monospace",letterSpacing:"0.12em"}}>SEQUOIA QUANTUM AEGIS</span>
          <span style={{color:C.muted,fontSize:9,fontFamily:"monospace",letterSpacing:"0.18em"}}>system</span>
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

        {/* ════ 아웃사이더 CEO 적합도 ════ */}
        {tab==="outsider"&&(
          <OutsiderTab annData={co?.annData||[]} hasFinData={hasFinData} price={price}/>
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
                  <div style={{background:`${C.green}0d`,border:`1px solid ${C.green}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      기업의 <span style={{color:C.blue,fontWeight:700}}>외형(매출)</span>과 <span style={{color:C.green,fontWeight:700}}>수익성(영업이익)</span>, <span style={{color:C.purple,fontWeight:700}}>최종 성과(순이익)</span>을 한눈에 비교합니다.
                      매출은 늘지만 영업이익이 감소하면 원가 부담 증가 신호. 영업이익은 있는데 순이익이 적으면 이자비용·세금 부담 확인이 필요합니다.
                    </div>
                  </div>
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
                  <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      <span style={{color:C.gold,fontWeight:700}}>OPM(영업이익률)</span>은 본업 수익성, <span style={{color:C.purple,fontWeight:700}}>NPM(순이익률)</span>은 최종 수익성입니다.
                      우축 꺾은선은 전년 대비 성장률(YoY)로, 막대가 낮아도 꺾은선이 상승하면 개선 추세를 의미합니다.
                      OPM 10% 이상이면 양호, 15% 이상이면 경쟁 우위 신호로 봅니다.
                    </div>
                  </div>
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
                  <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      <span style={{color:C.purple,fontWeight:700}}>ROE(자기자본이익률)</span>: 주주 자본 대비 순이익. 버핏 기준 <span style={{color:C.purple,fontWeight:700}}>15% 이상</span>이 우량 기업.
                      <span style={{color:C.blueL,fontWeight:700}}> ROA(총자산이익률)</span>: 자산 전체 대비 효율성. ROE는 높은데 ROA가 낮으면 레버리지(부채) 의존도가 높다는 신호입니다.
                      보조선(15%)과 비교해 추세가 우상향 중인지 확인하세요.
                    </div>
                  </div>
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
                  <div style={{background:`${C.cyan}0d`,border:`1px solid ${C.cyan}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      <span style={{color:C.blueL,fontWeight:700}}>FCF(잉여현금흐름)</span>: 영업CF − 유지CAPEX. 주주에게 실제로 돌아갈 수 있는 현금.
                      <span style={{color:C.pink,fontWeight:700}}> 영업CF</span>가 꾸준히 플러스여야 건강한 사업. <span style={{color:C.gold,fontWeight:700}}>투자CF</span>가 크게 마이너스면 적극 투자 중(성장 or 과잉투자),
                      <span style={{color:C.green,fontWeight:700}}> 재무CF</span> 마이너스는 부채 상환·자사주 매입 등 주주환원 신호입니다.
                    </div>
                  </div>
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
                      <div style={{background:`${C.purple}0d`,border:`1px solid ${C.purple}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                        <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                          <span style={{color:"#F97316",fontWeight:700}}>EPS(주당순이익)</span>가 장기적으로 <span style={{color:"#38BDF8",fontWeight:700}}>주가</span>를 이끄는지 확인합니다.
                          EPS가 우상향하는데 주가가 뒤처지면 <span style={{color:C.green,fontWeight:700}}>저평가</span> 가능성,
                          주가가 EPS를 크게 앞서면 <span style={{color:C.red,fontWeight:700}}>밸류에이션 부담</span> 신호입니다.
                          두 선이 함께 우상향하는 기업이 장기 투자에 가장 이상적입니다.
                        </div>
                      </div>
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

            {/* ── 월봉 기술적 종합 전망 카드 */}
            {(()=>{
              const lastRSI=withRSI.slice(-1)[0]?.rsi??null;
              const lastMACD=withMACD.slice(-1)[0];
              const prevMACD=withMACD.slice(-2,-1)[0];
              const lastOBV=withOBV.slice(-1)[0]?.obv??null;
              const prevOBV=withOBV.slice(-2,-1)[0]?.obv??null;
              const lastMFI=withMFI.slice(-1)[0]?.mfi??null;
              const {priceZone,gap}=readingEngine;
              // ── 기본 지표 점수
              const gapScore=gap==null?0:gap>300?-2.5:gap>150?-2:gap>80?-1.5:gap>40?-1:gap>20?-0.5:gap<-50?2:gap<-30?1.5:gap<-15?1:gap<-5?0.5:0;
              const zoneScore=(priceZone==="VL"||priceZone==="L"||gap<-30)?1.5:gap<-15?0.8:priceZone==="EH"||gap>200?-1.5:priceZone==="VH"||gap>80?-1:0;
              const sRSIbase=lastRSI==null?0:lastRSI<20?2:lastRSI<30?1:lastRSI>85?-2.5:lastRSI>78?-1.5:lastRSI>70?-1:lastRSI>60?-0.5:lastRSI<40?0.5:0;
              const sMACD=lastMACD==null?0:(lastMACD.macd??0)>(lastMACD.signal??0)?1:-1;
              const sOBV=lastOBV==null||prevOBV==null?0:lastOBV>prevOBV?0.5:-0.5;
              const sMFI=lastMFI==null?0:lastMFI<10?2:lastMFI<20?1:lastMFI>90?-2:lastMFI>80?-1:lastMFI>65?-0.5:lastMFI<35?0.5:0;
              // ── RSI 다이버전스 (Wilder 원저)
              const rsiArr=withRSI.slice(-3);
              const priceArr=withMACD.slice(-3);
              let sDivergence=0;
              if(rsiArr.length===3&&priceArr.length===3){
                const pH=priceArr[2]?.close??null; const pPH=priceArr[0]?.close??null;
                const rH=rsiArr[2]?.rsi??null;     const rPH=rsiArr[0]?.rsi??null;
                if(pH!=null&&pPH!=null&&rH!=null&&rPH!=null){
                  if(pH>pPH&&rH<rPH) sDivergence=-2;       // 가격 신고가 + RSI 미달 → 하락 다이버전스
                  else if(pH<pPH&&rH>rPH) sDivergence=2;   // 가격 신저가 + RSI 상회 → 상승 다이버전스
                }
              }
              // ── MACD 히스토그램 기울기 (Gerald Appel 원저)
              const lastHist=(lastMACD?.macd??0)-(lastMACD?.signal??0);
              const prevHist=(prevMACD?.macd??0)-(prevMACD?.signal??0);
              let sHistSlope=0;
              if(lastMACD&&prevMACD){
                if(lastHist>0&&lastHist<prevHist) sHistSlope=-0.5;  // 양수 히스토그램 꺾임 → 모멘텀 약화
                else if(lastHist<0&&lastHist>prevHist) sHistSlope=0.5; // 음수 히스토그램 반등 → 바닥 다지기
              }
              // ── 이격도 × MACD 교차 판정
              const sCross=(gap!=null&&gap<-15&&lastHist>0)?1.5:(gap!=null&&gap>50&&lastHist<0)?-1.5:0;
              // ── 신호증폭 보너스/패널티 (Elder Triple Screen)
              const bullSignals=[sRSIbase>0,sMACD>0,sOBV>0,sMFI>0,gapScore>0,zoneScore>0].filter(Boolean).length;
              const bearSignals=[sRSIbase<0,sMACD<0,sOBV<0,sMFI<0,gapScore<0,zoneScore<0].filter(Boolean).length;
              const sConfirm=bullSignals>=4?1:bullSignals===3?0.5:bearSignals>=4?-1:bearSignals===3?-0.5:0;
              const scores={
                rsi: sRSIbase,
                macd: sMACD,
                obv: sOBV,
                mfi: sMFI,
                zone: zoneScore,
                gap: gapScore,
                divergence: sDivergence,
                histSlope: sHistSlope,
                cross: sCross,
                confirm: sConfirm,
              };
              const total=Object.values(scores).reduce((a,b)=>a+b,0);
              const upProb=Math.min(95,Math.max(5,Math.round(50+total*8)));
              const dnProb=100-upProb;
              const outlook=upProb>=80?"🚀 강한 상승":upProb>=70?"📈 상승 우세":upProb>=60?"🟢 소폭 상승":upProb>=55?"🟡 약한 상승":upProb>=46?"⚖️ 중립":upProb>=41?"🟠 약한 하락":upProb>=36?"🟠 소폭 하락 우세":upProb>=21?"📉 하락 우세":"🔴 강한 하락";
              const outColor=upProb>=70?C.green:upProb>=60?C.teal:upProb>=55?C.gold:upProb>=46?C.muted:upProb>=41?C.orange:C.red;
// ── 월봉 기반 기간 엔진
// 현재 기술적 신호가 의미를 가질 가능성이 높은 예상 반응 구간
// (정확한 예측 시점이 아니라 신호 유효기간 개념)

const obvUp=lastOBV!=null&&prevOBV!=null?lastOBV>prevOBV:false;
const macdBull=lastHist>0;
const macdBear=lastHist<0;

const extremeOverheat=(priceZone==="EH"||gap>200)&&(lastRSI??0)>=75;
const highOverheat=(priceZone==="VH"||gap>100)&&(lastRSI??0)>=70;

const bottomZone=(priceZone==="VL"||priceZone==="L"||gap<-30);
const deepBottom=(priceZone==="VL"||gap<-45)&&(lastRSI==null||lastRSI<=40);

const bullishReversal=bottomZone&&(macdBull||scores.histSlope>0||obvUp);
const bearishBreak=(macdBear||scores.histSlope<0)&&!obvUp;

let period="추가 확인 필요";

if(upProb>=70){

  if(deepBottom&&bullishReversal)
    period="장기 바닥 형성 가능성 (6~12개월)";

  else if(bullishReversal)
    period="반등 시도 가능성 (3~6개월)";

  else if(macdBull&&obvUp)
    period="상승 추세 회복 가능성 (2~4개월)";

  else
    period="상승 흐름 가능성 (1~3개월)";

}
else if(upProb>=60){

  if(bottomZone)
    period="저점 반등 가능성 (2~4개월)";

  else
    period="완만한 상승 가능성 (1~3개월)";

}
else if(upProb>=55){

  period="약한 상승 가능성 (1~2개월)";

}
else if(upProb>=46){

  period="추가 확인 필요";

}
else if(upProb>=36){

  period=bearishBreak
    ?"하락 압력 가능성 (1~3개월)"
    :"약한 조정 가능성 (1~2개월)";

}
else {

  if(extremeOverheat)
    period="단기 고점 주의 가능성 (2~6주)";

  else if(highOverheat)
    period="과열 구간 가능성 (1~3개월)";

  else if(bearishBreak)
    period="하락 추세 가능성 (2~4개월)";

  else
    period="하락 압력 가능성 (1~3개월)";
}      
              return(
              <div style={{background:`${outColor}0e`,border:`1.5px solid ${outColor}44`,borderRadius:12,padding:"12px 14px",marginBottom:10}}>
                <div style={{color:outColor,fontSize:10,fontWeight:800,marginBottom:6}}>🔭 월봉 기술적 종합 전망 (참고용)</div>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
                  <div style={{textAlign:"center",background:C.card2,borderRadius:10,padding:"8px 14px",minWidth:80}}>
                    <div style={{color:C.muted,fontSize:7,marginBottom:2}}>상승 확률</div>
                    <div style={{color:C.green,fontSize:20,fontWeight:900,fontFamily:"monospace"}}>{upProb}%</div>
                  </div>
                  <div style={{textAlign:"center",background:C.card2,borderRadius:10,padding:"8px 14px",minWidth:80}}>
                    <div style={{color:C.muted,fontSize:7,marginBottom:2}}>하락 확률</div>
                    <div style={{color:C.red,fontSize:20,fontWeight:900,fontFamily:"monospace"}}>{dnProb}%</div>
                  </div>
                  <div style={{flex:1,minWidth:120}}>
                    <div style={{color:outColor,fontSize:13,fontWeight:900,marginBottom:3}}>{outlook}</div>
                    <div style={{color:C.muted,fontSize:8}}>예상 반응 기간: <span style={{color:outColor,fontWeight:700}}>{period}</span></div>
                  </div>
                </div>
                {/* 확률 바 */}
                <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",marginBottom:6}}>
                  <div style={{width:`${upProb}%`,background:`linear-gradient(90deg,${C.green}88,${C.green})`,transition:"width 0.5s"}}/>
                  <div style={{width:`${dnProb}%`,background:`linear-gradient(90deg,${C.red}88,${C.red})`}}/>
                </div>
                {/* 지표별 기여 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4,marginTop:4}}>
                  {[
                    {label:"RSI",v:scores.rsi,raw:lastRSI!=null?lastRSI.toFixed(0):"-"},
                    {label:"MACD",v:scores.macd,raw:lastMACD?(lastMACD.macd??0)>(lastMACD.signal??0)?"↑크로스":"↓크로스":"-"},
                    {label:"OBV",v:scores.obv,raw:lastOBV!=null&&prevOBV!=null?lastOBV>prevOBV?"↑증가":"↓감소":"-"},
                    {label:"MFI",v:scores.mfi,raw:lastMFI!=null?lastMFI.toFixed(0):"-"},
                    {label:"위치",v:scores.zone,raw:priceZone||"-"},
                    {label:"이격도",v:scores.gap,raw:gap!=null?`${gap>0?"+":""}${gap.toFixed(0)}%`:"-"},
                    {label:"RSI다이버",v:scores.divergence,raw:scores.divergence>0?"상승D":scores.divergence<0?"하락D":"없음"},
                    {label:"MACD기울기",v:scores.histSlope,raw:scores.histSlope>0?"바닥다짐":scores.histSlope<0?"모멘약화":"중립"},
                    {label:"이격×MACD",v:scores.cross,raw:scores.cross>0?"반등교차":scores.cross<0?"고점확인":"중립"},
                    {label:"신호증폭",v:scores.confirm,raw:scores.confirm>0?`↑${[...Array(Math.round(scores.confirm*2))].map(()=>"●").join("")}`:scores.confirm<0?`↓${[...Array(Math.round(Math.abs(scores.confirm)*2))].map(()=>"●").join("")}`:"—"},
                  ].map(({label,v,raw})=>{
                    const c=v>0?C.green:v<0?C.red:C.muted;
                    return(
                    <div key={label} style={{background:C.card2,borderRadius:6,padding:"4px 6px",textAlign:"center"}}>
                      <div style={{color:C.muted,fontSize:7,marginBottom:1}}>{label}</div>
                      <div style={{color:c,fontSize:9,fontWeight:800}}>{raw}</div>
                      <div style={{color:c,fontSize:7}}>{v>0?"▲ 긍정":v<0?"▼ 부정":"— 중립"}</div>
                    </div>
                    );
                  })}
                </div>
                <div style={{color:`${C.muted}55`,fontSize:7,marginTop:6,lineHeight:1.6}}>
                  ⚠️ 월봉 10개 지표(RSI·MACD·OBV·MFI·위치·이격도·RSI다이버전스·MACD기울기·이격×MACD교차·신호증폭) 합산 기준. 재무·거시 요인 미반영. 투자 판단의 보조 참고용으로만 활용하십시오.
                </div>
              </div>
              );
            })()}

            <ST accent={C.green}>RSI (14개월)</ST>
            <div style={{background:`${C.green}0d`,border:`1px solid ${C.green}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
              <div style={{color:C.green,fontSize:8,fontWeight:700,marginBottom:3}}>📖 RSI란?</div>
              <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                Relative Strength Index. 최근 14개월간 상승폭 ÷ (상승+하락폭) × 100으로 산출합니다.
                <span style={{color:C.red,fontWeight:700}}> 70 이상</span>은 과매수(단기 조정 가능성),
                <span style={{color:C.green,fontWeight:700}}> 30 이하</span>는 과매도(반등 가능성) 신호입니다.
                월봉 기준이므로 노이즈가 적고 <span style={{color:C.gold,fontWeight:700}}>중장기 추세 전환점</span> 포착에 유리합니다.
              </div>
              <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                {[["🔴 70↑","과매수·조정 경고"],["🟡 50~70","상승추세 유지"],["🟢 30~50","하락추세"],["🔵 30↓","과매도·반등 주시"]].map(([r,l])=>(
                  <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                ))}
              </div>
            </div>
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
            <div style={{background:`${C.blueL}0d`,border:`1px solid ${C.blueL}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
              <div style={{color:C.blueL,fontSize:8,fontWeight:700,marginBottom:3}}>📖 MACD란?</div>
              <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                12개월 EMA − 26개월 EMA = MACD선. 9개월 EMA를 Signal선으로 씁니다.
                <span style={{color:C.green,fontWeight:700}}> MACD가 Signal 상향 돌파(골든크로스)</span>는 상승 전환 신호,
                <span style={{color:C.red,fontWeight:700}}> 하향 돌파(데드크로스)</span>는 하락 전환 신호입니다.
                히스토그램이 0선 위에서 확대되면 상승 모멘텀 강화, 축소되면 모멘텀 약화를 의미합니다.
              </div>
              <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                {[["🟢 골든크로스","상승 전환"],["🔴 데드크로스","하락 전환"],["📊 히스토 확대","모멘텀 강화"],["📊 히스토 축소","추세 약화"]].map(([r,l])=>(
                  <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                ))}
              </div>
            </div>
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
            <div style={{background:`${C.teal}0d`,border:`1px solid ${C.teal}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
              <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:3}}>📖 OBV란?</div>
              <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                On Balance Volume. 상승일 거래량은 누적 더하고, 하락일 거래량은 누적 빼는 방식입니다.
                <span style={{color:C.green,fontWeight:700}}> OBV가 우상향</span>하면 매수세가 지배적(주가 상승 뒷받침),
                <span style={{color:C.red,fontWeight:700}}> 우하향</span>하면 매도세 우위(주가 하락 위험) 신호입니다.
                주가와 OBV의 <span style={{color:C.gold,fontWeight:700}}>다이버전스(방향 불일치)</span>는 추세 전환의 선행 신호로 활용합니다.
              </div>
              <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                {[["🟢 OBV 우상향","매수세 우위"],["🔴 OBV 우하향","매도세 우위"],["⚡ 가격↑·OBV↓","상승 다이버전스(하락경고)"],["⚡ 가격↓·OBV↑","하락 다이버전스(반등기대)"]].map(([r,l])=>(
                  <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                ))}
              </div>
            </div>
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
            <div style={{background:`${C.pink}0d`,border:`1px solid ${C.pink}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
              <div style={{color:C.pink,fontSize:8,fontWeight:700,marginBottom:3}}>📖 MFI란?</div>
              <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                Money Flow Index. RSI에 거래량을 결합한 지표입니다. (고가+저가+종가)÷3의 흐름과 거래량을 14개월 기준으로 계산합니다.
                <span style={{color:C.red,fontWeight:700}}> 80 이상</span>은 과열(스마트머니 매도 가능성),
                <span style={{color:C.green,fontWeight:700}}> 20 이하</span>는 과매도(기관 매수 유입 가능성) 구간입니다.
                RSI보다 거래량 가중이 있어 <span style={{color:C.gold,fontWeight:700}}>기관 자금 흐름 추적</span>에 더 유리합니다.
              </div>
              <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                {[["🔴 80↑","과열·매도 경고"],["🟡 50~80","상승 모멘텀"],["🟢 20~50","하락 모멘텀"],["🔵 20↓","과매도·매수 주시"]].map(([r,l])=>(
                  <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                ))}
              </div>
            </div>
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
              {/* DCF 4가지 방식 설명 */}
              <div style={{background:`${C.gold}0a`,border:`1px solid ${C.gold}22`,borderRadius:10,padding:"10px 12px",marginBottom:12}}>
                <div style={{color:C.gold,fontSize:9,fontWeight:800,marginBottom:8,letterSpacing:"0.05em"}}>📖 내재가치 4가지 산출 방식 — 무엇을 보고 어떻게 쓰는가</div>
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {[
                    {
                      label:"A. DCF (오너이익)", color:C.orange,
                      formula:"오너이익 = 순이익 + 감가상각 − 유지CAPEX",
                      desc:"워런 버핏이 직접 고안한 방식. 회계 이익이 아닌 '주인에게 실제로 귀속되는 현금'을 기준으로 기업 가치를 산출합니다. 유지CAPEX는 사업 현상유지에 필요한 최소 설비투자로, 비율이 높을수록 보수적(낮은 평가). 장기 현금흐름 창출력이 안정적인 기업에 적합합니다.",
                      when:"✅ 제조업·인프라처럼 설비투자 비중이 명확한 기업에 신뢰도 높음",
                    },
                    {
                      label:"B. DCF (금리기반)", color:C.blue,
                      formula:"PV = 오너이익 × (1+g)ⁿ ÷ (r−g), r = 국고채 + 리스크프리미엄",
                      desc:"무위험이자율(국고채)에 리스크 프리미엄을 더해 할인율을 구하고, 미래 현금흐름을 현재가치로 환산합니다. 금리 변화에 가장 민감한 방식으로, 금리 상승기에는 내재가치가 낮아지는 구조. 파라미터 설정이 결과에 큰 영향을 줍니다.",
                      when:"✅ 금리 민감도 분석, 할인율 시나리오별 비교에 유용",
                    },
                    {
                      label:"C. 그레이엄 멀티플", color:C.purple,
                      formula:"V = EPS × (8.5 + 2g) × 4.4 ÷ Y  (Y=현재 회사채 금리)",
                      desc:"벤저민 그레이엄이 제시한 고전적 공식. 8.5는 무성장 기업의 기본 PER, 2g는 성장 프리미엄, 4.4는 1962년 AA 회사채 금리 기준 보정 계수입니다. 현재 금리(Y)가 높을수록 내재가치가 낮아져 금리 환경을 자동 반영합니다. 계산이 단순하고 직관적입니다.",
                      when:"✅ 성장주·가치주 공통 적용 가능. EPS 변동성이 크면 신뢰도 하락",
                    },
                    {
                      label:"D. ROE 멀티플", color:C.teal,
                      formula:"적정PER = ROE(%), 적정주가 = 적정PER × EPS",
                      desc:"ROE가 높은 기업은 그에 걸맞은 PER을 받아야 한다는 논리. 예: ROE 20% → 적정 PER 20배. 자기자본 수익성이 꾸준히 높은 기업(워런 버핏식 해자)을 평가할 때 유용합니다. 단, ROE가 레버리지(부채)에 의해 부풀려진 경우 과대평가 위험이 있습니다.",
                      when:"✅ ROE가 15% 이상 안정적으로 유지되는 우량주에 적합",
                    },
                  ].map(m=>(
                    <div key={m.label} style={{background:C.card2,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${m.color}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                        <span style={{color:m.color,fontSize:9,fontWeight:800}}>{m.label}</span>
                      </div>
                      <div style={{background:`${m.color}0d`,borderRadius:5,padding:"4px 8px",marginBottom:5}}>
                        <span style={{color:m.color,fontSize:7,fontFamily:"monospace",fontWeight:600}}>{m.formula}</span>
                      </div>
                      <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8,marginBottom:4}}>{m.desc}</div>
                      <div style={{color:m.color,fontSize:7,fontWeight:700}}>{m.when}</div>
                    </div>
                  ))}
                </div>
                <div style={{color:`${C.muted}55`,fontSize:7,marginTop:8,lineHeight:1.6}}>
                  💡 4가지 방식의 <span style={{color:C.gold,fontWeight:700}}>평균값</span>이 가장 균형 잡힌 추정치입니다. 방식 간 편차가 클수록 불확실성이 높은 기업입니다.
                  역DCF는 현재 주가에 내재된 시장의 성장 기대치를 역산합니다.
                </div>
              </div>
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
                      <CW h={240}>
                        <ComposedChart data={dcfScaled} margin={{top:4,right:16,left:0,bottom:8}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                          <XAxis dataKey="year" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={24}/>
                          <YAxis {...yp("원",56)} tickFormatter={v=>v>=10000?`${Math.round(v/10000)}만`:`${v.toLocaleString()}`} domain={[0,"auto"]}/>
                          <Tooltip content={<MTip/>} cursor={false}/><Legend wrapperStyle={{fontSize:10,paddingTop:4}} iconSize={10} iconType="plainline"/>
                          <Line dataKey="owner"  name="DCF(오너이익)"  stroke={C.orange} strokeWidth={3}   dot={{r:5,fill:C.orange,strokeWidth:2,stroke:"#fff"}} activeDot={{r:6}} connectNulls/>
                          <Line dataKey="rate"   name="DCF(금리기반)"  stroke={C.blue}   strokeWidth={2.5} dot={{r:4,fill:C.blue,strokeWidth:2,stroke:"#fff"}}   activeDot={{r:5}} connectNulls strokeDasharray="7 3"/>
                          <Line dataKey="graham" name="그레이엄멀티플" stroke={C.purple} strokeWidth={2}   dot={{r:4,fill:C.purple,strokeWidth:1,stroke:"#fff"}} activeDot={{r:5}} connectNulls strokeDasharray="4 3"/>
                          <Line dataKey="roe"    name="ROE멀티플"      stroke={C.teal}   strokeWidth={1.5} dot={{r:3,fill:"#fff",strokeWidth:2,stroke:C.teal}}   activeDot={{r:4}} connectNulls strokeDasharray="2 3"/>
                          {price>0&&<ReferenceLine y={price} stroke={C.gold} strokeWidth={2.5}
                            label={{value:`현재가 ${price.toLocaleString()}원`,fill:C.goldL,fontSize:9,fontWeight:700,position:"insideTopRight"}}/>}
                        </ComposedChart>
                      </CW>
                      {/* FCF 별도 미니 차트 */}
                      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6,marginBottom:3}}>
                        <span style={{color:C.teal,fontSize:8,fontWeight:700}}>FCF ({du}) — 잉여현금흐름 추이</span>
                        <span style={{color:`${C.muted}88`,fontSize:7}}>음수=적자·투자초과, 양수=현금창출</span>
                      </div>
                      <CW h={120}>
                        <ComposedChart data={dcfScaled} margin={{top:4,right:16,left:0,bottom:4}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                          <XAxis dataKey="year" tick={<FinTick/>} tickLine={false} axisLine={{stroke:C.border}} interval={0} height={20}/>
                          <YAxis {...yp("",56)} tickFormatter={v=>{const abs=Math.abs(v);if(abs>=10000)return `${(v/10000).toFixed(1)}조`;return `${Math.round(v)}억`;}} domain={[dataMin=>Math.min(dataMin*1.15,-1),dataMax=>Math.max(dataMax*1.1,1)]}/>
                          <Tooltip content={<MTip/>} cursor={false}/>
                          <ReferenceLine y={0} stroke={C.muted} strokeWidth={1.5} label={{value:"0",fill:C.muted,fontSize:8,position:"insideTopLeft"}}/>
                          <Bar dataKey="fcf" name={`FCF(${du})`} maxBarSize={36} radius={[3,3,0,0]}>
                            {dcfScaled.map((entry,i)=>(
                              <Cell key={i} fill={entry.fcf!=null&&entry.fcf<0?C.red:C.teal} opacity={0.75}/>
                            ))}
                          </Bar>
                        </ComposedChart>
                      </CW>
                      <div style={{color:`${C.muted}55`,fontSize:7,textAlign:"right",marginBottom:6}}>
                        FCF <span style={{color:C.teal,fontWeight:700}}>■ 양수(현금창출)</span> <span style={{color:C.red,fontWeight:700}}>■ 음수(현금소진)</span>
                      </div>
                      {(()=>{
                        const nullYears=dcfHistory.filter(d=>(d.owner==null||d.rate==null)&&d.fcf!=null).map(d=>d.year);
                        const negFcfYears=dcfHistory.filter(d=>d.fcf!=null&&d.fcf<0).map(d=>d.year);
                        if(nullYears.length===0)return null;
                        return(
                          <div style={{background:`${C.red}11`,border:`1px solid ${C.red}44`,borderRadius:6,padding:"6px 10px",marginBottom:6,fontSize:8,lineHeight:1.6}}>
                            <span style={{color:C.red,fontWeight:700}}>⚠️ 일부 연도 DCF 적정주가 미산출</span>
                            <span style={{color:C.muted,marginLeft:6}}>({nullYears.join("·")}년)</span>
                            <div style={{color:`${C.muted}cc`,marginTop:3}}>
                              {negFcfYears.length>0&&<span>• <b>{negFcfYears.join("·")}년</b>: FCF 음수 — 잉여현금흐름 적자·투자초과로 DCF(오너이익)/DCF(금리기반) 산출 불가</span>}
                              <div>• 그레이엄·ROE 멀티플은 EPS 기반으로 별도 표시되며, 음수 EPS 연도에도 null 처리됩니다</div>
                            </div>
                          </div>
                        );
                      })()}
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
                  <div style={{background:`${C.teal}0d`,border:`1px solid ${C.teal}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      <span style={{color:C.teal,fontWeight:700}}>자본유보율</span>: 이익잉여금 ÷ 자본금 × 100. 높을수록 내부 축적 자금이 많아 위기 대응력이 강합니다. 1000% 이상이면 매우 우량.
                      <span style={{color:C.red,fontWeight:700}}> 부채비율</span>: 부채총계 ÷ 자기자본 × 100. <span style={{color:C.orange,fontWeight:700}}>100% 초과</span>시 주의, 200% 이상은 재무 위험 신호.
                      제조업 기준 100% 이하, IT·서비스업 기준 50% 이하가 건전한 수준입니다.
                    </div>
                  </div>
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
                  <div style={{background:`${C.green}0d`,border:`1px solid ${C.green}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      자산 = 부채 + 자본의 관계를 연도별로 추적합니다.
                      <span style={{color:C.green,fontWeight:700}}>자본(초록)</span>이 꾸준히 성장하면 이익 누적 증거.
                      <span style={{color:C.red,fontWeight:700}}> 부채(빨강)</span>가 자본보다 빠르게 늘면 레버리지 확대 주의.
                      <span style={{color:C.blue,fontWeight:700}}> 자산(파랑)</span> 성장이 자본 성장과 비슷한 속도면 건전한 성장입니다.
                    </div>
                  </div>
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
                  <div style={{background:`${C.blue}0d`,border:`1px solid ${C.blue}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      자본(초록)과 부채(빨강)를 쌓아 자산 구성비를 시각화합니다. 초록 비중이 늘수록 자본 건전성 개선.
                      <span style={{color:C.orange,fontWeight:700}}> 부채비율 꺾은선</span>이 우하향이면 재무구조 개선 추세.
                      보조선(100%) 위에서 계속 유지되면 부채 의존 경영으로 금리 인상기 취약성이 커집니다.
                    </div>
                  </div>
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
                <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    <span style={{color:C.gold,fontWeight:700}}>DPS(주당배당금)</span>: 주식 1주당 지급되는 현금 배당액입니다.
                    꾸준한 우상향은 <span style={{color:C.green,fontWeight:700}}>이익 성장 + 주주환원 의지</span>의 신호. 갑작스러운 배당 삭감은 실적 악화나 재무 압박의 선행 경고입니다.
                    배당 성장률이 EPS 성장률보다 빠르면 지속 가능성을 추가 검토하세요.
                  </div>
                </div>
                <CW h={200}>
                  <ComposedChart data={co.divData} margin={{top:4,right:20,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}} tickLine={false} axisLine={{stroke:C.border}}/>
                    <YAxis {...yp("원")}/><Tooltip content={<MTip/>} cursor={false}/>
                    <Bar dataKey="dps" name="DPS(원)" fill={C.gold} opacity={0.8} maxBarSize={40} radius={[4,4,0,0]}/>
                  </ComposedChart>
                </CW>
                <ST accent={C.green}>배당수익률(막대·우축) · 배당성향(꺾은선·좌축)</ST>
                <div style={{background:`${C.green}0d`,border:`1px solid ${C.green}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    <span style={{color:C.green,fontWeight:700}}>배당수익률</span>: DPS ÷ 주가 × 100. 현재 주가 기준 배당 투자 수익률.
                    <span style={{color:C.purple,fontWeight:700}}> 배당성향</span>: DPS ÷ EPS × 100. 순이익 중 배당으로 지급하는 비율.
                    배당성향 <span style={{color:C.gold,fontWeight:700}}>30~60%</span>가 지속가능한 적정 구간. 80% 초과면 이익이 줄어도 배당을 유지하려 한다는 신호로 지속가능성을 점검해야 합니다.
                    배당수익률이 높아도 주가 하락이 원인이면 함정일 수 있습니다.
                  </div>
                </div>
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
          const kospiMACD=calcMACD(kospiMonthly);
          const kosdaqMACD=calcMACD(kosdaqMonthly);
          const kospiOBV=calcOBV(kospiMonthly);
          const kosdaqOBV=calcOBV(kosdaqMonthly);
          const kospiMFI=calcMFI(kospiMonthly);
          const kosdaqMFI=calcMFI(kosdaqMonthly);

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
          // 신호등 — 미국 지표 먼저, 한국 지표 후
          const _t10y2y=(macroData?.fredT10Y2Y||[]).slice(-1)[0]?.value??null;
          const _vix=(macroData?.fredVIX||[]).slice(-1)[0]?.value??null;
          const _hy=(macroData?.fredHY||[]).slice(-1)[0]?.value??null;
          const _baml=(macroData?.fredBAML||[]).slice(-1)[0]?.value??null;
          const _sloos=(macroData?.fredSLOOS||[]).slice(-1)[0]?.value??null;
          const _lei=(macroData?.fredLEI||[]).slice(-1)[0]?.value??null;
          const _dxy=(macroData?.yahooDXY||[]).slice(-1)[0]?.value??null;
          const _cg=(macroData?.copperGold||[]).slice(-1)[0]?.value??null;
          const _icsa=(macroData?.fredICSA||[]).slice(-1)[0]?.value??null;
          const _cdsp=(macroData?.yieldSpread||[]).slice(-1)[0]?.cdSpread??
            (macroData?.defconData?.indicators||[]).find(i=>i.key==="CD스프레드")?.val??null;
          const signals=[
            // ── 🇺🇸 미국 지표
            {label:"미국 M2 통화량 YoY", region:"🇺🇸",
             val:(()=>{const v=[...(macroData?.usM2YoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v!=null?`${v>0?"+":""}${v}%`:"-";})(),
             color:(()=>{const v=[...(macroData?.usM2YoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"#888":v<0?C.red:v<=5?C.green:v<=10?C.gold:C.orange;})(),
             tip:(()=>{const v=[...(macroData?.usM2YoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"":v<0?"긴축경고":v<=5?"정상":v<=10?"주의":"버블위험";})()},
            {label:"미국 장단기금리차(T10Y2Y)", region:"🇺🇸",
             val:_t10y2y!=null?`${_t10y2y>0?"+":""}${_t10y2y}%p`:"-",
             color:_t10y2y==null?"#888":_t10y2y<-1?C.red:_t10y2y<-0.5?C.orange:_t10y2y<0.5?C.gold:C.green,
             tip:_t10y2y==null?"":_t10y2y<-0.5?"역전중":_t10y2y<0?"평탄":_t10y2y<0.5?"보통":"정상"},
            {label:"VIX 공포지수", region:"🇺🇸",
             val:_vix!=null?`${_vix}`:"-",
             color:_vix==null?"#888":_vix>=35?C.red:_vix>=25?C.orange:_vix>=18?C.gold:C.green,
             tip:_vix==null?"":_vix>=35?"극단공포":_vix>=25?"공포":_vix>=18?"경계":"안정"},
            {label:"미국 Baa 신용스프레드", region:"🇺🇸",
             val:_hy!=null?`${_hy}%p`:"-",
             color:_hy==null?"#888":_hy>=4?C.red:_hy>=3?C.orange:_hy>=2?C.gold:C.green,
             tip:_hy==null?"":_hy>=4?"위기":_hy>=3?"경계":_hy>=2?"주의":"안정"},
            {label:"ICE BofA HY 스프레드", region:"🇺🇸",
             val:_baml!=null?`${_baml}%p`:"-",
             color:_baml==null?"#888":_baml>=9?C.red:_baml>=6?C.orange:_baml>=4?C.gold:C.green,
             tip:_baml==null?"":_baml>=9?"위기":_baml>=6?"경계":_baml>=4?"주의":"안정"},
            {label:"미국 SLOOS 대출기준강화", region:"🇺🇸",
             val:_sloos!=null?`${_sloos>0?"+":""}${_sloos}%`:"-",
             color:_sloos==null?"#888":_sloos>=50?C.red:_sloos>=20?C.orange:_sloos>=-5?C.gold:C.green,
             tip:_sloos==null?"":_sloos>=50?"극단강화":_sloos>=20?"긴축":_sloos>=-5?"중립":"완화"},
            {label:"미국 LEI 경기선행지수", region:"🇺🇸",
             val:_lei!=null?`${Number(_lei).toFixed(2)}`:"-",
             color:_lei==null?"#888":_lei<98?C.red:_lei<99?C.orange:_lei<100.5?C.gold:C.green,
             tip:_lei==null?"":_lei<98?"수축":_lei<99?"둔화":_lei<100.5?"보통":"확장"},
            {label:"DXY 달러인덱스", region:"🇺🇸",
             val:_dxy!=null?`${Number(_dxy).toFixed(2)}`:"-",
             color:_dxy==null?"#888":_dxy>=108?C.red:_dxy>=104?C.orange:_dxy>=100?C.gold:C.green,
             tip:_dxy==null?"":_dxy>=108?"강세위험":_dxy>=104?"압박":_dxy>=100?"보통":"약세"},
            {label:"구리/금 비율(×1000)", region:"🇺🇸",
             val:_cg!=null?`${Number(_cg).toFixed(2)}`:"-",
             color:_cg==null?"#888":_cg<0.15?C.red:_cg<0.18?C.orange:_cg<0.25?C.gold:C.green,
             tip:_cg==null?"":_cg<0.15?"위기":_cg<0.18?"경계":_cg<0.25?"중립":"호조"},
            {label:"주간 실업청구(천건)", region:"🇺🇸",
             val:_icsa!=null?`${_icsa}k`:"-",
             color:_icsa==null?"#888":_icsa>=300?C.red:_icsa>=250?C.orange:_icsa>=210?C.gold:C.green,
             tip:_icsa==null?"":_icsa>=300?"급등":_icsa>=250?"증가":_icsa>=210?"보통":"안정"},
            {label:"미국 실업률", region:"🇺🇸",
             val:(()=>{const v=(macroData?.fredUNRATEMonthly||[]).slice(-1)[0]?.value??null;return v!=null?`${v}%`:"-";})(),
             color:(()=>{const v=(macroData?.fredUNRATEMonthly||[]).slice(-1)[0]?.value??null;return v==null?"#888":v>=5.5?C.red:v>=4.5?C.orange:v>=4.0?C.gold:C.green;})(),
             tip:(()=>{const v=(macroData?.fredUNRATEMonthly||[]).slice(-1)[0]?.value??null;return v==null?"":v>=5.5?"침체":v>=4.5?"상승주의":v>=4.0?"보통":"호조";})()},
            // ── 🇰🇷 한국 지표
            {label:"한국 M2 통화량 YoY", region:"🇰🇷",
             val:(()=>{const v=[...(macroData?.krM2YoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v!=null?`${v>0?"+":""}${v}%`:"-";})(),
             color:(()=>{const v=[...(macroData?.krM2YoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"#888":v<0?C.red:v<=5?C.green:v<=10?C.gold:C.orange;})(),
             tip:(()=>{const v=[...(macroData?.krM2YoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"":v<0?"긴축경고":v<=5?"정상":v<=10?"주의":"버블위험";})()},
            {label:"한국 기준금리", region:"🇰🇷",
             val:lastRate!=null?`${lastRate}%`:"-",
             color:lastRate==null?"#888":lastRate>=4?C.red:lastRate>=3?C.orange:lastRate>=2?C.gold:C.green,
             tip:lastRate==null?"":lastRate>=4?"긴축":lastRate>=3?"중립":lastRate>=2?"완화":"초완화"},
            {label:"원/달러 환율", region:"🇰🇷",
             val:lastFX!=null?`${Math.round(lastFX).toLocaleString()}원`:"-",
             color:lastFX==null?"#888":lastFX>=1450?C.red:lastFX>=1380?C.orange:lastFX>=1250?C.gold:C.green,
             tip:lastFX==null?"":lastFX>=1450?"약세위험":lastFX>=1380?"경계":lastFX>=1250?"중립":"강세"},
            {label:"한국 10Y-3Y 금리차", region:"🇰🇷",
             val:(()=>{const v=(macroData?.yieldSpread||[]).slice(-1)[0]?.value??null;return v!=null?`${v>0?"+":""}${v}%p`:"-";})(),
             color:(()=>{const v=(macroData?.yieldSpread||[]).slice(-1)[0]?.value??null;return v==null?"#888":v<-0.5?C.red:v<0?C.orange:v<0.5?C.gold:C.green;})(),
             tip:(()=>{const v=(macroData?.yieldSpread||[]).slice(-1)[0]?.value??null;return v==null?"":v<-0.5?"역전↓":v<0?"평탄":v<0.5?"보통":"정상화↑";})()},
            {label:"CD금리-기준금리 스프레드", region:"🇰🇷",
             val:(()=>{const v=_cdsp;return v!=null?`${v>0?"+":""}${v}%p`:"-";})(),
             color:(()=>{const v=_cdsp;return v==null?"#888":v>=1.5?C.red:v>=1.0?C.orange:v>=0.3?C.gold:C.green;})(),
             tip:(()=>{const v=_cdsp;return v==null?"":v>=1.5?"확대위험":v>=1.0?"경계":v>=0.3?"주의":"안정";})()},
            {label:"한국 은행 대출태도지수", region:"🇰🇷",
             val:(()=>{const v=(macroData?.krSloos||[]).slice(-1)[0]?.value??null;return v!=null?`${v>0?"+":""}${v}`:"-";})(),
             color:(()=>{const v=(macroData?.krSloos||[]).slice(-1)[0]?.value??null;return v==null?"#888":v>=40?C.red:v>=20?C.orange:v>=-5?C.gold:C.green;})(),
             tip:(()=>{const v=(macroData?.krSloos||[]).slice(-1)[0]?.value??null;return v==null?"":v>=40?"극단강화":v>=20?"긴축":v>=-5?"중립":"완화";})()},
            {label:"한국 수출 YoY", region:"🇰🇷",
             val:(()=>{const v=[...(macroData?.exportYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v!=null?`${v>0?"+":""}${v}%`:"-";})(),
             color:(()=>{const v=[...(macroData?.exportYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"#888":v<=-15?C.red:v<=-5?C.orange:v<=5?C.gold:C.green;})(),
             tip:(()=>{const v=[...(macroData?.exportYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"":v<=-15?"감소":v<=-5?"둔화":v<=5?"보합":"증가";})()},
            {label:"한국 GDP성장률", region:"🇰🇷",
             val:lastGDP!=null?`${lastGDP}%`:"-",
             color:lastGDP==null?"#888":lastGDP>=3?C.green:lastGDP>=1?C.gold:C.red,
             tip:lastGDP==null?"":lastGDP>=3?"견조":lastGDP>=1?"완만":"부진"},
            {label:"한국 CPI YoY", region:"🇰🇷",
             val:lastCPI!=null?`${lastCPI>0?"+":""}${lastCPI}%`:"-",
             color:lastCPI==null?"#888":lastCPI>5?C.red:lastCPI>3?C.orange:lastCPI>1?C.gold:C.green,
             tip:lastCPI==null?"":lastCPI>5?"고인플레":lastCPI>3?"경계":lastCPI>1?"보통":"안정"},
            {label:"한국 PPI YoY", region:"🇰🇷",
             val:lastPPI!=null?`${lastPPI>0?"+":""}${lastPPI}%`:"-",
             color:lastPPI==null?"#888":lastPPI>6?C.red:lastPPI>3?C.orange:lastPPI>1?C.gold:C.green,
             tip:lastPPI==null?"":lastPPI>6?"원가↑급등":lastPPI>3?"압박":lastPPI>1?"보통":"안정"},
            {label:"BSI 제조업", region:"🇰🇷",
             val:lastBSI!=null?`${lastBSI}`:"-",
             color:lastBSI==null?"#888":lastBSI>=100?C.green:lastBSI>=90?C.gold:C.red,
             tip:lastBSI==null?"":lastBSI>=100?"확장":lastBSI>=90?"중립":"수축"},
            {label:"가계신용 YoY", region:"🇰🇷",
             val:(()=>{const v=[...(macroData?.hhCreditYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v!=null?`${v>0?"+":""}${v}%`:"-";})(),
             color:(()=>{const v=[...(macroData?.hhCreditYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"#888":v>=8?C.red:v>=5?C.orange:v>=2?C.gold:C.green;})(),
             tip:(()=>{const v=[...(macroData?.hhCreditYoY||[])].reverse().find(r=>r.yoy!=null)?.yoy??null;return v==null?"":v>=8?"과열↑":v>=5?"경계":v>=2?"완만":"감소↓";})()},
            {label:"외국인 KOSPI 순매수 추이", region:"🇰🇷",
             val:(()=>{
               const arr=macroData?.foreignNet3M||[];
               const v=arr.filter(r=>r.ma3!=null).slice(-1)[0]?.ma3??null;
               if(v==null) return "-";
               const a=Math.abs(v);const s=v>=0?"+":"-";
               return a>=10000?`${s}${(a/10000).toFixed(1)}조`:`${s}${Math.round(a).toLocaleString()}억`;
             })(),
             color:(()=>{
               const arr=macroData?.foreignNet||[];
               const recent=arr.slice(-3).map(r=>r.value);
               if(recent.length<3) return "#888";
               const negCnt=recent.filter(v=>v<0).length;
               return negCnt>=3?C.red:negCnt>=2?C.orange:negCnt===0?C.green:C.gold;
             })(),
             tip:(()=>{
               const arr=macroData?.foreignNet||[];
               const recent=arr.slice(-3).map(r=>r.value);
               if(recent.length<3) return "";
               const negCnt=recent.filter(v=>v<0).length;
               return negCnt>=3?"3개월연속매도":negCnt>=2?"매도우세":negCnt===0?"3개월연속매수":"혼조";
             })()},
            {label:"가계부채/GDP (ECOS협의)", region:"🇰🇷",
             val:(()=>{const v=(macroData?.hhDebtGDP||[]).slice(-1)[0]?.value??null;return v!=null?`${v}%`:"-";})(),
             color:(()=>{const v=(macroData?.hhDebtGDP||[]).slice(-1)[0]?.value??null;return v==null?"#888":v>=82?C.red:v>=75?C.orange:v>=65?C.gold:C.green;})(),
             tip:(()=>{const v=(macroData?.hhDebtGDP||[]).slice(-1)[0]?.value??null;return v==null?"":v>=82?"위험":v>=75?"경계":v>=65?"주의":"안정";})()},
          ];

          // ── IndexChart — 주가탭 위치밴드 스타일
          const IndexChart=({title,maData,rsiData,macdData,obvData,mfiData,color})=>{
            // 위치밴드 계산 (maData에 price 필드 있음)
            const bandData=calcPositionBands(maData);
            const lastValid=bandData.filter(d=>d.bBase!=null).slice(-1)[0];
            const lastGap=lastValid?.gap60??null;
            const gapColor=lastGap==null?"#888":lastGap>100?C.red:lastGap>50?C.orange:lastGap>0?C.gold:lastGap>-20?C.teal:C.green;
            const gapLabel=lastGap==null?"":lastGap>100?"VH이상":lastGap>50?"H이상":lastGap>0?"QMA위":lastGap>-20?"L위":"VL근접";

            // ── 월봉 기술적 종합 전망 계산
            const lastRSI=rsiData.slice(-1)[0]?.rsi??null;
            const lastMACD=(macdData||[]).slice(-1)[0];
            const prevMACD=(macdData||[]).slice(-2,-1)[0];
            const lastOBV=(obvData||[]).slice(-1)[0]?.obv??null;
            const prevOBV=(obvData||[]).slice(-2,-1)[0]?.obv??null;
            const lastMFI=(mfiData||[]).slice(-1)[0]?.mfi??null;
            const sRSIbase = lastRSI==null?0:lastRSI<20?2:lastRSI<30?1:lastRSI>85?-2.5:lastRSI>78?-1.5:lastRSI>70?-1:lastRSI>60?-0.5:lastRSI<40?0.5:0;
            const sMACD = lastMACD==null?0:(lastMACD.macd??0)>(lastMACD.signal??0)?1:-1;
            const sOBV  = lastOBV==null||prevOBV==null?0:lastOBV>prevOBV?0.5:-0.5;
            const sMFI  = lastMFI==null?0:lastMFI<10?2:lastMFI<20?1:lastMFI>90?-2:lastMFI>80?-1:lastMFI>65?-0.5:lastMFI<35?0.5:0;
            const sGap  = lastGap==null?0:lastGap>300?-2.5:lastGap>150?-2:lastGap>80?-1.5:lastGap>40?-1:lastGap>20?-0.5:lastGap<-50?2:lastGap<-30?1.5:lastGap<-15?1:lastGap<-5?0.5:0;
            const sZone = lastGap==null?0:lastGap<-30?1.5:lastGap<-15?0.8:lastGap>200?-1.5:lastGap>100?-1.5:lastGap>50?-1:0;
            // ── RSI 다이버전스 (Wilder 원저)
            const iRsiArr=(rsiData||[]).slice(-3);
            const iMaArr=(maData||[]).slice(-3);
            let sIDivergence=0;
            if(iRsiArr.length===3&&iMaArr.length===3){
              const pH=iMaArr[2]?.price??null; const pPH=iMaArr[0]?.price??null;
              const rH=iRsiArr[2]?.rsi??null;  const rPH=iRsiArr[0]?.rsi??null;
              if(pH!=null&&pPH!=null&&rH!=null&&rPH!=null){
                if(pH>pPH&&rH<rPH) sIDivergence=-2;     // 하락 다이버전스
                else if(pH<pPH&&rH>rPH) sIDivergence=2; // 상승 다이버전스
              }
            }
            // ── MACD 히스토그램 기울기 (Gerald Appel 원저)
            const iLastHist=(lastMACD?.macd??0)-(lastMACD?.signal??0);
            const iPrevHist=(prevMACD?.macd??0)-(prevMACD?.signal??0);
            let sIHistSlope=0;
            if(lastMACD&&prevMACD){
              if(iLastHist>0&&iLastHist<iPrevHist) sIHistSlope=-0.5;
              else if(iLastHist<0&&iLastHist>iPrevHist) sIHistSlope=0.5;
            }
            // ── 이격도 × MACD 교차 판정
            const sICross=(lastGap!=null&&lastGap<-15&&iLastHist>0)?1.5:(lastGap!=null&&lastGap>50&&iLastHist<0)?-1.5:0;
            // ── 신호증폭 보너스/패널티 (Elder Triple Screen)
            const iBullSignals=[sRSIbase>0,sMACD>0,sOBV>0,sMFI>0,sGap>0,sZone>0].filter(Boolean).length;
            const iBearSignals=[sRSIbase<0,sMACD<0,sOBV<0,sMFI<0,sGap<0,sZone<0].filter(Boolean).length;
            const sIConfirm=iBullSignals>=4?1:iBullSignals===3?0.5:iBearSignals>=4?-1:iBearSignals===3?-0.5:0;
            const techTotal=sRSIbase+sMACD+sOBV+sMFI+sGap+sZone+sIDivergence+sIHistSlope+sICross+sIConfirm;
            const upProb=Math.min(95,Math.max(5,Math.round(50+techTotal*7)));
            const dnProb=100-upProb;
            const outlook=upProb>=80?"🚀 강한 상승":upProb>=70?"📈 상승 우세":upProb>=60?"🟢 소폭 상승":upProb>=55?"🟡 약한 상승":upProb>=46?"⚖️ 중립":upProb>=41?"🟠 약한 하락":upProb>=36?"🟠 소폭 하락 우세":upProb>=21?"📉 하락 우세":"🔴 강한 하락";
            const outColor=upProb>=70?C.green:upProb>=60?C.teal:upProb>=55?C.gold:upProb>=46?C.muted:upProb>=41?C.orange:C.red;

            // ── 지수 전용 AEGIS 타이밍 엔진
            // 기존 기술적 지표 판독은 유지하고, 그 결과를 지수용 레짐/시간축 시나리오로 번역합니다.
            const sefScore=dc?.totalScore??50;
            const macroRisk=sefScore<35?"위험":sefScore<50?"경계":sefScore<70?"중립":"양호";
            const bandLevel=lastGap==null?"QMA":lastGap>=150?"EH":lastGap>=100?"VH":lastGap>=50?"H":lastGap<=-40?"VL":lastGap<=-20?"L":"QMA";
            const macdWeak=lastMACD&&prevMACD?iLastHist<iPrevHist:false;
            const macdStrong=lastMACD&&prevMACD?iLastHist>iPrevHist:false;
            const obvWeak=lastOBV!=null&&prevOBV!=null?lastOBV<prevOBV:false;
            const obvStrong=lastOBV!=null&&prevOBV!=null?lastOBV>prevOBV:false;
            const indexTiming=(()=>{
              const overheat=(bandLevel==="EH"||bandLevel==="VH"||lastGap>=100);
              const extreme=(bandLevel==="EH"||lastGap>=150||(lastRSI??0)>=85);
              const bottom=(bandLevel==="VL"||bandLevel==="L"||lastGap<=-20);
              const deepBottom=(bandLevel==="VL"||lastGap<=-40);
              const macroBad=sefScore<50;
              const macroGood=sefScore>=70;
              const momentumWeak=macdWeak||obvWeak||sIHistSlope<0||sMACD<0;
              const momentumStrong=macdStrong||obvStrong||sIHistSlope>0||sMACD>0;

              if(extreme&&momentumWeak&&macroBad){
                return{
                  base:"1~3개월 내 변동성 확대 경계",
                  alt:"유동성 지속 시 EH 과열 연장 가능",
                  note:`${bandLevel} 과열 · RSI ${lastRSI!=null?lastRSI.toFixed(0):"-"} · SEFCON ${sefScore}pt`
                };
              }
              if(overheat&&momentumWeak){
                return{
                  base:"3~6개월 내 과열 해소 우세",
                  alt:macroGood?"거시 양호 시 EH 확장 가능":"반등 실패 시 조정 가속 가능",
                  note:`${bandLevel}권 · 이격 ${lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"-"} · 모멘텀 둔화`
                };
              }
              if(overheat){
                return{
                  base:"과열 유지 중, 단기 변동성 경계",
                  alt:"추세 지속 시 추가 상승 후 후행 조정",
                  note:`${bandLevel}권 · RSI ${lastRSI!=null?lastRSI.toFixed(0):"-"} · 수급 확인 필요`
                };
              }
              if(deepBottom&&momentumStrong){
                return{
                  base:"1~3개월 내 평균회귀 반등 우세",
                  alt:"경기충격 지속 시 저평가 장기화",
                  note:`${bandLevel} 저평가 · MACD/수급 개선 확인`
                };
              }
              if(bottom){
                return{
                  base:"1~6개월 내 반등 시도 가능",
                  alt:"거시 악화 시 바닥권 횡보 지속",
                  note:`${bandLevel}권 · 이격 ${lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"-"}`
                };
              }
              if(upProb>=60&&momentumStrong){
                return{
                  base:"1~3개월 상승 흐름 유지 가능",
                  alt:"과열권 접근 시 속도 조절 필요",
                  note:`QMA 상단 · 모멘텀 개선 · SEFCON ${sefScore}pt`
                };
              }
              if(dnProb>=60&&momentumWeak){
                return{
                  base:"1~3개월 약세 압력 우세",
                  alt:"QMA 방어 시 중립 복귀 가능",
                  note:`QMA 부근 · 모멘텀 둔화 · 수급 확인 필요`
                };
              }
              return{
                base:"방향성 확인 구간",
                alt:"상방·하방 모두 열려 있음",
                note:`QMA 중립권 · SEFCON ${sefScore}pt · 추가 신호 대기`
              };
            })();

            // ── 거시환경 연동 코멘트 (SEFCON × 지수 위치)
            let macroComment="";
            if(sefScore<35&&lastGap>50)       macroComment="⚠️ 거시 위험 + 지수 고평가 — 이중 하방 압력";
            else if(sefScore<35&&lastGap<-10)  macroComment="⚡ 거시 위험하나 지수 저점권 — 반등 vs 추가 하락 경합";
            else if(sefScore>=70&&lastGap<-10) macroComment="✅ 거시 양호 + 지수 저평가 — 중기 매수 우호적 환경";
            else if(sefScore>=70&&lastGap>100) macroComment="🔶 거시 양호하나 지수 과열 — 단기 조정 주의";
            else if(sefScore<50)               macroComment="🟠 거시 경계 구간 — 지수 방향성 불확실";
            else                               macroComment="🟡 거시 중립 — 개별 지표 흐름 위주로 판단";

            const bubbleEnergy=buildBubbleEnergyModel({
              market:title==="코스피"?"KOSPI":title==="코스닥"?"KOSDAQ":title,
              monthly:maData,lastGap,lastRSI,lastMFI,bandLevel,sefScore,macdWeak,obvWeak,techTotal
            });
            const bubbleColor=bubbleEnergy?.level==="EXTREME"?C.red:bubbleEnergy?.level==="VERY HIGH"?C.orange:bubbleEnergy?.level==="HIGH"?C.gold:bubbleEnergy?.level==="ELEVATED"?C.teal:C.green;

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

              {/* ── 월봉 기술적 종합 전망 카드 */}
              <div style={{background:`${outColor}0e`,border:`1.5px solid ${outColor}44`,borderRadius:12,padding:"11px 13px",marginBottom:8,marginTop:4}}>
                <div style={{color:outColor,fontSize:10,fontWeight:800,marginBottom:6}}>🔭 {title} 월봉 기술적 종합 전망 (참고용)</div>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:7,flexWrap:"wrap"}}>
                  <div style={{textAlign:"center",background:C.card2,borderRadius:10,padding:"7px 12px",minWidth:72}}>
                    <div style={{color:C.muted,fontSize:7,marginBottom:1}}>상승 확률</div>
                    <div style={{color:C.green,fontSize:19,fontWeight:900,fontFamily:"monospace"}}>{upProb}%</div>
                  </div>
                  <div style={{textAlign:"center",background:C.card2,borderRadius:10,padding:"7px 12px",minWidth:72}}>
                    <div style={{color:C.muted,fontSize:7,marginBottom:1}}>하락 확률</div>
                    <div style={{color:C.red,fontSize:19,fontWeight:900,fontFamily:"monospace"}}>{dnProb}%</div>
                  </div>
                  <div style={{flex:1,minWidth:110}}>
                    <div style={{color:outColor,fontSize:12,fontWeight:900,marginBottom:3}}>{outlook}</div>
                    <div style={{display:"grid",gap:2,lineHeight:1.25}}>
                      <div style={{color:C.muted,fontSize:8}}>기본: <span style={{color:outColor,fontWeight:800}}>{indexTiming.base}</span></div>
                      <div style={{color:C.muted,fontSize:8}}>대안: <span style={{color:C.muted,fontWeight:700}}>{indexTiming.alt}</span></div>
                    </div>
                  </div>
                </div>
                {/* 확률 바 */}
                <div style={{display:"flex",height:7,borderRadius:4,overflow:"hidden",marginBottom:6}}>
                  <div style={{width:`${upProb}%`,background:`linear-gradient(90deg,${C.green}88,${C.green})`,transition:"width 0.5s"}}/>
                  <div style={{width:`${dnProb}%`,background:`linear-gradient(90deg,${C.red}88,${C.red})`}}/>
                </div>
                {/* 지표별 기여 미니 카드 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:3,marginBottom:6}}>
                  {[
                    {label:"RSI",    v:sRSIbase,  raw:lastRSI!=null?lastRSI.toFixed(0):"-"},
                    {label:"MACD",   v:sMACD, raw:lastMACD?(lastMACD.macd??0)>(lastMACD.signal??0)?"↑크로스":"↓크로스":"-"},
                    {label:"OBV",    v:sOBV,  raw:lastOBV!=null&&prevOBV!=null?lastOBV>prevOBV?"↑증가":"↓감소":"-"},
                    {label:"MFI",    v:sMFI,  raw:lastMFI!=null?lastMFI.toFixed(0):"-"},
                    {label:"위치",   v:sZone, raw:lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"-"},
                    {label:"이격도", v:sGap,  raw:lastGap!=null?`${lastGap>0?"+":""}${lastGap}%`:"-"},
                    {label:"RSI다이버",v:sIDivergence,raw:sIDivergence>0?"상승D":sIDivergence<0?"하락D":"없음"},
                    {label:"MACD기울기",v:sIHistSlope,raw:sIHistSlope>0?"바닥다짐":sIHistSlope<0?"모멘약화":"중립"},
                    {label:"이격×MACD",v:sICross,raw:sICross>0?"반등교차":sICross<0?"고점확인":"중립"},
                    {label:"신호증폭",   v:sIConfirm,raw:sIConfirm>0?`↑${[...Array(Math.round(sIConfirm*2))].map(()=>"●").join("")}`:sIConfirm<0?`↓${[...Array(Math.round(Math.abs(sIConfirm)*2))].map(()=>"●").join("")}`:"—"},
                  ].map(({label,v,raw})=>{
                    const c=v>0?C.green:v<0?C.red:C.muted;
                    return(
                    <div key={label} style={{background:C.card2,borderRadius:6,padding:"4px 5px",textAlign:"center"}}>
                      <div style={{color:C.muted,fontSize:7,marginBottom:1}}>{label}</div>
                      <div style={{color:c,fontSize:8,fontWeight:800}}>{raw}</div>
                      <div style={{color:c,fontSize:7}}>{v>0?"▲":v<0?"▼":"—"}</div>
                    </div>
                    );
                  })}
                </div>
                {/* 거시환경 연동 코멘트 */}
                <div style={{background:C.card2,borderRadius:7,padding:"5px 9px",borderLeft:`3px solid ${outColor}`,marginBottom:4}}>
                  <div style={{color:C.muted,fontSize:7,marginBottom:1}}>거시환경 연동 (SEFCON {sefScore}pt · {macroRisk})</div>
                  <div style={{color:outColor,fontSize:8,fontWeight:700}}>{macroComment}</div>
                </div>
                <div style={{color:`${C.muted}44`,fontSize:7}}>
                  ⚠️ 월봉 10개 지표(RSI·MACD·OBV·MFI·위치·이격도·RSI다이버전스·MACD기울기·이격×MACD교차·신호증폭) 합산. 보조 참고용.
                </div>
              </div>

              {/* ── Bubble Energy 평균회귀 엔진 카드 */}
              {bubbleEnergy&&(
              <div style={{background:`${bubbleColor}0e`,border:`1.5px solid ${bubbleColor}44`,borderRadius:12,padding:"11px 13px",marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                  <div>
                    <div style={{color:bubbleColor,fontSize:10,fontWeight:900,marginBottom:2}}>🔥 Bubble Energy — 급등 에너지/평균회귀 위험</div>
                    <div style={{color:C.muted,fontSize:8,lineHeight:1.45}}>{bubbleEnergy.summary}</div>
                  </div>
                  <div style={{textAlign:"right",minWidth:88}}>
                    <div style={{color:bubbleColor,fontSize:20,fontWeight:900,fontFamily:"monospace",lineHeight:1}}>{bubbleEnergy.score}</div>
                    <div style={{color:bubbleColor,fontSize:8,fontWeight:800}}>{bubbleEnergy.levelIcon} {bubbleEnergy.levelKo}</div>
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:8}}>
                  <div style={{background:C.card2,borderRadius:8,padding:"7px 8px",textAlign:"center"}}>
                    <div style={{color:C.muted,fontSize:7,marginBottom:2}}>예상 평균회귀 낙폭</div>
                    <div style={{color:C.red,fontSize:13,fontWeight:900,fontFamily:"monospace"}}>{bubbleEnergy.expectedDrawdown.text}</div>
                  </div>
                  <div style={{background:C.card2,borderRadius:8,padding:"7px 8px",textAlign:"center"}}>
                    <div style={{color:C.muted,fontSize:7,marginBottom:2}}>예상 조정/횡보기간</div>
                    <div style={{color:bubbleColor,fontSize:13,fontWeight:900,fontFamily:"monospace"}}>{bubbleEnergy.expectedDuration.text}</div>
                  </div>
                  <div style={{background:C.card2,borderRadius:8,padding:"7px 8px",textAlign:"center"}}>
                    <div style={{color:C.muted,fontSize:7,marginBottom:2}}>최근 상승속도</div>
                    <div style={{color:C.gold,fontSize:11,fontWeight:900,fontFamily:"monospace"}}>
                      12M {bubbleEnergy.ret12!=null?`${bubbleEnergy.ret12>0?"+":""}${bubbleEnergy.ret12}%`:"-"}
                    </div>
                    <div style={{color:C.muted,fontSize:7,fontFamily:"monospace"}}>24M {bubbleEnergy.ret24!=null?`${bubbleEnergy.ret24>0?"+":""}${bubbleEnergy.ret24}%`:"-"}</div>
                  </div>
                </div>

                <div style={{background:C.card2,borderRadius:8,padding:"7px 9px",borderLeft:`3px solid ${bubbleColor}`,marginBottom:7}}>
                  <div style={{color:C.muted,fontSize:7,marginBottom:2}}>엔진 행동 해석</div>
                  <div style={{color:bubbleColor,fontSize:8,fontWeight:800}}>{bubbleEnergy.action}</div>
                </div>

                <div style={{color:C.muted,fontSize:7,fontWeight:800,marginBottom:4}}>유사 버블/충격 사례 비교</div>
                <div style={{display:"grid",gap:4}}>
                  {bubbleEnergy.similarCases.map((cs,idx)=>(
                    <div key={cs.id} style={{display:"grid",gridTemplateColumns:"1.2fr 0.55fr 0.85fr 0.95fr",gap:5,alignItems:"center",background:C.card2,borderRadius:7,padding:"6px 7px",border:`1px solid ${C.border}`}}>
                      <div style={{minWidth:0}}>
                        <div style={{color:idx===0?bubbleColor:C.text,fontSize:8,fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cs.name}</div>
                        <div style={{color:C.muted,fontSize:7,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cs.type}</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{color:C.muted,fontSize:7}}>에너지</div>
                        <div style={{color:bubbleColor,fontSize:9,fontWeight:900,fontFamily:"monospace"}}>{cs.energy}</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{color:C.muted,fontSize:7}}>실제/대표 낙폭</div>
                        <div style={{color:C.red,fontSize:8,fontWeight:800}}>{cs.actualDrawdown}</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{color:C.muted,fontSize:7}}>조정기간</div>
                        <div style={{color:C.gold,fontSize:8,fontWeight:800}}>{cs.actualDuration}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{color:`${C.muted}55`,fontSize:7,lineHeight:1.5,marginTop:6}}>
                  ※ v1은 8개 역사적 archetype 기반 추정입니다. 이후 Supabase 스냅샷 검증값이 쌓이면 세콰이어 자체 경험 데이터로 가중치가 보정됩니다.
                </div>
              </div>
              )}

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
              {[["defcon","SEFCON"],["v3core","AEGIS"],["kospi","코스피"],["kosdaq","코스닥"]].map(([k,label])=>{
                const tabColor = k==="defcon" ? C.red : k==="v3core" ? "#2F6F5E" : C.blue;
                return (
                <button key={k} onClick={()=>setMarketSub(k)}
                  style={{flex:1,padding:"7px 0",borderRadius:8,
                    border:`1.5px solid ${marketSub===k?tabColor:C.border}`,
                    background:marketSub===k?`${tabColor}18`:C.card2,
                    color:marketSub===k?tabColor:C.muted,
                    fontSize:10,fontWeight:700,cursor:"pointer"}}>
                  {label}
                </button>
                );
              })}
            </div>

            {/* ══ SEFCON 탭 ══ */}
            {marketSub==="defcon"&&<>
            {/* ══ SEFCON 메인 카드 ══ */}
            {dc&&(()=>{
              const catCfg=[
                {cat:"신용위험",icon:"🔗",color:C.cyan},
                {cat:"유동성",  icon:"💧",color:C.blue},
                {cat:"시장공포",icon:"😱",color:C.purple},
                {cat:"실물경기",icon:"🏭",color:C.teal},
                {cat:"물가",    icon:"🔥",color:C.orange},
              ];
              const catColor=s=>s>=70?C.green:s>=50?C.gold:s>=35?C.orange:C.red;
              const catLabel=s=>s>=70?"양호":s>=50?"중립":s>=35?"경계":"위험";
              return(
              <div style={{background:C.card,border:`2px solid ${dc.defconColor}44`,
                borderRadius:16,padding:"16px 14px",marginBottom:10,
                boxShadow:`0 0 32px ${dc.defconColor}18`}}>

                {/* ── 헤더: 레벨 + 바 지시등 */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{color:C.muted,fontSize:7,letterSpacing:"0.12em",marginBottom:3}}>
                      SEQUOIA SEFCON — 금융위기 조기경보
                    </div>
                    <div style={{color:dc.defconColor,fontSize:22,fontWeight:900,fontFamily:"monospace",
                      letterSpacing:"0.05em",textShadow:`0 0 20px ${dc.defconColor}88`}}>
                      {dc.defconLabel}
                    </div>
                    <div style={{color:`${C.muted}88`,fontSize:7,marginTop:3}}>
                      데이터 기준: {macroData?.updatedAt?new Date(macroData.updatedAt).toLocaleDateString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"-"}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:4,alignItems:"flex-end"}}>
                    {DL.map(l=>(
                      <div key={l.n} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                        <div style={{width:24,height:18+(6-l.n)*3,borderRadius:5,
                          background:dc.defcon===l.n?l.color:`${l.color}20`,
                          border:`1.5px solid ${dc.defcon===l.n?l.color:l.color+"33"}`,
                          boxShadow:dc.defcon===l.n?`0 0 12px ${l.color}99`:"none",
                          transition:"all 0.3s ease"}}/>
                        <div style={{color:dc.defcon===l.n?l.color:C.muted,fontSize:7,fontWeight:700}}>{l.n}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── 종합 점수 게이지 */}
                <div style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{color:C.muted,fontSize:8}}>위기 ←————————————→ 안정</span>
                    <span style={{color:dc.defconColor,fontSize:11,fontWeight:900,fontFamily:"monospace"}}>
                      {dc.totalScore}/100
                    </span>
                  </div>
                  <div style={{background:C.dim,borderRadius:8,height:10,overflow:"hidden",position:"relative"}}>
                    <div style={{position:"absolute",inset:0,
                      background:"linear-gradient(90deg,#FF1A1A 0%,#FF6B00 25%,#F0C800 45%,#38BDF8 70%,#00C878 100%)",
                      opacity:0.25}}/>
                    <div style={{position:"absolute",top:0,left:0,height:"100%",
                      width:`${dc.totalScore}%`,
                      background:`linear-gradient(90deg,${dc.defconColor}88,${dc.defconColor})`,
                      borderRadius:8,transition:"width 0.8s ease",
                      boxShadow:`0 0 8px ${dc.defconColor}66`}}/>
                    <div style={{position:"absolute",top:"50%",left:`${dc.totalScore}%`,
                      transform:"translate(-50%,-50%)",
                      width:3,height:14,background:dc.defconColor,borderRadius:2,
                      boxShadow:`0 0 6px ${dc.defconColor}`}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                    {[0,25,50,75,100].map(v=>(
                      <span key={v} style={{color:`${C.muted}66`,fontSize:7}}>{v}</span>
                    ))}
                  </div>
                </div>

                {/* ── 설명 */}
                <div style={{color:C.muted,fontSize:9,marginBottom:12,lineHeight:1.6,
                  background:C.card2,borderRadius:8,padding:"7px 10px",
                  borderLeft:`3px solid ${dc.defconColor}`}}>
                  {dc.defconDesc}
                </div>

                {/* ── 카테고리 5개 게이지 */}
                <div style={{marginBottom:12}}>
                  <div style={{color:C.gold,fontSize:8,fontWeight:700,marginBottom:6}}>
                    📊 카테고리별 위험도
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {(dc.catScores||[]).map(cs=>{
                      const cfg=catCfg.find(c=>c.cat===cs.cat)||{icon:"•",color:C.muted};
                      const cc=catColor(cs.score);
                      const cl=catLabel(cs.score);
                      return(
                      <div key={cs.cat}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                          <span style={{color:C.muted,fontSize:8}}>{cfg.icon} {cs.cat}</span>
                          <span style={{color:cc,fontSize:8,fontWeight:700,fontFamily:"monospace"}}>
                            {cs.score}점 {cl}
                          </span>
                        </div>
                        <div style={{background:C.dim,borderRadius:4,height:6,overflow:"hidden"}}>
                          <div style={{width:`${cs.score}%`,height:"100%",borderRadius:4,
                            background:`linear-gradient(90deg,${cc}88,${cc})`,
                            transition:"width 0.6s ease"}}/>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── 주요 위험 요인 TOP3 + 해설 */}
                {(()=>{
                  const inds=dc.indicators||[];
                  const worst=[...inds].sort((a,b)=>a.score-b.score).slice(0,3).filter(i=>i.score<0);
                  if(!worst.length) return null;
                  const factor=worst[0];
                  const factorDesc=factor.score<=-2
                    ?`${factor.label}이(가) 위험 수준입니다. 즉각적인 주의가 필요합니다.`
                    :`${factor.label}이(가) 경계 수준에 진입했습니다.`;
                  return(
                  <div style={{marginBottom:12}}>
                    <div style={{color:C.gold,fontSize:8,fontWeight:700,marginBottom:6}}>⚠️ 주요 위험 요인</div>
                    <div style={{background:`${C.red}0d`,border:`1px solid ${C.red}33`,borderRadius:8,
                      padding:"7px 10px",marginBottom:6,borderLeft:`3px solid ${C.red}88`}}>
                      <div style={{color:`${C.muted}bb`,fontSize:7,marginBottom:4}}>{factorDesc}</div>
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        {worst.map((ind,i)=>{
                          const sc=ind.score;
                          const sc_color=sc<=-2?C.red:C.orange;
                          return(
                          <div key={ind.key} style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{color:sc_color,fontSize:9,fontWeight:700,minWidth:14}}>
                              {i+1}.
                            </span>
                            <span style={{color:C.muted,fontSize:9,flex:1}}>{ind.label}</span>
                            <span style={{color:sc_color,fontSize:8,fontWeight:700,fontFamily:"monospace"}}>
                              {ind.val!=null?`${ind.val}${ind.unit}`:"-"}
                            </span>
                            <span style={{color:sc_color,fontSize:7,
                              background:`${sc_color}18`,borderRadius:4,padding:"1px 4px"}}>
                              {sc<=-2?ind.bad:ind.warn}
                            </span>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  );
                })()}

                {/* ── 지표 상세 그리드 */}
                <div style={{marginBottom:8}}>
                  <div style={{color:C.gold,fontSize:8,fontWeight:700,marginBottom:6}}>
                    📋 지표별 상세 (25개)
                  </div>
                  {["신용위험","유동성","시장공포","실물경기","물가"].map(cat=>{
                    const cfg=catCfg.find(c=>c.cat===cat)||{icon:"•",color:C.muted};
                    // 미국 key 목록
                    const US_KEYS=new Set(["미국금리역전","하이일드","HY스프레드","미국SLOOS","VIX","DXY","ICSA","UNRATE","LEI","구리금","미국M2"]);
                    const allInds=dc.indicators.filter(i=>i.cat===cat);
                    // 미국 먼저, 한국 나중 정렬
                    const inds=[...allInds.filter(i=>US_KEYS.has(i.key)),...allInds.filter(i=>!US_KEYS.has(i.key))];
                    return(
                    <div key={cat} style={{marginBottom:8}}>
                      <div style={{color:cfg.color,fontSize:7,fontWeight:700,
                        marginBottom:4,paddingBottom:3,
                        borderBottom:`1px solid ${cfg.color}33`}}>
                        {cfg.icon} {cat}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                        {inds.map(ind=>{
                          const sc=ind.score;
                          const bc=sc>=2?C.green:sc===1?C.teal:sc===-1?C.orange:sc<=-2?C.red:C.muted;
                          const st=sc>=2?"▲▲ "+ind.good:sc===1?"▲ 양호":sc===-1?"▼ 경계":sc<=-2?"▼▼ "+ind.bad:"— 중립";
                          const flag=US_KEYS.has(ind.key)?"🇺🇸":"🇰🇷";
                          const FIXED2_KEYS=new Set(["DXY","LEI","구리금"]);
                          const vStr=ind.val!=null
                            ?(ind.unit==="원"?Math.round(ind.val).toLocaleString()
                              :ind.unit==="%"||ind.unit==="%p"?(typeof ind.val==="number"&&ind.val>0?"+":"")+ind.val
                              :FIXED2_KEYS.has(ind.key)?Number(ind.val).toFixed(2)
                              :ind.val)+(ind.unit||""):"—";
                          return(
                          <div key={ind.key} style={{background:C.card2,borderRadius:7,
                            padding:"6px 8px",border:`1px solid ${bc}22`}}>
                            <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:2}}>
                              <span style={{fontSize:8,lineHeight:1}}>{flag}</span>
                              <span style={{color:`${C.muted}99`,fontSize:7}}>{ind.label}</span>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <span style={{color:bc,fontSize:10,fontWeight:800,fontFamily:"monospace"}}>{vStr}</span>
                              <span style={{color:bc,fontSize:7,fontWeight:700}}>{st}</span>
                            </div>
                            <div style={{background:C.dim,borderRadius:3,height:3,marginTop:4,overflow:"hidden"}}>
                              <div style={{
                                marginLeft:sc<0?`${50+Math.max(sc,-2)*25}%`:"50%",
                                width:`${Math.min(Math.abs(sc)*25,50)}%`,
                                height:"100%",background:bc,borderRadius:3}}/>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>

                <div style={{color:`${C.muted}55`,fontSize:7,textAlign:"right"}}>
                  SEQUOIA SEFCON · FRED · ECOS · Yahoo Finance / 투자 참고용
                </div>
              </div>
              );
            })()}
            </> /* defcon 핵심 SEFCON 카드 끝 */}

            {/* ══ AEGIS 탭 ══ */}
            {marketSub==="v3core"&&<>
{/* ══ v3 시장 국면 지도 카드 ══ */}
{macroData?.regimeInsight && (() => {

  const V3C = {
    title:C.text,
    text:C.text,
    muted:C.muted,
    detail:darkMode ? "#64748B" : "#475569",
    detailStrong:darkMode ? "#94A3B8" : "#334155",
    green:"#00D000",
    blue:"#1E72F0",
    orange:"#FF7A00",
    red:"#FF1A1A",
    neutral:darkMode ? "#8AA8C8" : "#64748B",
  };

  const getRegimeColor = (label) => {
    const t = String(label || "").replace(/\s/g, "");
    if (t.includes("침체") || t.includes("바닥") || t.includes("정상") || t.includes("확장")) return V3C.green;
    if (t.includes("회복") || (t.includes("버블") && t.includes("초입"))) return V3C.blue;
    if (t.includes("버블") && t.includes("말기")) return V3C.orange;
    if (t.includes("긴축") || t.includes("금리") || t.includes("유동성") || t.includes("신용") || t.includes("복합") || t.includes("위기")) return V3C.red;
    return V3C.neutral;
  };

  const prettyRegimeLabel = (label) => {
    const t = String(label || "");
    const map = {
      "정상확장형": "정상 확장형",
      "정상-확장형": "정상 확장형",
      "회복초입형": "회복 초입형",
      "회복-초입형": "회복 초입형",
      "버블초입형": "버블 초입형",
      "버블-초입형": "버블 초입형",
      "버블말기형": "버블 말기형",
      "버블-말기형": "버블 말기형",
      "긴축금리충격형": "긴축·금리충격형",
      "긴축-금리충격형": "긴축·금리충격형",
      "유동성환율위기형": "유동성 위기형",
      "유동성-환율위기형": "유동성 위기형",
      "신용시스템위기형": "신용경색형",
      "신용-시스템위기형": "신용경색형",
      "복합위기형": "복합 위기형",
      "복합-위기형": "복합 위기형",
      "침체바닥형": "침체 바닥형",
      "침체-바닥형": "침체 바닥형",
      "혼합불확실형": "혼합/불확실형",
      "혼합/불확실형": "혼합/불확실형"
    };
    return map[t.replace(/\s/g, "")] || t;
  };

  const regimeLegend = [
    { key:"정상", label:"정상 확장형", desc:["성장 + 유동성 양호","수출↑, LEI↑, 신용 안정","리스크온"] },
    { key:"회복", label:"회복 초입형", desc:["실물 회복 + 유동성 완화","수출↑, LEI↑, 금리↓","초기 상승"] },
    { key:"버블초입", label:"버블 초입형", desc:["유동성 과잉","M2↑, 자산↑","상승 지속"] },
    { key:"버블말기", label:"버블 말기형", desc:["가격 과열","주가↑, 실물 둔화","고점 형성"] },
    { key:"긴축", label:"긴축·금리충격형", desc:["금리 상승","DXY↑, 유동성↓","밸류 압축"] },
    { key:"유동성", label:"유동성 위기형", desc:["환율↑, 외국인↓","달러 강세","신흥국 위험"] },
    { key:"신용", label:"신용경색형", desc:["HY↑, SLOOS↑","스프레드 확대","위기 초입"] },
    { key:"복합", label:"복합 위기형", desc:["실물+신용 동시 악화","LEI↓, 수출↓","금융위기"] },
    { key:"침체", label:"침체 바닥형", desc:["공포 극대","금리↓ 전환","기회 구간"] },
  ];

  const regimeLabel =
    macroData?.regimeInsight?.regime?.primaryLabel || "혼합/불확실형";

  const displayLabel = prettyRegimeLabel(regimeLabel);
  const regimeColor = getRegimeColor(regimeLabel);

  const found =
    regimeLegend.find(r => regimeLabel.replace(/\s/g, "").includes(r.key)) ||
    { label:"혼합/불확실형", desc:["신호 엇갈림","지표 상충","관망"] };

  const adj = macroData?.v3Adjustment?.adjustment ?? 0;
  const adjText =
    adj === 0 ? "보정 없음" : `${adj > 0 ? "+" : ""}${adj}점 보정`;

  return (
    <div style={{
      background:C.card,
      border:`2px solid ${regimeColor}44`,
      borderRadius:16,
      padding:"16px 14px",
      marginBottom:10,
      boxShadow:`0 0 32px ${regimeColor}18`
    }}>
      <div style={{color:V3C.muted,fontSize:8,marginBottom:6}}>
        🗺️ 시장 국면 지도 — v3 Regime
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{color:regimeColor,fontSize:16,fontWeight:900}}>
          {displayLabel}
        </div>
        <div style={{
          color:adj < 0 ? C.red : adj > 0 ? C.green : C.muted,
          fontSize:9,
          fontWeight:800,
          background:C.card2,
          border:`1px solid ${C.border}`,
          borderRadius:999,
          padding:"2px 8px",
          whiteSpace:"nowrap"
        }}>
          {adjText}
        </div>
      </div>

      <div style={{marginTop:8,fontSize:10,color:V3C.detail,lineHeight:1.6,fontWeight:600}}>
        <div><b style={{color:V3C.detailStrong}}>유형:</b> {found.label}</div>
        <div><b style={{color:V3C.detailStrong}}>핵심특징:</b> {found.desc[0]}</div>
        <div><b style={{color:V3C.detailStrong}}>대표신호:</b> {found.desc[1]}</div>
        <div><b style={{color:V3C.detailStrong}}>투자해석:</b> {found.desc[2]}</div>
      </div>

      <details style={{marginTop:10}}>
        <summary style={{color:C.muted,fontSize:9,cursor:"pointer"}}>
          시장 국면 유형표 보기
        </summary>

        <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:6}}>
          {regimeLegend.map((r,i)=>{
            const c = getRegimeColor(r.label);
            return (
              <div key={i} style={{
                fontSize:9,
                color:V3C.muted,
                borderLeft:`3px solid ${c}`,
                paddingLeft:8
              }}>
                <b style={{color:c}}>{r.label}</b> — {r.desc.join(" / ")}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
})()}
{/* ══ v3 타이밍 카드: 버블 말기 / 침체 바닥 전용 최종본 ══ */}
{macroData?.regimeInsight && dc && (() => {
  const regimeLabel = macroData?.regimeInsight?.regime?.primaryLabel || "";

  const isBubbleLate =
    regimeLabel.includes("버블") && regimeLabel.includes("말기");

  const isBottom =
    regimeLabel.includes("침체") || regimeLabel.includes("바닥");

  if (!isBubbleLate && !isBottom) return null;

  const rsiData = calcRSI(kospiMonthly || []);
  const macdData = calcMACD(kospiMonthly || []);
  const obvData = calcOBV(kospiMonthly || []);

  const lastRsi = rsiData.at(-1)?.rsi ?? null;
  const lastMacd = macdData.at(-1) || {};
  const prevMacd = macdData.at(-2) || {};
  const lastObv = obvData.at(-1)?.obv ?? null;
  const prevObv = obvData.at(-2)?.obv ?? null;

  if (lastRsi == null || !Number.isFinite(lastRsi)) return null;

  const rsiOverbought = lastRsi >= 70;
  const rsiOversold = lastRsi <= 30;

  const macdCrossDown =
    prevMacd.macd != null &&
    prevMacd.signal != null &&
    lastMacd.macd != null &&
    lastMacd.signal != null &&
    prevMacd.macd > prevMacd.signal &&
    lastMacd.macd <= lastMacd.signal;

  const macdCrossUp =
    prevMacd.macd != null &&
    prevMacd.signal != null &&
    lastMacd.macd != null &&
    lastMacd.signal != null &&
    prevMacd.macd < prevMacd.signal &&
    lastMacd.macd >= lastMacd.signal;

  const obvDown = lastObv != null && prevObv != null && lastObv < prevObv;
  const obvUp = lastObv != null && prevObv != null && lastObv > prevObv;

  const timingSignals = isBubbleLate
    ? [
        {
          name:`RSI 과열 (${lastRsi.toFixed(1)})`,
          simple:"가격이 너무 빠르게 오른 상태",
          desc:"켜지면 과열 부담이 있다는 뜻입니다.",
          active:rsiOverbought,
          score:2
        },
        {
          name:"MACD 하향",
          simple:"상승 흐름이 꺾이기 시작",
          desc:"켜지면 추세가 약해졌다는 뜻입니다.",
          active:macdCrossDown,
          score:2
        },
        {
          name:"OBV 이탈",
          simple:"거래량 힘이 빠지는 상태",
          desc:"켜지면 수급이 빠지고 있다는 뜻입니다.",
          active:obvDown,
          score:2
        },
      ]
    : [
        {
          name:`RSI 과매도 (${lastRsi.toFixed(1)})`,
          simple:"가격이 과하게 눌린 상태",
          desc:"켜지면 바닥권 압력이 커졌다는 뜻입니다.",
          active:rsiOversold,
          score:2
        },
        {
          name:"MACD 상승",
          simple:"하락 흐름이 회복되기 시작",
          desc:"켜지면 추세 전환 가능성이 생겼다는 뜻입니다.",
          active:macdCrossUp,
          score:2
        },
        {
          name:"OBV 유입",
          simple:"거래량 힘이 다시 들어오는 상태",
          desc:"켜지면 수급 회복 신호입니다.",
          active:obvUp,
          score:2
        },
      ];

  const timingScore = timingSignals
    .filter(s => s.active)
    .reduce((sum, s) => sum + s.score, 0);

  const maxScore = 6;
  const activeCount = timingSignals.filter(s => s.active).length;

  const V3C = {
    green:"#00D000",
    blue:"#1E72F0",
    orange:"#FF7A00",
    red:"#FF1A1A",
    neutral:darkMode ? "#8AA8C8" : "#64748B",
  };

  const getRegimeColor = (label) => {
    const t = String(label || "").replace(/\s/g, "");
    if (t.includes("침체") || t.includes("바닥") || t.includes("정상") || t.includes("확장")) return V3C.green;
    if (t.includes("회복") || (t.includes("버블") && t.includes("초입"))) return V3C.blue;
    if (t.includes("버블") && t.includes("말기")) return V3C.orange;
    if (t.includes("긴축") || t.includes("금리") || t.includes("유동성") || t.includes("신용") || t.includes("복합") || t.includes("위기")) return V3C.red;
    return V3C.neutral;
  };

  const levelColor = getRegimeColor(regimeLabel);
  const uiColor = darkMode ? "#2F6F5E" : "#2F6F5E"; // AEGIS 딥 틸: 내부 UI 강조색

  const timingGrade = isBubbleLate
    ? timingScore >= 5 ? "붕괴 임박"
      : timingScore >= 3 ? "고위험"
      : "초기 경계"
    : timingScore >= 5 ? "반등 임박"
      : timingScore >= 3 ? "초기 반등"
      : "바닥 관찰";

  const activeBeltIndex =
    timingScore <= 2 ? 0 :
    timingScore <= 4 ? 1 :
    2;

  const timing = isBubbleLate
    ? {
        title:"버블 말기 타이밍 경고",
        badge:"위험 감시",
        summary:"버블 말기 국면입니다. 실제 붕괴 여부는 아래 월봉 신호가 몇 개 켜졌는지로 판단합니다.",
        action:
          timingScore >= 5 ? "붕괴 신호가 강합니다. 비중 축소 속도를 높이는 구간입니다."
          : timingScore >= 3 ? "위험 신호가 늘고 있습니다. 신규 매수는 피하고 단계적 축소가 유리합니다."
          : "현재는 초기 경계입니다. 버블 말기이지만 아직 붕괴 확정 신호는 부족합니다."
      }
    : {
        title:"침체 바닥 타이밍 관찰",
        badge:"기회 감시",
        summary:"침체 바닥 국면입니다. 실제 반등 여부는 아래 월봉 회복 신호가 몇 개 켜졌는지로 판단합니다.",
        action:
          timingScore >= 5 ? "반등 신호가 강합니다. 분할매수 속도를 높일 수 있는 구간입니다."
          : timingScore >= 3 ? "초기 회복 신호입니다. 우량주 중심 소액 분할 접근이 적합합니다."
          : "아직은 관찰 단계입니다. 바닥 가능성은 있지만 확인 신호는 부족합니다."
      };

  const phaseList = isBubbleLate
    ? [
        {
          title:"초기 경고 단계",
          subtitle:"버블 내부 균열 시작",
          duration:"평균 진행 속도 1~3M",
          color:uiColor,
          icon:"⚠️",
          meaning:"버블은 아직 살아 있지만 내부 체력이 약해지기 시작하는 단계입니다.",
          symptoms:[
            "지수는 고점권을 유지하지만 상승 탄력은 둔화",
            "RSI 과열·과매수 신호 증가",
            "주도주는 버티지만 종목 간 차별화 확대",
            "일부 민감 섹터와 고평가 종목부터 선행 하락",
            "거래량 증가세 둔화 또는 매수세 약화"
          ],
          interpretation:"아직 붕괴 확정은 아닙니다. 신규 공격 매수는 줄이고, 현금 비중과 과열 자산 비중을 점검하는 구간입니다."
        },
        {
          title:"위험 확대 단계",
          subtitle:"균열이 가격에 반영",
          duration:"평균 진행 속도 3~6M",
          color:uiColor,
          icon:"🔥",
          meaning:"시장 내부 균열이 실제 가격 변동성과 급락으로 드러나기 시작하는 단계입니다.",
          symptoms:[
            "급등 후 급락 반복",
            "반등해도 이전 고점 돌파 실패",
            "월봉 MACD 하락 전환 또는 데드크로스",
            "OBV 이탈, 거래량 흐름 약화",
            "악재에 대한 시장 반응이 커짐"
          ],
          interpretation:"방어 전환이 필요한 구간입니다. 레버리지 축소, 추격 매수 금지, 현금·단기채·방어주 비중 확대가 유리합니다."
        },
        {
          title:"장기 연장 가능 단계",
          subtitle:"위험하지만 유동성으로 지속",
          duration:"평균 진행 속도 6M+",
          color:uiColor,
          icon:"🧨",
          meaning:"위험 신호는 많지만 유동성과 기대감 때문에 버블이 예상보다 오래 지속될 수 있는 단계입니다.",
          symptoms:[
            "밸류에이션 부담에도 상승 지속",
            "악재는 무시하고 호재만 크게 반영",
            "AI·성장주·테마주 중심 과열 지속",
            "단기 조정 후 빠른 회복 반복",
            "‘이번엔 다르다’ 논리 강화"
          ],
          interpretation:"성급한 전면 숏은 위험합니다. 보유 자산은 단계적 이익 실현으로 관리하고, 변동성 확대에 대비하는 구간입니다."
        }
      ]
    : [
        {
          title:"관찰 단계",
          subtitle:"하락 둔화 관찰",
          duration:"평균 진행 속도 1~3M",
          color:uiColor,
          icon:"🔍",
          meaning:"침체가 지속되고 있지만 하락 속도가 둔화되는 초기 구간입니다.",
          symptoms:[
            "급락 빈도 감소",
            "RSI 과매도 구간 진입",
            "거래량 바닥 형성",
            "공포 심리 극대화",
            "우량주 저평가 확대"
          ],
          interpretation:"아직 반등 확정은 아닙니다. 현금 방어와 관찰 중심 접근이 적합합니다."
        },
        {
          title:"초기 반등 단계",
          subtitle:"회복 신호 출현",
          duration:"평균 진행 속도 3~6M",
          color:uiColor,
          icon:"🌊",
          meaning:"하락 추세가 둔화되며 초기 회복 신호가 나타나는 단계입니다.",
          symptoms:[
            "월봉 MACD 골든크로스",
            "OBV 수급 재유입",
            "저점이 조금씩 높아짐",
            "낙폭과대 반등 증가",
            "우량주 중심 수급 회복"
          ],
          interpretation:"분할매수를 시작할 수 있는 초기 구간입니다. 단, 급격한 몰빵보다 우량주 중심의 단계적 접근이 적합합니다."
        },
        {
          title:"반등 강화 단계",
          subtitle:"상승 전환 가능성 확대",
          duration:"평균 진행 속도 6M+",
          color:uiColor,
          icon:"🚀",
          meaning:"시장 심리가 회복되며 상승 추세 전환 가능성이 커지는 단계입니다.",
          symptoms:[
            "거래량 회복",
            "지수 저점 상승",
            "주도주 복귀",
            "위험자산 선호 회복",
            "반등 폭 확대"
          ],
          interpretation:"장기 우량주 중심으로 비중 확대를 고려할 수 있는 단계입니다. 다만 과열 추격보다는 분할 접근이 좋습니다."
        }
      ];

  return (
    <div style={{
      background:C.card,
      border:`2px solid ${levelColor}44`,
      borderRadius:16,
      padding:"16px 14px",
      marginBottom:10,
      boxShadow:`0 0 32px ${levelColor}18`
    }}>
      <div style={{color:C.muted,fontSize:8,marginBottom:6}}>
        ⏳ v3 Timing Signal
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <div style={{color:levelColor,fontSize:16,fontWeight:900}}>
          {timing.title}
        </div>
        <div style={{
          color:levelColor,
          fontSize:9,
          fontWeight:800,
          background:C.card2,
          border:`1px solid ${levelColor}66`,
          borderRadius:999,
          padding:"2px 8px",
          whiteSpace:"nowrap",
          boxShadow:`0 0 12px ${levelColor}33`
        }}>
          {timing.badge}
        </div>
      </div>

      <div style={{marginTop:8,fontSize:10,color:C.muted,lineHeight:1.6}}>
        {timing.summary}
      </div>

      <div style={{
        marginTop:10,
        background:C.card2,
        border:`1px solid ${levelColor}55`,
        borderRadius:10,
        padding:"8px 10px",
        boxShadow:`0 0 12px ${levelColor}18`
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{color:C.text,fontSize:10,fontWeight:800}}>신호 강도</div>
          <div style={{color:levelColor,fontSize:10,fontWeight:900,fontFamily:"monospace"}}>
            {timingGrade} · {activeCount}/3개 ON · {timingScore}/{maxScore}점
          </div>
        </div>

        <div style={{background:C.dim,borderRadius:8,height:7,overflow:"hidden"}}>
          <div style={{
            width:`${Math.round((timingScore / maxScore) * 100)}%`,
            height:"100%",
            background:`linear-gradient(90deg,${uiColor}88,${uiColor})`,
            borderRadius:8,
            transition:"width 0.6s ease"
          }}/>
        </div>

        <div style={{color:C.muted,fontSize:9,marginTop:6,lineHeight:1.45}}>
          {isBubbleLate
            ? activeCount === 0
              ? "켜진 신호가 없습니다. 버블 말기지만 아직 붕괴 트리거는 약합니다."
              : activeCount === 1
                ? "1개 신호만 켜졌습니다. 아직 급락 확정은 아니며 추가 확인이 필요합니다."
                : activeCount === 2
                  ? "2개 신호가 켜졌습니다. 하락 전환 위험이 꽤 커졌습니다."
                  : "3개 신호가 모두 켜졌습니다. 붕괴 위험이 매우 높습니다."
            : activeCount === 0
              ? "켜진 신호가 없습니다. 바닥 가능성은 있지만 아직 확인은 부족합니다."
              : activeCount === 1
                ? "1개 회복 신호만 켜졌습니다. 아직은 관찰 단계입니다."
                : activeCount === 2
                  ? "2개 회복 신호가 켜졌습니다. 반등 가능성이 커졌습니다."
                  : "3개 회복 신호가 모두 켜졌습니다. 반등 가능성이 매우 높습니다."
          }
        </div>
      </div>

      <div style={{marginTop:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{
              width:9,
              height:9,
              borderRadius:"50%",
              background:uiColor,
              boxShadow:`0 0 14px ${uiColor}`
            }}/>
            <div style={{color:C.text,fontSize:11,fontWeight:900}}>
              시장 진행 단계 해석
            </div>
          </div>

          <div style={{
            color:uiColor,
            fontSize:9,
            fontWeight:900,
            background:`${uiColor}14`,
            border:`1px solid ${uiColor}55`,
            borderRadius:999,
            padding:"3px 9px",
            whiteSpace:"nowrap"
          }}>
            {isBubbleLate ? "버블 진행 단계" : "침체 회복 단계"}
          </div>
        </div>

        <div style={{color:C.muted,fontSize:9,lineHeight:1.6,marginBottom:10}}>
          정확한 폭락·반등 시점 예측이 아니라, 현재 시장에서 관찰되는 증상을 기준으로
          어느 단계에 가까운지를 해석합니다.
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {phaseList.map((phase,i)=>{
            const active = i === activeBeltIndex;

            return (
              <div key={i} style={{
                position:"relative",
                overflow:"hidden",
                borderRadius:16,
                padding:"14px 14px",
                background:active
                  ? `linear-gradient(135deg, ${phase.color}22, ${phase.color}08)`
                  : C.card2,
                border:active
                  ? `1.5px solid ${phase.color}99`
                  : `1px solid ${C.border}`,
                boxShadow:active
                  ? `0 0 24px ${phase.color}33`
                  : "none",
                opacity:active ? 1 : 0.72
              }}>
                {active && (
                  <div style={{
                    position:"absolute",
                    top:0,
                    left:0,
                    width:5,
                    height:"100%",
                    background:phase.color,
                    boxShadow:`0 0 18px ${phase.color}`
                  }}/>
                )}

                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{
                      width:38,
                      height:38,
                      borderRadius:13,
                      background:active ? `${phase.color}22` : C.dim,
                      display:"flex",
                      alignItems:"center",
                      justifyContent:"center",
                      fontSize:18,
                      boxShadow:active ? `0 0 14px ${phase.color}44` : "none"
                    }}>
                      {phase.icon}
                    </div>

                    <div>
                      <div style={{
                        color:active ? phase.color : C.text,
                        fontSize:12,
                        fontWeight:900
                      }}>
                        {phase.title}
                      </div>
                      <div style={{color:C.muted,fontSize:9,marginTop:2}}>
                        {phase.subtitle}
                      </div>
                      <div style={{
                        display:"inline-flex",
                        marginTop:6,
                        color:active ? phase.color : C.muted,
                        background:active ? `${phase.color}14` : C.dim,
                        border:`1px solid ${active ? phase.color + "55" : C.border}`,
                        borderRadius:999,
                        padding:"2px 7px",
                        fontSize:8,
                        fontWeight:900,
                        whiteSpace:"nowrap"
                      }}>
                        {phase.duration}
                      </div>
                    </div>
                  </div>

                  {active && (
                    <div style={{
                      background:`${phase.color}22`,
                      color:phase.color,
                      border:`1px solid ${phase.color}66`,
                      borderRadius:999,
                      padding:"4px 10px",
                      fontSize:9,
                      fontWeight:900,
                      whiteSpace:"nowrap"
                    }}>
                      현재 활성
                    </div>
                  )}
                </div>

                <div style={{marginTop:12,color:active ? C.text : C.muted,fontSize:10,lineHeight:1.7}}>
                  {phase.meaning}
                </div>

                <div style={{
                  marginTop:12,
                  background:active ? `${phase.color}10` : C.dim,
                  borderRadius:12,
                  padding:"10px 12px"
                }}>
                  <div style={{
                    color:active ? phase.color : C.text,
                    fontSize:10,
                    fontWeight:900,
                    marginBottom:8
                  }}>
                    시장 특징
                  </div>

                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {phase.symptoms.map((s,idx)=>(
                      <div key={idx} style={{
                        display:"flex",
                        alignItems:"flex-start",
                        gap:7,
                        fontSize:9,
                        lineHeight:1.5,
                        color:active ? C.text : C.muted
                      }}>
                        <span style={{
                          color:active ? phase.color : C.muted,
                          fontWeight:900
                        }}>
                          ●
                        </span>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{
                  marginTop:12,
                  borderRadius:12,
                  padding:"10px 12px",
                  background:active ? `${phase.color}14` : "transparent",
                  border:active
                    ? `1px solid ${phase.color}44`
                    : `1px dashed ${C.border}`
                }}>
                  <div style={{
                    color:active ? phase.color : C.muted,
                    fontSize:10,
                    fontWeight:900,
                    marginBottom:6
                  }}>
                    투자 해석
                  </div>

                  <div style={{color:active ? C.text : C.muted,fontSize:9,lineHeight:1.6}}>
                    {phase.interpretation}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{marginTop:10}}>
        <div style={{color:C.text,fontSize:10,fontWeight:800,marginBottom:5}}>
          확인 트리거
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {timingSignals.map((s,i)=>(
            <div key={i} style={{
              display:"flex",
              justifyContent:"space-between",
              alignItems:"flex-start",
              gap:8,
              background:s.active ? `${levelColor}12` : "transparent",
              border:s.active ? `1px solid ${levelColor}55` : `1px solid ${C.border}22`,
              borderRadius:8,
              padding:"6px 8px",
              fontSize:10,
              lineHeight:1.45,
              color:s.active ? C.text : C.muted,
              boxShadow:s.active ? `0 0 10px ${levelColor}22` : "none"
            }}>
              <div>
                <div style={{fontWeight:800,color:s.active ? levelColor : C.muted}}>
                  {s.active ? "●" : "○"} {s.name}
                </div>
                <div style={{fontSize:9,color:s.active ? C.text : C.muted,marginTop:2}}>
                  {s.simple}
                </div>
                <div style={{fontSize:8,color:C.muted,marginTop:2}}>
                  {s.desc}
                </div>
              </div>

              <span style={{
                color:s.active ? levelColor : C.muted,
                fontWeight:900,
                fontFamily:"monospace",
                whiteSpace:"nowrap"
              }}>
                {s.active ? `+${s.score}` : "0"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        marginTop:10,
        background:`${levelColor}10`,
        border:`1px solid ${levelColor}44`,
        borderRadius:10,
        padding:"8px 10px",
        color:levelColor,
        fontSize:10,
        fontWeight:800,
        lineHeight:1.5
      }}>
        {timing.action}
      </div>

      <div style={{
        marginTop:12,
        padding:"10px 12px",
        borderRadius:12,
        background:C.card2,
        border:`1px dashed ${C.border}`,
        color:C.muted,
        fontSize:9,
        lineHeight:1.6
      }}>
        ※ 평균 진행 속도는 과거 사례 기준의 참고 구간이며, 정확한 폭락·반등 시점을 의미하지 않습니다.
        <br/>
        현재 시장에서 관찰되는 증상과 월봉 트리거를 바탕으로 시장의 진행 상태를 해석합니다.
      </div>
    </div>
  );
})()}
       {/* ══ AEGIS 전략 엔진 카드 ══ */}
{macroData?.regimeInsight && dc && (() => {

  const regimeLabel =
    macroData?.regimeInsight?.regime?.primaryLabel || "";

  const getAegisStrategy = (regime, defcon) => {
    const r = String(regime || "");
    const level = defcon <= 1 ? "low" : defcon === 2 ? "mid" : "high";

    if (r.includes("버블") && r.includes("말기")) {
      if (level === "low") return {
        stance:"부분 방어",
        summary:"가격 과열 신호는 있으나 시스템 위험은 아직 제한적입니다.",
        actions:["일부 차익실현","신규 매수 신중","고평가 종목 비중 축소","현금 비중 점진 확대"]
      };
      if (level === "mid") return {
        stance:"방어 전환",
        summary:"버블 말기 신호와 SEFCON 경계 단계가 겹친 구간입니다.",
        actions:["현금 비중 확대","고PER 종목 축소","분할매도 검토","방어주·단기채 선호"]
      };
      return {
        stance:"공격적 방어",
        summary:"버블 말기와 고위험 SEFCON이 겹친 위험 구간입니다.",
        actions:["리스크 자산 대폭 축소","레버리지 금지","현금 우선","반등 시 비중 축소"]
      };
    }

    if (r.includes("긴축") || r.includes("금리")) {
      if (level === "low") return {
        stance:"선별 방어",
        summary:"금리 압박은 있으나 시스템 위험은 제한적입니다.",
        actions:["성장주 축소","저부채 기업 선호","현금흐름 우량주 유지","무리한 추격매수 금지"]
      };
      if (level === "mid") return {
        stance:"방어 강화",
        summary:"금리 충격과 SEFCON 경계 단계가 겹쳤습니다.",
        actions:["현금·단기채 확대","레버리지 금지","고멀티플 종목 축소","배당·현금흐름 중심"]
      };
      return {
        stance:"생존 우선",
        summary:"긴축 충격이 위기 단계와 결합한 방어 우선 구간입니다.",
        actions:["현금 최우선","부채 많은 기업 회피","위험자산 축소","가격보다 생존성 우선"]
      };
    }

    if (r.includes("침체") || r.includes("바닥")) {
      if (level === "low") return {
        stance:"리스크온 준비",
        summary:"바닥 통과 후 회복 가능성이 커지는 구간입니다.",
        actions:["주식 비중 확대","고ROE 우량주 매수","현금 일부 투입","장기 포지션 구축"]
      };
      if (level === "mid") return {
        stance:"분할매수",
        summary:"공포는 남아 있으나 장기 기회가 형성되는 구간입니다.",
        actions:["우량주 분할매수","일괄매수 금지","현금 일부 유지","하락 시 추가 매수"]
      };
      return {
        stance:"공포 매수 대기",
        summary:"위험은 높지만 장기 기회가 생길 수 있는 구간입니다.",
        actions:["소액 분할매수","현금 방어 유지","부실기업 회피","정책 전환 확인"]
      };
    }

    if (r.includes("회복")) {
      return {
        stance: level === "high" ? "신중한 회복 대응" : "회복 참여",
        summary:"회복 초입 신호가 나타나는 구간입니다.",
        actions:["우량주 중심 분할매수","경기민감주 일부 편입","현금 일부 유지","추세 확인 후 확대"]
      };
    }

    if (r.includes("정상") || r.includes("확장")) {
      return {
        stance:"정상 운용",
        summary:"성장과 유동성이 비교적 양호한 구간입니다.",
        actions:["주식 비중 유지","고ROE 기업 중심","과열 종목만 일부 조정","현금 최소 유지"]
      };
    }

    return {
      stance:"중립 관망",
      summary:"레짐 신호가 명확하지 않거나 혼합되어 있습니다.",
      actions:["현금 일부 유지","신규 매수 신중","기존 우량주 보유","추가 신호 확인"]
    };
  };

  const strategy = getAegisStrategy(regimeLabel, dc.defcon);
  const getRegimeColor = (label) => {
    const t = String(label || "").replace(/\s/g, "");
    if (t.includes("침체") || t.includes("바닥") || t.includes("정상") || t.includes("확장")) return "#00D000";
    if (t.includes("회복") || (t.includes("버블") && t.includes("초입"))) return "#1E72F0";
    if (t.includes("버블") && t.includes("말기")) return "#FF7A00";
    if (t.includes("긴축") || t.includes("금리") || t.includes("유동성") || t.includes("신용") || t.includes("복합") || t.includes("위기")) return "#FF1A1A";
    return darkMode ? "#8AA8C8" : "#64748B";
  };

  const strategyColor = getRegimeColor(regimeLabel);

  return (
    <div style={{
      background:C.card,
      border:`2px solid ${strategyColor}44`,
      borderRadius:16,
      padding:"16px 14px",
      marginBottom:10,
      boxShadow:`0 0 32px ${strategyColor}18`
    }}>
      <div style={{color:C.muted,fontSize:8,marginBottom:6}}>
        🛡️ AEGIS 전략 엔진
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <div style={{color:strategyColor,fontSize:16,fontWeight:900}}>
          {strategy.stance}
        </div>
        <div style={{
          color:strategyColor,
          fontSize:9,
          fontWeight:800,
          background:C.card2,
          border:`1px solid ${C.border}`,
          borderRadius:999,
          padding:"2px 8px",
          whiteSpace:"nowrap"
        }}>
          SEFCON {dc.defcon}
        </div>
      </div>

      <div style={{marginTop:8,fontSize:10,color:C.muted,lineHeight:1.6}}>
        {strategy.summary}
      </div>

      <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
        {strategy.actions.map((a,i)=>(
          <div key={i} style={{fontSize:10,color:C.text,lineHeight:1.45}}>
            • {a}
          </div>
        ))}
      </div>

    </div>
  );

})()}
            </> /* AEGIS 탭 끝 */}

            {marketSub==="defcon"&&<>
              {/* ══ AEGIS 포트폴리오 가이드 ══ */}
            {dc&&(()=>{
              const level = dc.defcon;
              const ca = macroData?.crisisAnalysis;

              const AEGIS_GUIDE = {
                5: {
                  color: "#00C878",
                  title: "SEFCON 5 — 안정  적극 성장 추구",
                  alloc: [
                    { label:"주식", pct:80, color:"#00C878", subs:[
                      { label:"한국 KOSPI 우량 성장주 (반도체/2차전지/바이오)", pct:40 },
                      { label:"미국 S&P500 성장주 · QQQ 중심", pct:30 },
                      { label:"글로벌 배당주 ETF (NOBL)", pct:10 },
                    ]},
                    { label:"채권", pct:10, color:"#38BDF8", subs:[
                      { label:"미국 2년물 국채", pct:5 },
                      { label:"한국 3년물 국고채", pct:5 },
                    ]},
                    { label:"현금", pct:10, color:"#94A3B8", subs:[
                      { label:"원화 파킹통장/MMF", pct:10 },
                    ]},
                  ],
                  guide: "전 지표 안정. 적극적 성장 추구. 우량 성장주 비중 극대화. 현금은 최소화하여 기회비용 제거.",
                },
                4: {
                  color: "#38BDF8",
                  title: "SEFCON 4 — 관망  선별적 투자",
                  alloc: [
                    { label:"주식", pct:65, color:"#38BDF8", subs:[
                      { label:"한국 방어주/배당주 (통신/유틸/금융)", pct:25 },
                      { label:"미국 가치주 · XLV/XLP ETF", pct:25 },
                      { label:"글로벌 배당주/리츠 (NOBL·REITs)", pct:15 },
                    ]},
                    { label:"채권", pct:20, color:"#38BDF8", subs:[
                      { label:"미국 5년물 국채", pct:10 },
                      { label:"한국 5년물 국고채", pct:10 },
                    ]},
                    { label:"현금", pct:15, color:"#94A3B8", subs:[
                      { label:"원화 70% / 달러 MMF 30%", pct:15 },
                    ]},
                  ],
                  guide: "일부 지표 경고. 선별적 투자. 성장주→방어주/배당주 비중 전환. 달러 현금 확보 시작.",
                },
                3: {
                  color: "#F0C800",
                  title: "SEFCON 3 — 경계  리스크 축소",
                  alloc: [
                    { label:"주식", pct:45, color:"#F0C800", subs:[
                      { label:"한국 방어 배당주 (한국전력/KT/은행주)", pct:15 },
                      { label:"미국 필수소비재/헬스케어 (XLP/XLV)", pct:20 },
                      { label:"금 관련주 (GLD ETF / 금광주)", pct:10 },
                    ]},
                    { label:"채권", pct:25, color:"#38BDF8", subs:[
                      { label:"미국 2년물 국채", pct:15 },
                      { label:"한국 3년물 국고채", pct:10 },
                    ]},
                    { label:"현금", pct:30, color:"#94A3B8", subs:[
                      { label:"원화 50% / 달러 MMF·예금 50%", pct:30 },
                    ]},
                  ],
                  guide: "복수 지표 경고. 성장주 비중 대폭 축소. 필수소비재/헬스케어/금으로 방어. 달러 현금 30% 이상 확보 권고.",
                },
                2: {
                  color: "#FF6B00",
                  title: "SEFCON 2 — 위기  자산 방어 최우선",
                  alloc: [
                    { label:"주식", pct:20, color:"#FF6B00", subs:[
                      { label:"미국 필수소비재 XLP (P&G/코카콜라/월마트)", pct:10 },
                      { label:"금 ETF (GLD / IAU)", pct:10 },
                    ]},
                    { label:"채권", pct:30, color:"#38BDF8", subs:[
                      { label:"미국 20년+ 장기채 TLT (침체 시 가격↑)", pct:20 },
                      { label:"한국 10년물 국고채", pct:10 },
                    ]},
                    { label:"현금", pct:50, color:"#94A3B8", subs:[
                      { label:"달러 MMF·예금 80% / 원화 파킹통장 20%", pct:50 },
                    ]},
                  ],
                  guide: "다수 위기 신호 동시 발생. 자산 방어 최우선. 주식 대부분 매도·현금화. 달러 현금 극대화. 미국 장기채 매수 검토.",
                },
                1: {
                  color: "#FF1A1A",
                  title: "SEFCON 1 — 붕괴임박  생존 모드",
                  alloc: [
                    { label:"주식", pct:10, color:"#FF1A1A", subs:[
                      { label:"금 ETF (GLD / IAU) — 안전자산만", pct:10 },
                    ]},
                    { label:"채권", pct:20, color:"#38BDF8", subs:[
                      { label:"미국 3개월 T-Bill — 원금 보존 최우선", pct:20 },
                    ]},
                    { label:"현금", pct:70, color:"#94A3B8", subs:[
                      { label:"달러 MMF·미국 단기국채펀드 90% / 원화 10%", pct:70 },
                    ]},
                  ],
                  guide: "역사적 위기 수준 진입. 생존 모드 전환. 모든 리스크 자산 청산. 달러 현금 극대화. 위기 저점 확인 후 역발상 매수 대기. (역사적으로 SEFCON 1은 최고의 매수 기회 직전)",
                },
              };

              const g = AEGIS_GUIDE[level];
              if (!g) return null;


              return(
              <div style={{background:C.card,border:`2px solid ${g.color}44`,borderRadius:16,padding:"14px 14px",marginBottom:10,
                boxShadow:`0 0 24px ${g.color}14`}}>
                {/* 헤더 */}
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                  <span style={{fontSize:16}}>🛡</span>
                  <div>
                    <div style={{color:g.color,fontSize:12,fontWeight:900,fontFamily:"monospace",letterSpacing:"0.06em"}}>{g.title}</div>
                    <div style={{color:`${C.muted}88`,fontSize:7,marginTop:1}}>AEGIS 포트폴리오 가이드 — 레벨별 자산배분 추천</div>
                  </div>
                </div>

                {/* 자산배분 바 */}
                {g.alloc.map(a=>(
                <div key={a.label} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                    <span style={{color:a.color,fontSize:9,fontWeight:700}}>{a.label}</span>
                    <span style={{color:a.color,fontSize:11,fontWeight:900,fontFamily:"monospace"}}>{a.pct}%</span>
                  </div>
                  <div style={{background:C.dim,borderRadius:4,height:8,overflow:"hidden",marginBottom:4}}>
                    <div style={{width:`${a.pct}%`,height:"100%",borderRadius:4,
                      background:`linear-gradient(90deg,${a.color}66,${a.color})`,transition:"width 0.6s ease"}}/>
                  </div>
                  {a.subs.map(s=>(
                  <div key={s.label} style={{display:"flex",justifyContent:"space-between",padding:"1px 4px",marginBottom:1}}>
                    <span style={{color:`${C.muted}cc`,fontSize:7}}>└ {s.label}</span>
                    <span style={{color:`${C.muted}cc`,fontSize:7,fontFamily:"monospace"}}>{s.pct}%</span>
                  </div>
                  ))}
                </div>
                ))}

                {/* 행동 가이드 */}
                <div style={{background:`${g.color}10`,border:`1px solid ${g.color}33`,borderRadius:8,
                  padding:"8px 10px",marginTop:4,marginBottom:0}}>
                  <div style={{color:g.color,fontSize:8,fontWeight:700,lineHeight:1.6}}>{g.guide}</div>
                </div>


                <div style={{color:`${C.muted}44`,fontSize:7,textAlign:"right",marginTop:6}}>
                  본 가이드는 투자 참고용이며 실제 투자 결정은 본인 책임. SEQUOIA QUANTUM AEGIS system
                </div>
              </div>
              );
            })()}

            {/* ══ Crisis Navigation ══ */}
            {macroData?.crisisAnalysis?.navigation&&(()=>{
              const nav = macroData.crisisAnalysis.navigation;
              const tc  = nav.topCrisis;
              const pct = nav.proximityScore;
              const barColor = pct>=80?C.red:pct>=60?C.orange:pct>=40?C.gold:C.green;
              // distToTop을 퍼센트로 변환 (최대거리 250 기준)
              const distPct = Math.round((nav.distToTop / 250) * 100);

              return(
              <Box>
                <ST accent={C.cyan}>🧭 Crisis Navigation</ST>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:120,background:C.surface,borderRadius:8,padding:"8px 12px",border:`1px solid ${barColor}44`}}>
                      <div style={{color:C.muted,fontSize:9,marginBottom:3}}>가장 유사한 위기</div>
                      <div style={{color:barColor,fontWeight:900,fontSize:13}}>{tc?.label||"—"}</div>
                      <div style={{color:C.muted,fontSize:8,marginTop:1}}>{tc?.date} · SEFCON {tc?.defcon}</div>
                    </div>
                    <div style={{flex:1,minWidth:120,background:C.surface,borderRadius:8,padding:"8px 12px",border:`1px solid ${C.muted}22`}}>
                      <div style={{color:C.muted,fontSize:9,marginBottom:3}}>위기 패턴 진입 경보</div>
                      <div style={{color:barColor,fontWeight:900,fontSize:13}}>{nav.estimatedMonths}<span style={{color:C.muted,fontWeight:400,fontSize:9}}> (참고)</span></div>
                      <div style={{color:C.muted,fontSize:8,marginTop:1}}>
                        정점까지 <span style={{color:barColor,fontWeight:700}}>{distPct}%</span> ({nav.distToTop}pt) 남음
                      </div>
                    </div>
                  </div>

                  <div style={{background:C.surface,borderRadius:8,padding:"8px 12px",border:`1px solid ${C.muted}22`}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{color:C.muted,fontSize:9}}>현재 위기 근접도</span>
                      <span style={{color:barColor,fontWeight:900,fontSize:11}}>{pct}%</span>
                    </div>
                    <div style={{background:`${C.muted}22`,borderRadius:4,height:8,overflow:"hidden"}}>
                      <div style={{width:`${Math.min(100,pct)}%`,height:"100%",borderRadius:4,background:barColor,transition:"width 0.5s"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                      <span style={{color:C.muted,fontSize:8}}>안전</span>
                      <span style={{color:C.muted,fontSize:8}}>위기</span>
                    </div>
                  </div>
                  <div style={{background:C.surface,borderRadius:8,padding:"8px 12px",border:`1px solid ${C.muted}22`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{color:C.muted,fontSize:9}}>위험 지표 밀도</span>
                      <span style={{color:nav.dangerDensity>=50?C.red:nav.dangerDensity>=30?C.orange:C.green,fontWeight:900,fontSize:11}}>
                        {nav.dangerCount}/{nav.totalIndicators} ({nav.dangerDensity}%)
                      </span>
                    </div>
                  </div>
                  {tc?.impact&&(
                  <div style={{background:`${C.red}11`,borderRadius:8,padding:"8px 12px",border:`1px solid ${C.red}33`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
                      <div style={{color:C.muted,fontSize:9}}>위기 발생시 예상 파급력</div>
                      <div style={{color:`${C.muted}66`,fontSize:7}}>※ 해당 위기 당시 한국 실제 영향 기준</div>
                    </div>
                    <div style={{display:"flex",gap:16,marginBottom:5}}>
                      <div>
                        <div style={{color:C.muted,fontSize:8}}>코스피</div>
                        <div style={{color:C.red,fontWeight:900,fontSize:14}}>{tc.impact.kospi>0?"+":""}{tc.impact.kospi}%</div>
                      </div>
                      <div>
                        <div style={{color:C.muted,fontSize:8}}>원/달러</div>
                        <div style={{color:C.orange,fontWeight:900,fontSize:14}}>{tc.impact.krw>0?"+":""}{tc.impact.krw}%</div>
                      </div>
                    </div>
                    <div style={{color:`${C.muted}CC`,fontSize:8,fontStyle:"italic"}}>"{tc.impact.desc}"</div>
                    <div style={{color:`${C.muted}55`,fontSize:7,marginTop:5,lineHeight:1.6}}>
                      ⚠️ 현재 상황이 해당 위기 패턴과 유사할 뿐, 동일한 충격을 의미하지 않습니다. 진원지·전파경로에 따라 실제 충격은 더 크거나 작을 수 있습니다.
                    </div>
                  </div>
                  )}
                  {/* ── SEFCON × Crisis Navigation 해석 매트릭스 */}
                  {(()=>{
                    const sefScore = dc?.totalScore??50;
                    const navScore = pct; // proximityScore 0~100
                    // SEFCON: 70↑ 양호 / 50~70 중립 / 35~50 경계 / 35↓ 위험
                    const sefLevel = sefScore>=70?"양호":sefScore>=50?"중립":sefScore>=35?"경계":"위험";
                    const sefColor = sefScore>=70?C.green:sefScore>=50?C.teal:sefScore>=35?C.orange:C.red;
                    // Crisis Nav: 75↑ 고위험 / 55~75 경보 / 35~55 주의 / 35↓ 안전
                    const navLevel = navScore>=75?"고위험":navScore>=55?"경보":navScore>=35?"주의":"안전";
                    const navColor = navScore>=75?C.red:navScore>=55?C.orange:navScore>=35?C.gold:C.green;
                    // 시나리오 조합
                    const isSefGood = sefScore>=50;
                    const isNavHigh = navScore>=55;
                    let scenario,scenDesc,scenColor,scenAction;
                    if(isSefGood && !isNavHigh){
                      scenario="✅ 실질 안전";scenColor=C.green;
                      scenDesc="지표 건강도 양호 + 위기 패턴 유사도 낮음. 가장 안전한 구간입니다.";
                      scenAction="정상 포지션 유지. 기회 포착 집중.";
                    } else if(isSefGood && isNavHigh){
                      scenario="⚠️ 패턴 선행 경고";scenColor=C.gold;
                      scenDesc="현재 지표는 나쁘지 않으나, 과거 위기 직전 패턴과 유사해지는 중. 표면은 괜찮아 보이지만 구조가 위험해지고 있는 상태입니다.";
                      scenAction="포지션 점검 시작. 방어 자산 비중 소폭 확대 검토.";
                    } else if(!isSefGood && !isNavHigh){
                      scenario="🔶 고유 리스크";scenColor=C.orange;
                      scenDesc="지표는 부진하나 과거 위기 패턴과 다른 양상. 전례 없는 충격이거나 위기 초기 단계일 수 있습니다.";
                      scenAction="원인 파악 우선. 과거 사례 적용 주의.";
                    } else {
                      scenario="🔴 복합 위험";scenColor=C.red;
                      scenDesc="지표 악화 + 역사적 위기 패턴 동시 진입. 가장 높은 경계 구간입니다.";
                      scenAction="리스크 관리 최우선. 포지션 방어적 재편 검토.";
                    }
                    return(
                    <div style={{background:`${scenColor}0d`,border:`1.5px solid ${scenColor}44`,borderRadius:12,padding:"12px 14px",marginTop:8}}>
                      <div style={{color:scenColor,fontSize:10,fontWeight:800,marginBottom:8}}>🗺 SEFCON × Crisis Navigation 교차 해석</div>
                      {/* 현재 좌표 */}
                      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                        <div style={{flex:1,background:C.card2,borderRadius:8,padding:"7px 10px",minWidth:100}}>
                          <div style={{color:C.muted,fontSize:7,marginBottom:2}}>SEFCON 점수</div>
                          <div style={{color:sefColor,fontSize:15,fontWeight:900,fontFamily:"monospace"}}>{sefScore}<span style={{fontSize:9}}>pt</span></div>
                          <div style={{color:sefColor,fontSize:8,fontWeight:700}}>{sefLevel}</div>
                        </div>
                        <div style={{flex:1,background:C.card2,borderRadius:8,padding:"7px 10px",minWidth:100}}>
                          <div style={{color:C.muted,fontSize:7,marginBottom:2}}>Crisis Nav 근접도</div>
                          <div style={{color:navColor,fontSize:15,fontWeight:900,fontFamily:"monospace"}}>{navScore}<span style={{fontSize:9}}>%</span></div>
                          <div style={{color:navColor,fontSize:8,fontWeight:700}}>{navLevel}</div>
                        </div>
                        <div style={{flex:2,background:`${scenColor}18`,border:`1px solid ${scenColor}44`,borderRadius:8,padding:"7px 10px",minWidth:140}}>
                          <div style={{color:scenColor,fontSize:11,fontWeight:900,marginBottom:3}}>{scenario}</div>
                          <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.7}}>{scenDesc}</div>
                        </div>
                      </div>
                      {/* 2×2 매트릭스 시각화 */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:8}}>
                        {[
                          {sef:"양호",nav:"낮음",label:"✅ 실질 안전",c:C.green,  desc:"지표 OK·패턴 무관"},
                          {sef:"양호",nav:"높음",label:"⚠️ 패턴 경고",c:C.gold,   desc:"표면 OK·구조 주의"},
                          {sef:"위험",nav:"낮음",label:"🔶 고유 리스크",c:C.orange,desc:"지표 부진·전례 없음"},
                          {sef:"위험",nav:"높음",label:"🔴 복합 위험",c:C.red,    desc:"최고 경계 구간"},
                        ].map(cell=>{
                          const isActive=(cell.sef==="양호"?isSefGood:!isSefGood)&&(cell.nav==="낮음"?!isNavHigh:isNavHigh);
                          return(
                          <div key={cell.label} style={{
                            background:isActive?`${cell.c}22`:C.card2,
                            border:`${isActive?"2px":"1px"} solid ${isActive?cell.c:C.border}`,
                            borderRadius:8,padding:"7px 9px",
                            boxShadow:isActive?`0 0 10px ${cell.c}44`:"none",
                          }}>
                            <div style={{fontSize:7,color:C.muted,marginBottom:2}}>
                              SEFCON <span style={{color:cell.sef==="양호"?C.green:C.red,fontWeight:700}}>{cell.sef}</span>
                              {" · "}Crisis Nav <span style={{color:cell.nav==="낮음"?C.green:C.red,fontWeight:700}}>{cell.nav}</span>
                            </div>
                            <div style={{color:isActive?cell.c:C.muted,fontSize:9,fontWeight:isActive?800:500}}>{cell.label}</div>
                            <div style={{color:`${C.muted}88`,fontSize:7,marginTop:1}}>{cell.desc}</div>
                            {isActive&&<div style={{color:cell.c,fontSize:7,fontWeight:700,marginTop:3}}>◀ 현재</div>}
                          </div>
                          );
                        })}
                      </div>
                      {/* 권고 행동 */}
                      <div style={{background:C.card2,borderRadius:8,padding:"7px 10px",borderLeft:`3px solid ${scenColor}`}}>
                        <div style={{color:C.muted,fontSize:7,marginBottom:2}}>💡 포지션 가이드 (참고용)</div>
                        <div style={{color:scenColor,fontSize:8,fontWeight:700}}>{scenAction}</div>
                      </div>
                      <div style={{color:`${C.muted}44`,fontSize:7,marginTop:5}}>
                        ※ SEFCON 50pt 이상/이하, Crisis Nav 55% 이상/이하 기준으로 구분. 투자 판단의 보조 참고용.
                      </div>
                    </div>
                    );
                  })()}
                </div>
              </Box>
              );
            })()}

            {/* ══ 역사적 위기 유사도 분석 ══ */}
            {macroData?.crisisAnalysis&&(()=>{
              const ca=macroData.crisisAnalysis;
              const simColor=s=>s>=70?C.red:s>=50?C.orange:s>=30?C.gold:C.green;
              const simLabel=s=>s>=70?"⚠️ 매우 유사":s>=50?"주의":s>=30?"참고":"낮음";
              return(
              <Box>
                <ST accent={C.red}>🏛 역사적 금융위기 유사도 분석</ST>

                {/* ── 최고 유사 위기 경보 */}
                {ca.top&&ca.top.similarity>=40&&(
                <div style={{background:`${ca.top.color}15`,border:`1.5px solid ${ca.top.color}66`,
                  borderRadius:10,padding:"10px 12px",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{color:ca.top.color,fontSize:10,fontWeight:800}}>
                      ⚠️ {ca.top.label} ({ca.top.date}) 와 가장 유사
                    </span>
                    <span style={{color:ca.top.color,fontSize:14,fontWeight:900,fontFamily:"monospace"}}>
                      {ca.top.similarity}%
                    </span>
                  </div>
                  <div style={{color:`${C.muted}cc`,fontSize:8,lineHeight:1.6,marginBottom:6}}>
                    {ca.top.desc}
                  </div>
                  {ca.warnings?.length>0&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {ca.warnings.map(w=>(
                      <span key={w} style={{background:`${C.red}22`,border:`1px solid ${C.red}44`,
                        borderRadius:4,padding:"2px 6px",color:C.red,fontSize:7,fontWeight:700}}>
                        {w}
                      </span>
                    ))}
                  </div>
                  )}
                </div>
                )}

                {/* ── 전체 유사도 바 */}
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
                  {ca.results.map((cr,idx)=>{
                    const sc=simColor(cr.similarity);
                    const isTop=idx===0;
                    return(
                    <div key={cr.id} style={{background:isTop?`${cr.color}12`:C.card2,
                      border:`1px solid ${isTop?cr.color+"44":C.border}`,
                      borderRadius:8,padding:"8px 10px"}}>
                      {/* 제목행: 이름+날짜+유사도 한 줄 */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                        <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",flex:1,minWidth:0}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:cr.color,flexShrink:0}}/>
                          <span style={{color:isTop?cr.color:C.text,fontSize:9,fontWeight:isTop?800:600,whiteSpace:"nowrap"}}>
                            {cr.label}
                          </span>
                          <span style={{color:`${C.muted}88`,fontSize:7,whiteSpace:"nowrap"}}>{cr.date}</span>
                          {isTop&&<span style={{color:cr.color,fontSize:7,fontWeight:700,whiteSpace:"nowrap"}}>▶ 최근접</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0,marginLeft:6}}>
                          <span style={{color:sc,fontSize:7,whiteSpace:"nowrap"}}>{simLabel(cr.similarity)}</span>
                          <span style={{color:sc,fontSize:11,fontWeight:800,fontFamily:"monospace",minWidth:30,textAlign:"right"}}>{cr.similarity}%</span>
                        </div>
                      </div>
                      {/* 설명: 독립 줄 */}
                      <div style={{color:`${C.muted}bb`,fontSize:7.5,lineHeight:1.6,marginBottom:4}}>
                          {({
                            imf1997:     "한국 외환위기(IMF) — 외환보유고 소진, 원화 폭락. 코스피 -70%, 실업률 폭등. IMF 구제금융 570억 달러.",
                            dotcom2000:  "IT 버블 붕괴 — 인터넷 주식 과열 후 붕괴. 나스닥 -78%. 실물 영향은 제한적이었으나 기술주 완전 초토화.",
                            gfc2008:     "글로벌 금융위기(리먼 쇼크) — 서브프라임 부실이 금융 시스템 전반 붕괴로 확산. 코스피 -54%, 글로벌 동반 침체.",
                            europe2011:  "유럽 재정위기 — 그리스·스페인 등 남유럽 국채 부실. ECB 개입 전까지 유로존 해체 우려, 이머징 동반 조정.",
                            covid2020:   "코로나19 팬데믹 — 전 세계 봉쇄령. 코스피 -36% 급락 후 유동성 공급으로 사상 최고 속도 반등.",
                            tightening2022:"미국 긴축 위기 — 40년 만의 최고 인플레이션 대응. 기준금리 0→5.5%. 채권·성장주·코스닥 동반 급락.",
                            volcker1979: "볼커 긴축 쇼크 — 인플레 잡기 위해 금리 20%까지 인상. 극심한 경기침체와 달러 초강세. 스태그플레이션 종식.",
                            japan1990:   "일본 버블 붕괴 — 부동산·주식 동반 붕괴. 닛케이 -80%, 이후 '잃어버린 30년' 장기 침체의 출발점.",
                            bond1994:    "채권 대학살 — 연준 금리 인상에 채권 시장 급락. 멕시코 페소 위기와 맞물려 이머징 시장 연쇄 타격.",
                            ltcm1998:    "러시아 디폴트·LTCM 붕괴 — 러시아 국채 디폴트로 헤지펀드 LTCM 붕괴 위기. 연준 긴급 구제로 시스템 리스크 차단.",
                            china2015:   "중국 충격 — 위안화 절하·중국 증시 폭락. 글로벌 원자재 수요 우려로 신흥국 동반 약세.",
                            fed2018:     "연준 긴축 2018 — 보유자산 축소+금리인상 동시 진행. 12월 나스닥 -20%, 파월 '성장 둔화' 인정 후 피벗.",
                          }[cr.id]||"이 위기 구간의 거시경제 패턴과 현재의 유사도를 5개 카테고리로 분석합니다.")}
                        </div>
                      <div style={{background:C.dim,borderRadius:4,height:5,overflow:"hidden"}}>
                        <div style={{width:`${cr.similarity}%`,height:"100%",borderRadius:4,
                          background:`linear-gradient(90deg,${cr.color}66,${cr.color})`,
                          transition:"width 0.6s ease"}}/>
                      </div>
                      {/* 카테고리별 비교 미니바 */}
                      <div style={{display:"flex",gap:3,marginTop:5}}>
                        {["신용위험","유동성","시장공포","실물경기","물가"].map(cat=>{
                          const curScore=(macroData.defconData?.catScores||[]).find(c=>c.cat===cat)?.score??50;
                          const criScore=cr.cat[cat]??50;
                          const diff=curScore-criScore;
                          const dc=diff>15?C.green:diff<-15?C.red:C.gold;
                          return(
                          <div key={cat} style={{flex:1,textAlign:"center"}}>
                            <div style={{color:`${C.muted}88`,fontSize:6,marginBottom:1}}>
                              {cat==="신용위험"?"신용":cat==="시장공포"?"공포":cat==="실물경기"?"실물":cat}
                            </div>
                            <div style={{color:dc,fontSize:7,fontWeight:700,fontFamily:"monospace"}}>
                              {diff>0?"+":""}{diff}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                      {cr.impact&&(
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        marginTop:6,paddingTop:5,borderTop:`1px solid ${C.border}`}}>
                        <div style={{color:`${C.muted}77`,fontSize:7}}>당시 한국 실제 영향</div>
                        <div style={{display:"flex",gap:10,alignItems:"center"}}>
                          <span style={{color:C.red,fontSize:8,fontWeight:700,fontFamily:"monospace"}}>
                            코스피 {cr.impact.kospi>0?"+":""}{cr.impact.kospi}%
                          </span>
                          <span style={{color:C.orange,fontSize:8,fontWeight:700,fontFamily:"monospace"}}>
                            원달러 {cr.impact.krw>0?"+":""}{cr.impact.krw}%
                          </span>
                          <span style={{color:`${C.muted}99`,fontSize:7}}>{cr.impact.desc}</span>
                        </div>
                      </div>
                      )}
                    </div>
                    );
                  })}
                </div>

                <div style={{color:`${C.muted}55`,fontSize:7,textAlign:"right"}}>
                  유사도 = 5개 카테고리 유클리드 거리 기반 / 참고용
                </div>
              </Box>
              );
            })()}

            </> /* defcon 탭 끝 */}

            {/* ══ 매크로 탭 ══ */}
            {marketSub==="macro"&&<>
            {/* ── 거시경제 신호등 — 맨 위 */}
            <Box>
              <ST accent={C.teal}>🚦 거시경제 신호등</ST>
              {(()=>{
                const usSignals=signals.filter(s=>s.region==="🇺🇸");
                const krSignals=signals.filter(s=>s.region==="🇰🇷");
                const SignalCard=({s})=>(
                  <div style={{background:C.card2,border:`1px solid ${s.color}44`,borderRadius:10,padding:"8px 5px",textAlign:"center",position:"relative"}}>
                    <div style={{position:"absolute",top:4,left:5,fontSize:8,lineHeight:1}}>{s.region}</div>
                    <div style={{color:C.muted,fontSize:7.5,marginBottom:2,marginTop:8,fontWeight:600}}>{s.label}</div>
                    <div style={{width:8,height:8,borderRadius:"50%",background:s.color,margin:"0 auto 3px",
                      boxShadow:`0 0 6px ${s.color}99`}}/>
                    <div style={{color:s.color,fontSize:10,fontWeight:700,fontFamily:"monospace"}}>{s.val}</div>
                    <div style={{color:C.muted,fontSize:7,marginTop:2}}>{s.tip}</div>
                  </div>
                );
                return(<>
                  <div style={{color:`${C.muted}88`,fontSize:7,fontWeight:700,marginBottom:4,letterSpacing:"0.08em"}}>🇺🇸 미국 지표</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
                    {usSignals.map(s=><SignalCard key={s.label} s={s}/>)}
                  </div>
                  <div style={{height:1,background:`${C.border}`,marginBottom:8}}/>
                  <div style={{color:`${C.muted}88`,fontSize:7,fontWeight:700,marginBottom:4,letterSpacing:"0.08em"}}>🇰🇷 한국 지표</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                    {krSignals.map(s=><SignalCard key={s.label} s={s}/>)}
                  </div>
                </>);
              })()}
            </Box>
            {/* ── 🇺🇸 미국 M2 통화량 — 유동성 제1지표 */}
            {(macroData?.usM2YoY||[]).length>0&&(
            <Box>
              <ST accent={C.blue}>💧 🇺🇸 미국 M2 통화량 — 유동성 공급의 핵심 선행지표</ST>
              {(()=>{
                const usRaw=(macroData.usM2YoY||[]).slice(-48);
                const lastUsYoY=[...usRaw].reverse().find(r=>r.yoy!=null)?.yoy??null;
                const sigColor=(v)=>v==null?"#888":v<0?C.red:v<=5?C.green:v<=10?C.gold:C.orange;
                const sigLabel=(v)=>v==null?"-":v<0?"긴축경고":v<=5?"정상":v<=10?"주의":"버블위험";
                const usChartData=usRaw.filter(r=>r.yoy!=null).map(r=>({date:r.date,절대값:r.value,YoY:r.yoy}));
                const addMoM=(arr)=>arr.map((d,i)=>{
                  if(i===0)return{...d,MoM:null};
                  const prev=arr[i-1].절대값;
                  return{...d,MoM:prev?+(((d.절대값/prev)-1)*100).toFixed(2):null};
                });
                const usChart=addMoM(usChartData);
                return(<>
                <div style={{background:`${C.blue}0e`,border:`1px solid ${C.blue}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.blue,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    시중에 풀린 달러의 총량입니다. M2 급증은 자산가격 버블의 연료, M2 급감은 유동성 경색·주가 하락의 신호입니다.<br/>
                    <span style={{color:C.red,fontWeight:700}}>감소(&lt;0%)</span> → 긴축경고 &nbsp;
                    <span style={{color:C.green,fontWeight:700}}>정상(0~5%)</span> → 양호 &nbsp;
                    <span style={{color:C.gold,fontWeight:700}}>주의(5~10%)</span> → 과잉주의 &nbsp;
                    <span style={{color:C.orange,fontWeight:700}}>급증(&gt;10%)</span> → 버블위험
                  </div>
                </div>
                <div style={{background:C.card2,border:`1px solid ${sigColor(lastUsYoY)}44`,borderRadius:8,padding:"7px 10px",marginBottom:8}}>
                  <div style={{color:C.muted,fontSize:7,marginBottom:2}}>🇺🇸 미국 M2 YoY</div>
                  <div style={{color:sigColor(lastUsYoY),fontSize:18,fontWeight:900,fontFamily:"monospace"}}>
                    {lastUsYoY!=null?`${lastUsYoY>0?"+":""}${lastUsYoY}%`:"-"}
                  </div>
                  <div style={{color:sigColor(lastUsYoY),fontSize:8,fontWeight:700,marginTop:1}}>{sigLabel(lastUsYoY)}</div>
                  <div style={{color:`${C.muted}77`,fontSize:7,marginTop:2}}>FRED M2SL · 십억달러</div>
                </div>
                {usChart.length>0&&(<>
                <div style={{color:C.blue,fontSize:8,fontWeight:700,marginBottom:4}}>🇺🇸 미국 M2 YoY% · MoM% (최근 48개월)</div>
                <div style={{display:"flex",gap:12,marginBottom:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:7,color:`${C.muted}cc`}}>
                    <span style={{color:C.blue,fontWeight:700}}>── YoY%</span> 전년동월 대비 증가율 · 추세 방향 (버블/긴축 판단)
                  </span>
                  <span style={{fontSize:7,color:`${C.muted}cc`}}>
                    <span style={{color:C.cyan,fontWeight:700}}>▌MoM%</span> 전월 대비 증가율 · 속도 변화 (꺾임/반등 감지)
                  </span>
                </div>
                <CW h={180}>
                  <ComposedChart data={usChart} margin={{top:4,right:16,left:0,bottom:4}}>
                    <defs>
                      <linearGradient id="usM2Grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.blue} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.blue} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:8}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis yAxisId="yoy" tick={{fill:C.muted,fontSize:8}} width={32} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <YAxis yAxisId="mom" orientation="right" tick={{fill:C.muted,fontSize:8}} width={28} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine yAxisId="yoy" y={0}  stroke={C.muted}         strokeWidth={1} strokeDasharray="4 2"/>
                    <ReferenceLine yAxisId="yoy" y={10} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"버블 10%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine yAxisId="yoy" y={5}  stroke={`${C.gold}66`}   strokeDasharray="3 3" label={{value:"주의 5%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area yAxisId="yoy" dataKey="YoY" name="YoY%" stroke={C.blue} strokeWidth={2} fill="url(#usM2Grad)" dot={false} connectNulls/>
                    <Bar  yAxisId="mom" dataKey="MoM" name="MoM%" fill={C.cyan} opacity={0.5} radius={[2,2,0,0]}/>
                  </ComposedChart>
                </CW>
                <div style={{color:`${C.muted}55`,fontSize:7,textAlign:"right",marginTop:4}}>
                  FRED M2SL · 월별 · 십억달러 기준
                </div>
                </>)}
                </>);
              })()}
            </Box>
            )}

            {/* ── 미국 장단기 금리차 (T10Y2Y) + 한국 비교 */}
            {(macroData?.fredT10Y2Y||[]).length>0&&(
            <Box>
              <ST accent={C.red}>🇺🇸 미국 T10Y2Y — 금융위기 최강 선행지표</ST>
              {(()=>{
                const usData=(macroData.fredT10Y2Y||[]).slice(-36);
                const krData=(macroData.yieldSpread||[]).slice(-36);
                const krMap={};krData.forEach(r=>{krMap[r.date]=r.value;});
                const merged=usData.map(r=>({
                  date:r.date,
                  미국T10Y2Y:r.value,
                  한국10Y3Y:krMap[r.date]??null,
                }));
                const lastUS=usData.slice(-1)[0]?.value??null;
                const ucol=lastUS==null?"#888":lastUS<-0.5?C.red:lastUS<0?C.orange:lastUS<0.5?C.gold:C.green;
                const ulbl=lastUS==null?"":lastUS<-0.5?"역전 위험":lastUS<0?"역전중":lastUS<0.5?"평탄":"정상";
                return(<>
                <div style={{background:`${C.red}0e`,border:`1px solid ${C.red}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.red,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    미국 10년 국채금리 − 2년 국채금리의 차이입니다. 장기금리가 단기금리보다 낮아지는 "<span style={{color:C.red,fontWeight:700}}>역전</span>" 현상은
                    경기침체의 가장 강력한 선행지표로, 1970년 이후 미국 침체 전 <span style={{color:C.gold,fontWeight:700}}>100% 발생</span>했습니다.<br/>
                    역전 후 실제 침체까지 평균 <span style={{color:C.gold,fontWeight:700}}>12~18개월</span> 소요. 실선=미국(파랑), 점선=한국(금색)
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 +0.5%↑","정상"],["🟡 0~+0.5%","평탄"],["🟠 -0.5%~0","역전경계"],["🔴 -1%↓","심각역전"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>역전 → 평균 12~18개월 후 경기침체 · 2008/2020 모두 선행</span>
                  {lastUS!=null&&<span style={{fontSize:11,fontWeight:700,color:ucol,fontFamily:"monospace"}}>{lastUS>0?"+":""}{lastUS}% {ulbl}</span>}
                </div>
                <CW h={220}>
                  <ComposedChart data={merged} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs>
                      <linearGradient id="t10GradPos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.teal} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.teal} stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="t10GradNeg" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor={C.red} stopOpacity={0.35}/>
                        <stop offset="100%" stopColor={C.red} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v>0?"+":""}${v}`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={0} stroke={C.red} strokeWidth={2} strokeDasharray="4 2"
                      label={{value:"역전선",fill:C.red,fontSize:8,position:"insideTopRight"}}/>
                    <ReferenceLine y={0.5} stroke={`${C.gold}66`} strokeDasharray="3 3"
                      label={{value:"+0.5%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={-0.5} stroke={`${C.red}55`} strokeDasharray="3 3"
                      label={{value:"-0.5%",fill:C.red,fontSize:7,position:"insideBottomRight"}}/>
                    <Area dataKey="미국T10Y2Y" name="미국T10Y2Y" stroke={C.cyan} strokeWidth={2.5}
                      fill="url(#t10GradPos)" dot={false} connectNulls/>
                    <Line dataKey="한국10Y3Y" name="한국10Y-3Y" stroke={C.gold} strokeWidth={1.5}
                      dot={false} connectNulls strokeDasharray="4 2"/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 신규: VIX 공포지수 */}
            {(macroData?.fredVIX||[]).length>0&&(
            <Box>
              <ST accent={C.purple}>😱 🇺🇸 VIX 공포지수 — 즉각 충격 감지</ST>
              {(()=>{
                const data=(macroData.fredVIX||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last>=35?C.red:last>=25?C.orange:last>=18?C.gold:C.green;
                const vl=last==null?"":last>=35?"극단공포":last>=25?"공포":last>=18?"경계":"안정";
                return(<>
                <div style={{background:`${C.purple}0e`,border:`1px solid ${C.purple}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.purple,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    투자자들이 향후 30일 주가 변동성에 얼마나 불안해하는지를 나타내는 <span style={{color:C.purple,fontWeight:700}}>공포 온도계</span>입니다.
                    숫자가 높을수록 시장 참여자들이 패닉 상태임을 의미합니다.<br/>
                    2008년 금융위기 시 <span style={{color:C.red,fontWeight:700}}>80</span>, 2020년 코로나 충격 시 <span style={{color:C.red,fontWeight:700}}>66</span>까지 급등했습니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 18 미만","안정"],["🟡 18~25","경계"],["🟠 25~35","공포"],["🔴 35↑","극단패닉"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>VIX 20이상 주의 · 30이상 위기 · 40이상 패닉</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last} {vl}</span>}
                </div>
                <CW h={220}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="vixGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.purple} stopOpacity={0.4}/>
                        <stop offset="100%" stopColor={C.purple} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={32} domain={[0,"auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceArea y1={40} y2={100} fill={`${C.red}10`}/>
                    <ReferenceArea y1={30} y2={40}  fill={`${C.orange}08`}/>
                    <ReferenceLine y={40} stroke={C.red}    strokeDasharray="3 3" label={{value:"패닉 40",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={30} stroke={C.orange} strokeDasharray="3 3" label={{value:"위기 30",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={20} stroke={C.gold}   strokeDasharray="3 3" label={{value:"주의 20",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="VIX" stroke={C.purple} strokeWidth={2.5}
                      fill="url(#vixGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 신규: Baa 신용스프레드 (DBAA - DGS10) */}
            {(macroData?.fredHY||[]).length>0&&(
            <Box>
              <ST accent={C.red}>💀 🇺🇸 Baa 신용스프레드 (DBAA−10Y) — 기업 신용위험 선행</ST>
              {(()=>{
                const data=(macroData.fredHY||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last>=4?C.red:last>=3?C.orange:last>=2?C.gold:C.green;
                const vl=last==null?"":last>=4?"위기":last>=3?"경계":last>=2?"주의":"안정";
                return(<>
                <div style={{background:`${C.red}0e`,border:`1px solid ${C.red}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.red,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    투자등급 하단 기업(Baa등급)의 채권금리와 미국 국채금리의 차이입니다.
                    기업들이 돈을 빌릴 때 국채 대비 <span style={{color:C.red,fontWeight:700}}>얼마나 더 비싸게</span> 빌려야 하는지를 보여줍니다.<br/>
                    스프레드가 벌어질수록 투자자들이 기업 부도를 우려한다는 신호입니다.
                    2008년 리만 사태 때 <span style={{color:C.red,fontWeight:700}}>4.2%p</span>까지 급등했습니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 2%p 미만","안정"],["🟡 2~3%p","주의"],["🟠 3~4%p","경계"],["🔴 4%p↑","위기"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>Baa−국채 스프레드 · 2008년 4%↑ · 2020년 3%↑ · 정상 1~2%</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last>0?"+":""}{last}%p {vl}</span>}
                </div>
                <CW h={220}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="hyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.red} stopOpacity={0.35}/>
                        <stop offset="100%" stopColor={C.red} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v}%p`} domain={[0,"auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceArea y1={4} y2={20} fill={`${C.red}08`}/>
                    <ReferenceLine y={4}   stroke={C.red}    strokeDasharray="3 3" label={{value:"위기 4%p",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={3}   stroke={C.orange} strokeDasharray="3 3" label={{value:"경계 3%p",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={2}   stroke={C.gold}   strokeDasharray="3 3" label={{value:"주의 2%p",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="Baa신용스프레드" stroke={C.red} strokeWidth={2.5}
                      fill="url(#hyGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── ICE BofA HY 스프레드 (사모신용 위험 프리미엄 대용) */}
            {(macroData?.fredBAML||[]).length>0&&(
            <Box>
              <ST accent={C.red}>🔥 🇺🇸 ICE BofA HY 스프레드 — 사모신용 위험 프리미엄 대용</ST>
              {(()=>{
                const data=(macroData.fredBAML||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last>=9?C.red:last>=6?C.orange:last>=4?C.gold:C.green;
                const vl=last==null?"":last>=9?"위기":last>=6?"경계":last>=4?"주의":"안정";
                return(<>
                <div style={{background:`${C.red}0e`,border:`1px solid ${C.red}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.red,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    투기등급(하이일드, BB/B 등급) 채권과 국채의 금리 차이입니다. 사모대출·중소기업 자금조달 시장의
                    <span style={{color:C.red,fontWeight:700}}> 위험 프리미엄</span> 대용 지표로 사용합니다.<br/>
                    Baa 스프레드보다 더 민감하게 반응해 <span style={{color:C.gold,fontWeight:700}}>위기 조기 감지</span>에 유용합니다.
                    2008년 <span style={{color:C.red,fontWeight:700}}>18%p</span>, 2020년 코로나 <span style={{color:C.red,fontWeight:700}}>10%p</span> 급등.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 4%p 미만","안정"],["🟡 4~6%p","주의"],["🟠 6~9%p","경계"],["🔴 9%p↑","위기"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>HY 스프레드 정상 3~4%p · 경계 6~7%p · 위기 9%p↑ (사모신용 대용)</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last}%p {vl}</span>}
                </div>
                <CW h={220}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="bamlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.red} stopOpacity={0.35}/>
                        <stop offset="100%" stopColor={C.red} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v}%p`} domain={[0,"auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceArea y1={9} y2={30} fill={`${C.red}08`}/>
                    <ReferenceLine y={9}  stroke={C.red}    strokeDasharray="3 3" label={{value:"위기 9%p",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={6}  stroke={C.orange} strokeDasharray="3 3" label={{value:"경계 6%p",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={4}  stroke={C.gold}   strokeDasharray="3 3" label={{value:"주의 4%p",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="HY스프레드" stroke={C.red} strokeWidth={2.5}
                      fill="url(#bamlGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 미국 SLOOS 은행대출 기준강화 */}
            {(macroData?.fredSLOOS||[]).length>0&&(
            <Box>
              <ST accent={C.red}>🏛 미국 SLOOS — 글로벌 신용경색 선행 6~12개월</ST>
              {(()=>{
                const data=(macroData.fredSLOOS||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last>=50?C.red:last>=20?C.orange:last>=-5?C.gold:C.green;
                const vl=last==null?"":last>=50?"극단강화":last>=20?"경계":last>=-5?"중립":"완화";
                return(<>
                <div style={{background:`${C.red}0e`,border:`1px solid ${C.red}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.red,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    미국 연방준비제도가 분기마다 은행 임원들에게 설문하는 대출태도 지수입니다.
                    <span style={{color:C.red,fontWeight:700}}> 양수</span>면 은행이 대출 기준을 높여서 돈 빌리기가 어려워진다는 뜻입니다.
                    신용경색의 <span style={{color:C.gold,fontWeight:700}}>6~12개월 선행</span> 지표로 2008년·2020년 위기 전 급등했습니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 -5 미만","완화"],["🟡 -5~20","중립"],["🟠 20~50","긴축경계"],["🔴 50↑","극단긴축"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>미국 연준 선임대출담당자 서베이 · 양수=강화 · 2008년 60%↑ · 2020년 70%↑</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last>0?"+":""}{last}% {vl}</span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="usSloosGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.red} stopOpacity={0.35}/>
                        <stop offset="100%" stopColor={C.red} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v>0?"+":""}${v}`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={0}  stroke={C.muted}         strokeWidth={1.5} strokeDasharray="4 2"/>
                    <ReferenceLine y={50} stroke={`${C.red}66`}    strokeDasharray="3 3" label={{value:"극단 50",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={20} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"경계 20",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="미국SLOOS" stroke={C.red} strokeWidth={2.5} fill="url(#usSloosGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}


            {/* ── 미국 LEI 경기선행지수 */}
            {(macroData?.fredLEI||[]).length>0&&(
            <Box>
              <ST accent={C.teal}>📈 미국 LEI 경기선행지수 — 경기 방향 6~9개월 선행</ST>
              {(()=>{
                const data=(macroData.fredLEI||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last<98?C.red:last<99?C.orange:last<100.5?C.gold:C.green;
                const vl=last==null?"":last<98?"수축":last<99?"둔화":last<100.5?"중립":"확장";
                return(<>
                <div style={{background:`${C.teal}0e`,border:`1px solid ${C.teal}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    OECD가 발표하는 미국 경기선행지수로, 향후 <span style={{color:C.teal,fontWeight:700}}>6~9개월</span>의 경기 방향을 먼저 보여줍니다.
                    주문, 건설허가, 주가, 금리차 등 10개 지표를 합성한 복합지수이며 <span style={{color:C.gold,fontWeight:700}}>100이 기준</span>입니다.<br/>
                    100 위에서 아래로 내려오는 추세가 더 중요합니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 100.5↑","경기확장"],["🟡 99~100.5","중립"],["🟠 98~99","둔화"],["🔴 98 미만","수축"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>OECD 복합선행지수 · 100 기준 · 99이하 둔화신호</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{Number(last).toFixed(2)} {vl}</span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="leiGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.teal} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.teal} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={40} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={100}  stroke={C.green}          strokeWidth={1.5} strokeDasharray="4 2" label={{value:"기준 100",fill:C.green,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={99}   stroke={`${C.orange}66`}  strokeDasharray="3 3" label={{value:"둔화 99",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={98}   stroke={`${C.red}66`}     strokeDasharray="3 3" label={{value:"수축 98",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="LEI" stroke={C.teal} strokeWidth={2.5} fill="url(#leiGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── DXY 달러인덱스 + 원달러 이중축 */}
            {(macroData?.yahooDXY||[]).length>0&&(
            <Box>
              <ST accent={C.cyan}>💵 🇺🇸 DXY 달러인덱스 — 글로벌 위험회피 바로미터</ST>
              {(()=>{
                const dxData=(macroData.yahooDXY||[]).slice(-36);
                const fxData=(macroData.fx||[]).slice(-36);
                const fxMap={};fxData.forEach(r=>{fxMap[r.date]=r.value;});
                const merged=dxData.map(r=>({date:r.date,DXY:r.value,원달러:fxMap[r.date]??null}));
                const lastDX=dxData.slice(-1)[0]?.value??null;
                const vc=lastDX==null?"#888":lastDX>=108?C.red:lastDX>=104?C.orange:lastDX>=100?C.gold:C.green;
                const vl=lastDX==null?"":lastDX>=108?"달러강세위험":lastDX>=104?"경계":lastDX>=100?"보통":"달러약세";
                return(<>
                <div style={{background:`${C.cyan}0e`,border:`1px solid ${C.cyan}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.cyan,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    주요 6개국 통화 대비 달러 가치를 나타내는 지수입니다. 달러가 강해질수록 신흥국(한국 포함)에서
                    <span style={{color:C.red,fontWeight:700}}> 자금이 빠져나갑니다</span>.<br/>
                    원/달러 환율(점선)과 함께 보면 한국 금융시장 외국인 자금 흐름을 파악할 수 있습니다.
                    실선=DXY(파랑), 점선=원달러(금색)
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 100 미만","달러약세"],["🟡 100~104","보통"],["🟠 104~108","긴축압박"],["🔴 108↑","강세위험"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>DXY강세 = 신흥국 압박·자금이탈 / 원달러와 동행</span>
                  {lastDX!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{Number(lastDX).toFixed(2)} {vl}</span>}
                </div>
                <CW h={210}>
                  <ComposedChart data={merged} margin={{top:8,right:4,left:0,bottom:8}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis yAxisId="dxy" tick={{fill:C.cyan,fontSize:9}} width={36} domain={["auto","auto"]} tickFormatter={v=>`${v}`}/>
                    <YAxis yAxisId="fx"  orientation="right" tick={{fill:C.gold,fontSize:9}} width={32} domain={["auto","auto"]} tickFormatter={v=>`${v}₩`}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine yAxisId="dxy" y={104} stroke={`${C.orange}66`} strokeDasharray="3 3"/>
                    <ReferenceLine yAxisId="dxy" y={108} stroke={`${C.red}55`}    strokeDasharray="3 3"/>
                    <Line yAxisId="dxy" dataKey="DXY"    name="DXY"    stroke={C.cyan} strokeWidth={2.5} dot={false} connectNulls/>
                    <Line yAxisId="fx"  dataKey="원달러" name="원달러" stroke={C.gold} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2"/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 구리/금 비율 */}
            {(macroData?.copperGold||[]).length>0&&(
            <Box>
              <ST accent={C.gold}>🔴 🇺🇸 구리/금 비율 — 경기기대 vs 안전자산 수요</ST>
              {(()=>{
                const data=(macroData.copperGold||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last<0.15?C.red:last<0.18?C.orange:last<0.25?C.gold:C.green;
                const vl=last==null?"":last<0.15?"위기":last<0.18?"경계":last<0.25?"중립":"경기호조";
                return(<>
                <div style={{background:`${C.gold}0e`,border:`1px solid ${C.gold}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.gold,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    구리는 산업에 쓰이는 금속, 금은 위기 때 피난처입니다. 이 둘의 가격 비율로
                    시장이 <span style={{color:C.gold,fontWeight:700}}>경기 회복을 기대하는지</span> vs <span style={{color:C.red,fontWeight:700}}>위기를 피하려는지</span>를 파악합니다.<br/>
                    비율이 <span style={{color:C.green,fontWeight:700}}>오를수록</span> 경기 낙관, <span style={{color:C.red,fontWeight:700}}>내려갈수록</span> 위기 회피 심리 확산.
                    ×1000 배율로 표시합니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 0.25↑","경기호조"],["🟡 0.18~0.25","중립"],["🟠 0.15~0.18","경계"],["🔴 0.15 미만","위기"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>구리(산업)/금(안전) 비율 상승 = 경기낙관 / 하락 = 위기회피</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{Number(last).toFixed(2)} {vl}</span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="cgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.gold} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.gold} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={44} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={0.15} stroke={`${C.red}66`}    strokeDasharray="3 3" label={{value:"위기 0.15",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={0.18} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"경계 0.18",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="구리/금(×1000)" stroke={C.gold} strokeWidth={2.5} fill="url(#cgGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 주간 실업청구건수 */}
            {(macroData?.fredICSA||[]).length>0&&(
            <Box>
              <ST accent={C.purple}>📉 🇺🇸 주간 실업청구건수 — 고용 악화 최조기 감지</ST>
              {(()=>{
                const data=(macroData.fredICSA||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last>=300?C.red:last>=250?C.orange:last>=210?C.gold:C.green;
                const vl=last==null?"":last>=300?"급등위험":last>=250?"경계":last>=210?"주의":"안정";
                return(<>
                <div style={{background:`${C.purple}0e`,border:`1px solid ${C.purple}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.purple,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    매주 미국에서 새로 실업수당을 신청한 사람 수입니다. 고용시장 악화를
                    <span style={{color:C.purple,fontWeight:700}}> 가장 빠르게</span> 알려주는 주간 지표입니다.<br/>
                    정상 구간은 <span style={{color:C.green,fontWeight:700}}>20만명(200k) 이하</span>. 수치가 오를수록 실직자 급증. 2020년 코로나 때 700k까지 폭등했습니다.
                    여기서는 월 평균값으로 표시합니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 210k 미만","안정"],["🟡 210~250k","주의"],["🟠 250~300k","경계"],["🔴 300k↑","침체신호"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>신규 실업수당 청구 · 250k↑ 경계 · 300k↑ 침체신호 (월 평균값)</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last}k {vl}</span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="icsaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.purple} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.purple} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v}k`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={300} stroke={`${C.red}66`}    strokeDasharray="3 3" label={{value:"침체 300k",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={250} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"경계 250k",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={210} stroke={`${C.gold}66`}   strokeDasharray="3 3" label={{value:"주의 210k",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="실업청구(k)" stroke={C.purple} strokeWidth={2.5} fill="url(#icsaGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 미국 실업률 */}
            {(macroData?.fredUNRATEMonthly||[]).length>0&&(
            <Box>
              <ST accent={C.blue}>👷 🇺🇸 미국 실업률 — 고용시장 건전성</ST>
              {(()=>{
                const data=(macroData.fredUNRATEMonthly||[]).slice(-60);
                const last=data.slice(-1)[0]?.value??null;
                const prev12=data.slice(-13)[0]?.value??null;
                const yoy=last!=null&&prev12!=null?+(last-prev12).toFixed(1):null;
                const vc=last==null?"#888":last>=5.5?C.red:last>=4.5?C.orange:last>=4.0?C.gold:C.green;
                const vl=last==null?"":last>=5.5?"침체":last>=4.5?"상승주의":last>=4.0?"보통":"호조";
                return(<>
                <div style={{background:`${C.blue}0e`,border:`1px solid ${C.blue}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.blue,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    미국 전체 노동인구 중 실업자 비율입니다. 경기 사이클의 후행 지표로,
                    <span style={{color:C.blue,fontWeight:700}}> 상승 전환 시 경기침체 신호</span>로 해석됩니다.<br/>
                    정상 구간은 <span style={{color:C.green,fontWeight:700}}>4% 이하</span>. 5.5% 이상이면 침체 구간입니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 4% 미만","호조"],["🟡 4~4.5%","보통"],["🟠 4.5~5.5%","상승주의"],["🔴 5.5%↑","침체"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>실업률 · 4.5%↑ 주의 · 5.5%↑ 침체신호 (월별)</span>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    {yoy!=null&&<span style={{fontSize:8,color:yoy>0?C.red:C.green,fontWeight:600}}>
                      YoY {yoy>0?"+":""}{yoy}%p
                    </span>}
                    {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last}% {vl}</span>}
                  </div>
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs><linearGradient id="unrateGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.blue} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.blue} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={11} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={32} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={5.5} stroke={`${C.red}66`}    strokeDasharray="3 3" label={{value:"침체 5.5%",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={4.5} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"주의 4.5%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={4.0} stroke={`${C.gold}66`}   strokeDasharray="3 3" label={{value:"보통 4.0%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="실업률(%)" stroke={C.blue} strokeWidth={2.5} fill="url(#unrateGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── BIZD ETF 가격 (참고용 — 지표 계산 미사용) */}
            {(macroData?.yahooBIZD||[]).length>0&&(
            <Box>
              <ST accent={C.teal}>🏦 🇺🇸 BIZD ETF 가격 — 사모신용 시장 체감 참고용</ST>
              {(()=>{
                const data=(macroData.yahooBIZD||[]).slice(-36);
                const last=data.slice(-1)[0]?.value??null;
                const peak=data.reduce((m,r)=>r.value>m?r.value:m,0);
                const drawdown=last&&peak?+((last/peak-1)*100).toFixed(1):null;
                const ddc=drawdown==null?"#888":drawdown<-20?C.red:drawdown<-10?C.orange:drawdown<-5?C.gold:C.green;
                const ddl=drawdown==null?"":drawdown<-20?"급락위험":drawdown<-10?"경계":drawdown<-5?"주의":"안정";
                return(<>
                {/* 해석 가이드 패널 */}
                <div style={{background:`${C.teal}10`,border:`1px solid ${C.teal}33`,borderRadius:8,padding:"8px 10px",marginBottom:6}}>
                  <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:4}}>📖 해석 가이드</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    BIZD는 BDC(Business Development Company) ETF로 중소기업·사모대출에 투자합니다.<br/>
                    <span style={{color:C.green,fontWeight:700}}>가격 상승</span> → 사모신용 시장 건전 · 대출 수요 양호 · 위험선호 확대<br/>
                    <span style={{color:C.red,fontWeight:700}}>가격 하락</span> → 사모신용 스트레스 · 부도 우려 증가 · 위험회피<br/>
                    <span style={{color:`${C.muted}aa`,fontStyle:"italic"}}>※ 배당수익률 역산 불가로 가격 추이만 참고 / 위험 산출은 위 HY 스프레드 사용</span>
                  </div>
                </div>
                {/* 현재값 + Drawdown */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",flexDirection:"column",gap:1}}>
                    <span style={{fontSize:7,color:C.muted}}>전고점 대비 낙폭 (3년내)</span>
                    <span style={{fontSize:8,color:C.muted}}>하락 -5% 주의 · -10% 경계 · -20% 위험</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}>
                    {last!=null&&<span style={{fontSize:11,fontWeight:700,color:C.muted,fontFamily:"monospace"}}>${last}</span>}
                    {drawdown!=null&&<span style={{fontSize:10,fontWeight:700,color:ddc,fontFamily:"monospace"}}>{drawdown}% {ddl}</span>}
                  </div>
                </div>
                <CW h={180}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs>
                      <linearGradient id="bizdGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.teal} stopOpacity={0.25}/>
                        <stop offset="100%" stopColor={C.teal} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`$${v}`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    {peak>0&&<ReferenceLine y={peak}           stroke={`${C.green}66`} strokeDasharray="3 3" label={{value:`전고점 $${peak.toFixed(0)}`,fill:C.green,fontSize:7,position:"insideTopLeft"}}/>}
                    {peak>0&&<ReferenceLine y={+(peak*0.9).toFixed(2)} stroke={`${C.orange}55`} strokeDasharray="2 3" label={{value:"-10%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>}
                    {peak>0&&<ReferenceLine y={+(peak*0.8).toFixed(2)} stroke={`${C.red}55`}    strokeDasharray="2 3" label={{value:"-20%",fill:C.red,fontSize:7,position:"insideTopRight"}}/>}
                    <Area dataKey="value" name="BIZD가격" stroke={`${C.teal}aa`} strokeWidth={2} fill="url(#bizdGrad)" dot={false} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 거시 신호등 (매크로탭 맨 위로 이동됨) */}

            {/* ── 🇰🇷 한국 M2 통화량 — 유동성 제1지표 */}
            {(macroData?.krM2YoY||[]).length>0&&(
            <Box>
              <ST accent={C.teal}>💧 🇰🇷 한국 M2 통화량 — 유동성 공급의 핵심 선행지표</ST>
              {(()=>{
                const krRaw=(macroData.krM2YoY||[]).slice(-48);
                const lastKrYoY=[...krRaw].reverse().find(r=>r.yoy!=null)?.yoy??null;
                const sigColor=(v)=>v==null?"#888":v<0?C.red:v<=5?C.green:v<=10?C.gold:C.orange;
                const sigLabel=(v)=>v==null?"-":v<0?"긴축경고":v<=5?"정상":v<=10?"주의":"버블위험";
                const krChartData=krRaw.filter(r=>r.yoy!=null).map(r=>({date:r.date,절대값:r.value,YoY:r.yoy}));
                const addMoM=(arr)=>arr.map((d,i)=>{
                  if(i===0)return{...d,MoM:null};
                  const prev=arr[i-1].절대값;
                  return{...d,MoM:prev?+(((d.절대값/prev)-1)*100).toFixed(2):null};
                });
                const krChart=addMoM(krChartData);
                return(<>
                <div style={{background:`${C.teal}0e`,border:`1px solid ${C.teal}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    시중에 풀린 원화의 총량입니다. M2 급증은 자산가격 버블의 연료, M2 급감은 유동성 경색·주가 하락의 신호입니다.<br/>
                    <span style={{color:C.red,fontWeight:700}}>감소(&lt;0%)</span> → 긴축경고 &nbsp;
                    <span style={{color:C.green,fontWeight:700}}>정상(0~5%)</span> → 양호 &nbsp;
                    <span style={{color:C.gold,fontWeight:700}}>주의(5~10%)</span> → 과잉주의 &nbsp;
                    <span style={{color:C.orange,fontWeight:700}}>급증(&gt;10%)</span> → 버블위험
                  </div>
                </div>
                <div style={{background:C.card2,border:`1px solid ${sigColor(lastKrYoY)}44`,borderRadius:8,padding:"7px 10px",marginBottom:8}}>
                  <div style={{color:C.muted,fontSize:7,marginBottom:2}}>🇰🇷 한국 M2 YoY</div>
                  <div style={{color:sigColor(lastKrYoY),fontSize:18,fontWeight:900,fontFamily:"monospace"}}>
                    {lastKrYoY!=null?`${lastKrYoY>0?"+":""}${lastKrYoY}%`:"-"}
                  </div>
                  <div style={{color:sigColor(lastKrYoY),fontSize:8,fontWeight:700,marginTop:1}}>{sigLabel(lastKrYoY)}</div>
                  <div style={{color:`${C.muted}77`,fontSize:7,marginTop:2}}>ECOS 161Y006 · M2 광의통화 평잔 · 십억원</div>
                </div>
                {krChart.length>0&&(<>
                <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:4}}>🇰🇷 한국 M2 YoY% · MoM% (최근 48개월)</div>
                <div style={{display:"flex",gap:12,marginBottom:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:7,color:`${C.muted}cc`}}>
                    <span style={{color:C.teal,fontWeight:700}}>── YoY%</span> 전년동월 대비 증가율 · 추세 방향 (버블/긴축 판단)
                  </span>
                  <span style={{fontSize:7,color:`${C.muted}cc`}}>
                    <span style={{color:C.green,fontWeight:700}}>▌MoM%</span> 전월 대비 증가율 · 속도 변화 (꺾임/반등 감지)
                  </span>
                </div>
                <CW h={180}>
                  <ComposedChart data={krChart} margin={{top:4,right:16,left:0,bottom:4}}>
                    <defs>
                      <linearGradient id="krM2Grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.teal} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.teal} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:8}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis yAxisId="yoy" tick={{fill:C.muted,fontSize:8}} width={32} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <YAxis yAxisId="mom" orientation="right" tick={{fill:C.muted,fontSize:8}} width={28} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine yAxisId="yoy" y={0}  stroke={C.muted}         strokeWidth={1} strokeDasharray="4 2"/>
                    <ReferenceLine yAxisId="yoy" y={10} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"버블 10%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine yAxisId="yoy" y={5}  stroke={`${C.gold}66`}   strokeDasharray="3 3" label={{value:"주의 5%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area yAxisId="yoy" dataKey="YoY" name="YoY%" stroke={C.teal} strokeWidth={2} fill="url(#krM2Grad)" dot={false} connectNulls/>
                    <Bar  yAxisId="mom" dataKey="MoM" name="MoM%" fill={C.green} opacity={0.5} radius={[2,2,0,0]}/>
                  </ComposedChart>
                </CW>
                <div style={{color:`${C.muted}55`,fontSize:7,textAlign:"right",marginTop:4}}>
                  ECOS 161Y006 · M2 광의통화 평잔 원계열 · 십억원 기준
                </div>
                </>)}
                </>);
              })()}
            </Box>
            )}

            {/* ── 수출+코스피 동행 */}
            {macroMerged.length>0&&(
              <Box>
                <ST accent={C.teal}>🇰🇷 일평균수출 · 코스피 동행 추이 (정규화 비교)</ST>
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
                  <div style={{background:`${C.teal}0e`,border:`1px solid ${C.teal}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      한국 경제의 두 핵심 엔진인 <span style={{color:C.teal,fontWeight:700}}>수출과 코스피</span>를 Z-Score로 정규화해 같은 축에 비교합니다.
                      수출은 실물경기 선행지표, 코스피는 기대심리 지표로 두 선의 <span style={{color:C.gold,fontWeight:700}}>괴리(Gap)</span>가 핵심입니다.<br/>
                      코스피가 수출보다 크게 앞서면 <span style={{color:C.red,fontWeight:700}}>과열(밸류에이션 부담)</span>, 크게 뒤처지면 <span style={{color:C.green,fontWeight:700}}>저평가(반등 기회)</span> 신호입니다.
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                      {[["🔴 +1.5σ↑","강한 과열"],["🟠 +0.5~1.5σ","과열"],["🟡 ±0.5σ","중립"],["🟢 -1.5σ↓","저평가"]].map(([r,l])=>(
                        <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                      ))}
                    </div>
                  </div>
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
                  {(()=>{const ppiJudge=lastPPI==null?{t:"—",c:C.muted}:lastPPI>6?{t:`+${lastPPI}% 🔴 원가위기`,c:C.red}:lastPPI>3?{t:`+${lastPPI}% 🟠 압박`,c:C.orange}:lastPPI>0?{t:`+${lastPPI}% 🟡 안정`,c:C.gold}:lastPPI>-3?{t:`${lastPPI}% 🟢 디플레`,c:C.green}:{t:`${lastPPI}% 🔵 급디플레`,c:C.cyan};return(<ST accent={C.orange} right={<span style={{color:ppiJudge.c,fontWeight:700,fontFamily:"monospace",fontSize:10}}>{ppiJudge.t}</span>}>🇰🇷 PPI — 원가 압력 선행지표</ST>);})()}
                  <div style={{background:`${C.orange}0e`,border:`1px solid ${C.orange}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:C.orange,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      기업이 물건을 만들 때 드는 <span style={{color:C.orange,fontWeight:700}}>원자재·중간재 가격 변화율</span>입니다. 소비자물가(CPI)보다 <span style={{color:C.gold,fontWeight:700}}>1~3개월 선행</span>하는 인플레이션 선행지표입니다.<br/>
                      PPI가 오르면 기업 수익성이 악화되고 이후 소비자가격 인상으로 이어집니다. <span style={{color:C.red,fontWeight:700}}>+3% 이상</span>이면 원가 압박 경고 구간입니다.
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                      {[["🟢 0% 미만","디플레"],["🟡 0~3%","안정"],["🟠 3~6%","주의"],["🔴 6%↑","원가 위기"]].map(([r,l])=>(
                        <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                      ))}
                    </div>
                  </div>
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
                    <ST accent={C.purple}>🇰🇷 BSI 제조업 — 경기 방향성 선행</ST>
                    {lastMA6&&trend&&(
                      <span style={{fontSize:10,fontWeight:700,color:trendColor,fontFamily:"monospace",marginBottom:4}}>
                        6MA {lastMA6.ma6} {trend}
                      </span>
                    )}
                  </div>
                  <div style={{background:`${C.purple}0e`,border:`1px solid ${C.purple}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                    <div style={{color:C.purple,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                    <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                      제조업체 경영자가 체감하는 <span style={{color:C.purple,fontWeight:700}}>경기 상황을 매월 설문</span>한 지수입니다. <span style={{color:C.gold,fontWeight:700}}>100 이상</span>이면 확장(긍정 응답 多), 100 이하면 수축(부정 응답 多)을 의미합니다.<br/>
                      실물 데이터보다 <span style={{color:C.purple,fontWeight:700}}>1~2개월 선행</span>하며, 6개월 이동평균 추세가 핵심입니다. 연속 하락 시 경기 둔화 신호입니다.
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                      {[["🔴 85↓","침체"],["🟠 85~95","수축"],["🟡 95~100","둔화"],["🟢 100↑","확장"]].map(([r,l])=>(
                        <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                      ))}
                    </div>
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
              <ST accent={C.orange}>🇰🇷 가계신용 증가율 (전년동기비 %)</ST>
              {(()=>{
                const data=(macroData.hhCreditYoY||[]).filter(r=>r.yoy!=null);
                const last=data.slice(-1)[0];
                const v=last?.yoy??null;
                const vc=v==null?"#888":v>=8?C.red:v>=5?C.orange:v>=2?C.gold:C.green;
                const vl=v==null?"":v>=8?"과열":v>=5?"경계":v>=2?"완만":"감소";
                return(<>
                <div style={{background:`${C.orange}0e`,border:`1px solid ${C.orange}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.orange,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    가계가 빌린 돈(대출+카드할부)의 <span style={{color:C.orange,fontWeight:700}}>전년 대비 증가율</span>입니다. 레이 달리오의 <span style={{color:C.gold,fontWeight:700}}>단기 부채사이클</span> 핵심 지표입니다.<br/>
                    너무 빠르게 늘면 자산 버블과 금융 불안정 위험이 높아집니다. <span style={{color:C.red,fontWeight:700}}>+8% 이상</span>은 과열 경고, <span style={{color:C.green,fontWeight:700}}>감소세</span>는 디레버리징 진행을 의미합니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 0% 미만","감소/안정"],["🟡 0~2%","완만"],["🟠 2~5%","주의"],["🔴 5~8%","경계"],["🔴🔴 8%↑","과열"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
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
              <ST accent={C.teal}>🇰🇷 장단기 금리차 — 국고채 10Y − 3Y (%p)</ST>
              {(()=>{
                const data=macroData.yieldSpread||[];
                const last=data.slice(-1)[0];
                const v=last?.value??null;
                const vc=v==null?"#888":v<-0.5?C.red:v<0?C.orange:v<0.5?C.gold:C.green;
                const vl=v==null?"":v<-0.5?"역전":v<0?"평탄":v<0.5?"보통":"정상화";
                return(<>
                <div style={{background:`${C.teal}0e`,border:`1px solid ${C.teal}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    국고채 10년물 금리에서 3년물 금리를 뺀 값입니다. 정상적으로는 장기금리가 더 높아 <span style={{color:C.teal,fontWeight:700}}>양수(+)</span>를 유지합니다.<br/>
                    이 값이 <span style={{color:C.red,fontWeight:700}}>0 이하로 역전</span>되면 시장이 단기 경기를 비관한다는 신호입니다. 미국 T10Y2Y와 함께 <span style={{color:C.gold,fontWeight:700}}>경기침체 선행 6~18개월</span> 전 역전이 나타납니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🔴 0↓","역전(위험)"],["🟠 0~+0.3%p","평탄"],["🟡 +0.3~+0.5%p","보통"],["🟢 +0.5%p↑","정상화"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
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

            {/* ── 미국/한국 M2 통화량 — 유동성 제1순위 지표 */}
            {/* M2 블록 분리됨: 미국→미국 섹션 첫번째, 한국→한국 섹션 첫번째 */}
            {((macroData?.usM2YoY||[]).length>0||(macroData?.krM2YoY||[]).length>0)&&false&&(
            <Box>
              <ST accent={C.blue}>💧 미국/한국 M2 통화량 — 유동성 공급의 핵심 선행지표</ST>
              {(()=>{
                const usRaw=(macroData.usM2YoY||[]).slice(-36);
                const krRaw=(macroData.krM2YoY||[]).slice(-36);
                // 최신 YoY 값
                const lastUsYoY=[...usRaw].reverse().find(r=>r.yoy!=null)?.yoy??null;
                const lastKrYoY=[...krRaw].reverse().find(r=>r.yoy!=null)?.yoy??null;
                const sigColor=(v)=>v==null?"#888":v<0?C.red:v<=5?C.green:v<=10?C.gold:C.orange;
                const sigLabel=(v)=>v==null?"-":v<0?"긴축경고":v<=5?"정상":v<=10?"주의":"버블위험";
                // 미국 M2 절대값 + YoY 차트 데이터
                const usChartData=usRaw.filter(r=>r.yoy!=null).map(r=>({date:r.date,절대값:r.value,YoY:r.yoy}));
                const krChartData=krRaw.filter(r=>r.yoy!=null).map(r=>({date:r.date,절대값:r.value,YoY:r.yoy}));
                // MoM 계산 (절대값 전월비%)
                const addMoM=(arr)=>arr.map((d,i)=>{
                  if(i===0)return{...d,MoM:null};
                  const prev=arr[i-1].절대값;
                  return{...d,MoM:prev?+(((d.절대값/prev)-1)*100).toFixed(2):null};
                });
                const usChart=addMoM(usChartData);
                const krChart=addMoM(krChartData);
                return(<>
                <div style={{background:`${C.blue}0e`,border:`1px solid ${C.blue}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.blue,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    시중에 풀린 돈의 총량입니다. M2 급증은 자산가격 버블의 연료가 되고,
                    M2 급감은 유동성 경색·주가 하락의 신호입니다.<br/>
                    <span style={{color:C.red,fontWeight:700}}>감소(&lt;0%)</span> → 긴축경고 &nbsp;
                    <span style={{color:C.green,fontWeight:700}}>정상(0~5%)</span> → 양호 &nbsp;
                    <span style={{color:C.gold,fontWeight:700}}>주의(5~10%)</span> → 과잉주의 &nbsp;
                    <span style={{color:C.orange,fontWeight:700}}>급증(&gt;10%)</span> → 버블위험
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 0~5%","정상·양호"],["🟡 5~10%","과잉주의"],["🟠 10%↑","버블위험"],["🔴 0% 미만","긴축경고"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                {/* 현재값 요약 */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                  {[["🇺🇸 미국 M2",lastUsYoY,"M2SL · FRED"],[" 🇰🇷 한국 M2",lastKrYoY,"101Y004 · ECOS"]].map(([title,v,src])=>(
                    <div key={title} style={{background:C.card2,border:`1px solid ${sigColor(v)}44`,borderRadius:8,padding:"7px 10px"}}>
                      <div style={{color:C.muted,fontSize:7,marginBottom:2}}>{title}</div>
                      <div style={{color:sigColor(v),fontSize:15,fontWeight:900,fontFamily:"monospace"}}>
                        {v!=null?`${v>0?"+":""}${v}%`:"-"}
                      </div>
                      <div style={{color:sigColor(v),fontSize:8,fontWeight:700,marginTop:1}}>{sigLabel(v)}</div>
                      <div style={{color:`${C.muted}77`,fontSize:7,marginTop:2}}>{src}</div>
                    </div>
                  ))}
                </div>
                {/* 미국 M2 YoY + MoM 차트 */}
                {usChart.length>0&&(<>
                <div style={{color:C.blue,fontSize:8,fontWeight:700,marginBottom:4}}>🇺🇸 미국 M2 YoY% · MoM%</div>
                <CW h={180}>
                  <ComposedChart data={usChart} margin={{top:4,right:16,left:0,bottom:4}}>
                    <defs>
                      <linearGradient id="usM2Grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.blue} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.blue} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:8}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis yAxisId="yoy" tick={{fill:C.muted,fontSize:8}} width={32} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <YAxis yAxisId="mom" orientation="right" tick={{fill:C.muted,fontSize:8}} width={28} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine yAxisId="yoy" y={0}  stroke={C.muted}         strokeWidth={1} strokeDasharray="4 2"/>
                    <ReferenceLine yAxisId="yoy" y={10} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"버블 10%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine yAxisId="yoy" y={5}  stroke={`${C.gold}66`}   strokeDasharray="3 3" label={{value:"주의 5%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area yAxisId="yoy" dataKey="YoY" name="YoY%" stroke={C.blue} strokeWidth={2} fill="url(#usM2Grad)" dot={false} connectNulls/>
                    <Bar  yAxisId="mom" dataKey="MoM" name="MoM%" fill={C.cyan} opacity={0.5} radius={[2,2,0,0]}/>
                  </ComposedChart>
                </CW>
                </>)}
                {/* 한국 M2 YoY + MoM 차트 */}
                {krChart.length>0&&(<>
                <div style={{color:C.teal,fontSize:8,fontWeight:700,margin:"10px 0 4px"}}>🇰🇷 한국 M2 YoY% · MoM%</div>
                <CW h={180}>
                  <ComposedChart data={krChart} margin={{top:4,right:16,left:0,bottom:4}}>
                    <defs>
                      <linearGradient id="krM2Grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.teal} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.teal} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:8}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis yAxisId="yoy" tick={{fill:C.muted,fontSize:8}} width={32} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <YAxis yAxisId="mom" orientation="right" tick={{fill:C.muted,fontSize:8}} width={28} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine yAxisId="yoy" y={0}  stroke={C.muted}         strokeWidth={1} strokeDasharray="4 2"/>
                    <ReferenceLine yAxisId="yoy" y={10} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"버블 10%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine yAxisId="yoy" y={5}  stroke={`${C.gold}66`}   strokeDasharray="3 3" label={{value:"주의 5%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area yAxisId="yoy" dataKey="YoY" name="YoY%" stroke={C.teal} strokeWidth={2} fill="url(#krM2Grad)" dot={false} connectNulls/>
                    <Bar  yAxisId="mom" dataKey="MoM" name="MoM%" fill={C.green} opacity={0.5} radius={[2,2,0,0]}/>
                  </ComposedChart>
                </CW>
                <div style={{color:`${C.muted}55`,fontSize:7,textAlign:"right",marginTop:4}}>
                  미국: FRED M2SL (십억달러) · 한국: ECOS 101Y004 광의통화 M2 (십억원)
                </div>
                </>)}
                </>);
              })()}
            </Box>
            )}

            {/* ── 외국인 KOSPI 순매수 */}
            {(macroData?.foreignNet3M||[]).length>0&&(
            <Box>
              <ST accent={C.teal}>🌏 🇰🇷 외국인 KOSPI 순매수 (월별) — 자금 흐름</ST>
              {(()=>{
                const data=(macroData.foreignNet3M||[]).filter(r=>r.ma3!=null).slice(-36);
                const raw=(macroData.foreignNet||[]).slice(-3);
                const negCnt=raw.filter(r=>r.value<0).length;
                const last=data.slice(-1)[0]?.ma3??null;
                const vc=negCnt>=3?C.red:negCnt>=2?C.orange:negCnt===0?C.green:C.gold;
                const vl=negCnt>=3?"3개월 연속 순매도":negCnt>=2?"매도 우세":negCnt===0?"3개월 연속 순매수":"혼조";
                return(<>
                <div style={{background:`${C.teal}0e`,border:`1px solid ${C.teal}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.teal,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    외국인이 KOSPI에서 월별로 사고판 차이(순매수)와 3개월 이동평균 흐름을 함께 봅니다. 
                    외국인은 KOSPI 시총의 <span style={{color:C.teal,fontWeight:700}}>30%+를 보유</span>해 이들의 이탈은 즉각적인 하락 압력으로 이어집니다.<br/>
                    3개월 연속 순매도는 위험 신호, 3개월 연속 순매수는 안정 신호입니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 3개월연속 순매수","안정"],["🟡 혼조","주의"],["🟠 2개월 매도우세","경계"],["🔴 3개월연속 순매도","위험"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>외국인 순매수 3개월 이동평균 :</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>
                    {(()=>{const a=Math.abs(last);const s=last>=0?"+":"-";return a>=10000?`${s}${(a/10000).toFixed(1)}조 ${vl}`:`${s}${Math.round(a).toLocaleString()}억 ${vl}`;})()} 
                  </span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs>
                      <linearGradient id="foreignPos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.green} stopOpacity={0.3}/>
                        <stop offset="100%" stopColor={C.green} stopOpacity={0.02}/>
                      </linearGradient>
                      <linearGradient id="foreignNeg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.red} stopOpacity={0.02}/>
                        <stop offset="100%" stopColor={C.red} stopOpacity={0.3}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={5} tickFormatter={v=>v?.slice(0,6)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={44} tickFormatter={v=>{const a=Math.abs(v);const s=v<0?"-":"";return a>=10000?`${s}${(a/10000).toFixed(1)}조`:`${s}${Math.round(a).toLocaleString()}억`;}} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={0} stroke={`${C.muted}66`} strokeDasharray="3 3" label={{value:"기준선",fill:C.muted,fontSize:7,position:"insideTopRight"}}/>
                    <Bar dataKey="ma3" name="외국인순매수(억)" fill={C.teal} opacity={0.6} radius={[2,2,0,0]}
                      label={false}
                      {...{cell: data.map((d,i)=>(
                        {key:i, fill: d.ma3>=0?C.green:C.red}
                      ))}}
                    />
                    <Tooltip cursor={false} content={({active,payload,label})=>{
                      if(!active||!payload?.length)return null;
                      const v=payload[0]?.value;
                      if(v==null)return null;
                      const a=Math.abs(v);
                      const s=v>=0?"+":"-";
                      const disp=a>=10000?`${s}${(a/10000).toFixed(1)}조`:`${s}${Math.round(a).toLocaleString()}억`;
                      return(<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 11px",fontSize:11}}>
                        <div style={{color:C.gold,fontWeight:700,marginBottom:3,fontFamily:"monospace"}}>{label}</div>
                        <div style={{color:v>=0?C.green:C.red,fontWeight:700,fontFamily:"monospace"}}>외국인 순매수 3MA: {disp}</div>
                      </div>);
                    }}/> 
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}

            {/* ── 한국 가계부채/GDP 비율 */}
            {(macroData?.hhDebtGDP||[]).length>0&&(
            <Box>
              <ST accent={C.orange}>📊 한국 가계부채/GDP 비율 — ECOS 협의 기준 부채 건전성</ST>
              {(()=>{
                const data=(macroData.hhDebtGDP||[]).slice(-20);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last>=82?C.red:last>=75?C.orange:last>=65?C.gold:C.green;
                const vl=last==null?"":last>=82?"위험":last>=75?"경계":last>=65?"주의":"안정";
                return(<>
                <div style={{background:`${C.orange}0e`,border:`1px solid ${C.orange}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.orange,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    한국 가계가 진 빚(가계신용 잔액)이 국내총생산(GDP) 대비 얼마나 되는지를 나타냅니다.
                    ECOS 가계신용(151Y001) ÷ 연간 명목GDP(200Y113) 기준으로 산출한 협의 지표입니다.<br/>
                    BIS 광의 기준(~105%)과 정의가 다릅니다. 현재 약 77%는 <span style={{color:C.gold,fontWeight:700}}>주의 구간</span>으로,
                    높을수록 금리 인상 시 가계 부실 위험이 커집니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 65% 미만","안정"],["🟡 65~75%","주의"],["🟠 75~82%","경계"],["🔴 82%↑","위험"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>가계신용잔액 ÷ 연간 명목GDP × 100 · ECOS 협의 기준</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last}% {vl}</span>}
                </div>
                <CW h={210}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs>
                      <linearGradient id="debtGdpGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.orange} stopOpacity={0.35}/>
                        <stop offset="100%" stopColor={C.orange} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={3} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={40} tickFormatter={v=>`${v}%`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceArea y1={82} y2={120} fill={`${C.red}08`}/>
                    <ReferenceLine y={82} stroke={`${C.red}77`}    strokeDasharray="3 3" label={{value:"위험 82%",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={75} stroke={`${C.orange}77`} strokeDasharray="3 3" label={{value:"경계 75%",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={65} stroke={`${C.gold}77`}   strokeDasharray="3 3" label={{value:"주의 65%",fill:C.gold,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="가계부채/GDP" stroke={C.orange} strokeWidth={2.5}
                      fill="url(#debtGdpGrad)" dot={{fill:C.orange,r:3}} connectNulls/>
                  </ComposedChart>
                </CW>
                <div style={{color:`${C.muted}55`,fontSize:7,textAlign:"right",marginTop:4}}>
                  산출: 가계신용잔액(ECOS 151Y001) ÷ 연간명목GDP(ECOS 200Y113) × 100 · BIS 광의 기준(~105%)과 정의 상이
                </div>
                </>);
              })()}
            </Box>
            )}

            {/* ── 한국 은행 대출태도지수 (한국판 SLOOS) */}
            {(macroData?.krSloos||[]).length>0&&(
            <Box>
              <ST accent={C.red}>🏛 한국 대출태도지수 — 국내 신용경색 선행 1~2분기</ST>
              {(()=>{
                const data=(macroData.krSloos||[]).slice(-20);
                const last=data.slice(-1)[0]?.value??null;
                const vc=last==null?"#888":last>=40?C.red:last>=20?C.orange:last>=-5?C.gold:C.green;
                const vl=last==null?"":last>=40?"극단강화":last>=20?"경계":last>=-5?"중립":"완화";
                return(<>
                <div style={{background:`${C.red}0e`,border:`1px solid ${C.red}22`,borderRadius:8,padding:"7px 10px",marginBottom:6}}>
                  <div style={{color:C.red,fontSize:8,fontWeight:700,marginBottom:3}}>📖 이 지표가 뭔가요?</div>
                  <div style={{color:`${C.muted}cc`,fontSize:7,lineHeight:1.8}}>
                    한국은행이 분기마다 국내 은행에 설문하는 대출태도 지수입니다.
                    미국 SLOOS의 한국판으로, <span style={{color:C.red,fontWeight:700}}>국내 가계·기업 신용경색</span>을 측정합니다.<br/>
                    <span style={{color:C.red,fontWeight:700}}>양수(+)</span>면 은행이 대출 기준을 올려 돈 빌리기 어려워진 상태.
                    <span style={{color:C.green,fontWeight:700}}> 음수(−)</span>면 대출 기준 완화로 자금 조달이 쉬워진 상태입니다.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    {[["🟢 -5 미만","완화"],["🟡 -5~20","중립"],["🟠 20~40","긴축경계"],["🔴 40↑","극단긴축"]].map(([r,l])=>(
                      <span key={r} style={{fontSize:7,color:`${C.muted}cc`}}>{r} <span style={{color:C.muted}}>{l}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:C.card2,borderRadius:8,padding:"6px 10px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:8,color:C.muted}}>한국은행 대출행태서베이(514Y001) · 국내은행 차주가중종합지수</span>
                  {last!=null&&<span style={{fontSize:11,fontWeight:700,color:vc,fontFamily:"monospace"}}>{last>0?"+":""}{last} {vl}</span>}
                </div>
                <CW h={200}>
                  <ComposedChart data={data} margin={{top:8,right:16,left:0,bottom:8}}>
                    <defs>
                      <linearGradient id="krSloosGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.red} stopOpacity={0.35}/>
                        <stop offset="100%" stopColor={C.red} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={{stroke:C.border}} interval={3} tickFormatter={v=>v?.slice(0,4)||""}/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} width={36} tickFormatter={v=>`${v>0?"+":""}${v}`} domain={["auto","auto"]}/>
                    <Tooltip content={<MTip/>} cursor={false}/>
                    <ReferenceLine y={0}  stroke={C.muted}         strokeWidth={1.5} strokeDasharray="4 2"/>
                    <ReferenceLine y={40} stroke={`${C.red}66`}    strokeDasharray="3 3" label={{value:"극단 40",fill:C.red,fontSize:7,position:"insideTopRight"}}/>
                    <ReferenceLine y={20} stroke={`${C.orange}66`} strokeDasharray="3 3" label={{value:"경계 20",fill:C.orange,fontSize:7,position:"insideTopRight"}}/>
                    <Area dataKey="value" name="대출태도" stroke={C.red} strokeWidth={2.5} fill="url(#krSloosGrad)" dot={{fill:C.red,r:3}} connectNulls/>
                  </ComposedChart>
                </CW>
                </>);
              })()}
            </Box>
            )}
            </> /* macro 탭 끝 */}

            {/* ══ 코스피 섹션 ══ */}
            {marketSub==="kospi"&&(
            <>
            {/* ── 코스피 기술분석 */}
            {kospiMonthly.length>0?(
              <Box>
                <IndexChart title="코스피" maData={kospiMA} rsiData={kospiRSI} macdData={kospiMACD} obvData={kospiOBV} mfiData={kospiMFI} color="#38BDF8"/>
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
                <IndexChart title="코스닥" maData={kosdaqMA} rsiData={kosdaqRSI} macdData={kosdaqMACD} obvData={kosdaqOBV} mfiData={kosdaqMFI} color={C.purple}/>
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
          <div style={{color:C.gold,fontSize:11,fontWeight:700}}>🌲 Sequoia Economic & Financial CONdition</div>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            <Tag color={C.blue}   size={8}>FRED · Federal Reserve</Tag>
            <Tag color={C.teal}   size={8}>ECOS · 한국은행</Tag>
            <Tag color={C.green}  size={8}>DART · 금융감독원</Tag>
            <Tag color={C.purple} size={8}>Yahoo Finance</Tag>
            <Tag color={C.gold}   size={8}>투자참고용</Tag>
          </div>
        </div>
      </div>

      {/* ── Copyright Footer */}
      <div style={{
        textAlign:"center",padding:"20px 16px 28px",
        borderTop:`1px solid ${C.border}`,marginTop:24,
      }}>
        <div style={{
          color:`${C.muted}99`,fontSize:10,fontWeight:700,
          letterSpacing:"0.08em",fontFamily:"monospace",marginBottom:4,
        }}>
          Copyright © 2026 SEQUOIA QUANTUM™. All Rights Reserved.
        </div>
        <div style={{
          color:`${C.muted}55`,fontSize:7.5,fontWeight:400,
          fontFamily:"monospace",letterSpacing:"0.04em",
        }}>
          Any violation of data integrity or unauthorized access will be subject to immediate legal action and system exclusion.
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
