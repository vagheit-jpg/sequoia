import {
  calcMACD,
  calcRSI,
  calcOBV,
  calcMFI,
  calcMA60,
  calcPositionBands,
} from "./technicalEngine";

import { buildBubbleEnergyModel } from "./bubbleEngine";

const sqClamp = (v, min, max) => Math.min(max, Math.max(min, v));

const sqNum = (v, d = 2) =>
  Number.isFinite(Number(v)) ? +Number(v).toFixed(d) : null;

const sqMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const buildAegisMarketSnapshot=({market,monthly,macroData})=>{
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
