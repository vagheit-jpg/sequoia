import { ema } from "./mathEngine";
import { DARK } from "../constants/theme";

export const calcMACD = (monthly) => {
  const cl = monthly.map((d) => d.price);
  const e12 = ema(cl, 12);
  const e26 = ema(cl, 26);
  const macd = cl.map((_, i) => +(e12[i] - e26[i]));
  const sig = ema(macd, 9);

  return monthly.map((d, i) => ({
    ...d,
    macd: macd[i],
    signal: sig[i],
    hist: +(macd[i] - sig[i]),
  }));
};

export const calcRSI = (monthly, n = 14) =>
  monthly.map((d, i) => {
    if (i < n) return { ...d, rsi: null };

    const sl = monthly.slice(i - n + 1, i + 1);
    let g = 0;
    let l = 0;

    for (let j = 1; j < sl.length; j++) {
      const df = sl[j].price - sl[j - 1].price;
      if (df > 0) g += df;
      else l -= df;
    }

    return {
      ...d,
      rsi: +(l === 0 ? 100 : 100 - 100 / (1 + g / l)).toFixed(1),
    };
  });

export const calcOBV = (monthly) => {
  let obv = 0;

  return monthly.map((d, i) => {
    if (i === 0) return { ...d, obv: 0 };

    obv +=
      d.price > monthly[i - 1].price
        ? d.volume
        : d.price < monthly[i - 1].price
          ? -d.volume
          : 0;

    return { ...d, obv };
  });
};

export const calcMFI = (monthly, n = 14) =>
  monthly.map((d, i) => {
    if (i < n) return { ...d, mfi: null };

    const sl = monthly.slice(i - n + 1, i + 1);
    let pos = 0;
    let neg = 0;

    sl.forEach((s, j) => {
      if (j === 0) return;

      const mfr = s.price * s.volume;
      if (s.price > sl[j - 1].price) pos += mfr;
      else neg += mfr;
    });

    return {
      ...d,
      mfi: +(neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)).toFixed(1),
    };
  });

export const calcMA60 = (monthly) => {
  const len = monthly.length;
  const N = len >= 60 ? 60 : len >= 15 ? 15 : len >= 3 ? len : 0;

  if (N === 0) {
    return monthly.map((d) => ({ ...d, ma60: null, gap60: null }));
  }

  return monthly.map((d, i) => {
    if (i < N - 1) return { ...d, ma60: null, gap60: null };

    const avg = monthly
      .slice(i - N + 1, i + 1)
      .reduce((s, x) => s + x.price, 0) / N;

    return {
      ...d,
      ma60: +avg.toFixed(0),
      gap60: +((d.price / avg - 1) * 100).toFixed(2),
    };
  });
};

export const calcMAN = (monthly, N) => {
  if (!monthly || monthly.length < N) return null;

  const slice = monthly.slice(-N);
  return Math.round(slice.reduce((s, x) => s + x.price, 0) / N);
};

export const calcSignalPoints = (data) => {
  const pts = [];

  data.forEach((d, i) => {
    if (d.gap60 === null || d.ma60 === null) return;

    const prev = i > 0 ? data[i - 1] : null;
    if (!prev || prev.gap60 === null) return;

    if (prev.gap60 > -20 && d.gap60 <= -20) {
      pts.push({ label: d.label, price: d.price, type: "적극매수", color: "#00C878", arrow: "▲", pos: "bottom" });
    } else if (prev.gap60 > 0 && d.gap60 <= 0) {
      pts.push({ label: d.label, price: d.price, type: "매수", color: "#10A898", arrow: "▲", pos: "bottom" });
    } else if (prev.gap60 < 100 && d.gap60 >= 100) {
      pts.push({ label: d.label, price: d.price, type: "매도", color: "#FF7830", arrow: "▼", pos: "top" });
    } else if (prev.gap60 < 200 && d.gap60 >= 200) {
      pts.push({ label: d.label, price: d.price, type: "적극매도", color: "#FF3D5A", arrow: "▼", pos: "top" });
    } else if (prev.gap60 < 300 && d.gap60 >= 300) {
      pts.push({ label: d.label, price: d.price, type: "극단매도", color: "#8855FF", arrow: "▼", pos: "top" });
    }
  });

  return pts;
};

export const calcPositionBands = (monthly) => {
  if (!monthly || monthly.length === 0) return [];

  return monthly.map((d, i) => {
    const currentWindowSize = Math.min(i + 1, 60);

    if (currentWindowSize < 3) {
      return {
        ...d,
        bFloor: null,
        bKnee: null,
        bBase: null,
        bShoulder: null,
        bTop: null,
        bPeak: null,
      };
    }

    const window = monthly.slice(
      i - currentWindowSize + 1,
      i + 1
    );

    const sum = window.reduce(
      (s, x) => s + (x.price || 0),
      0
    );

    const ma = sum / window.length;

    return {
      ...d,
      bFloor: Math.round(ma * 0.6),
      bKnee: Math.round(ma * 0.8),
      bBase: Math.round(ma * 1.0),
      bShoulder: Math.round(ma * 1.5),
      bTop: Math.round(ma * 2.0),
      bPeak: Math.round(ma * 2.5),
    };
  });
};

export const calc3LineSignal=(monthly, fin={})=>{
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

export const buildBandsFromQtr=(monthly,qtrData,annData,bandCfg)=>{
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

// ─────────────────────────────────────────────
//  SMA 수급 시그널 → 차트 마커용
//  월봉 기준 SUPERNOVA / ACCUMULATION / ESCAPE만 표시
//  smart_money_daily 데이터 배열을 받아서 처리
// ─────────────────────────────────────────────
export const calcSmaSignalPoints = (smaHistory = []) => {
  const pts = [];

  smaHistory.forEach((d, i) => {
    const signal = d.sma_signal;
    const prev   = i > 0 ? smaHistory[i - 1] : null;

    // 이전 달과 시그널이 바뀐 경우만 마커 표시 (중복 방지)
    if (!prev || prev.sma_signal === signal) return;

    if (signal === 'SUPERNOVA') {
      pts.push({
        label:  d.trade_date?.slice(0, 7),  // YYYY-MM
        price:  null,                         // 차트에서 y값은 별도 처리
        type:   '수급▲▲',
        color:  '#FF6B35',
        arrow:  '⬆',
        pos:    'bottom',
        signal,
        foreign_net_value:     d.foreign_net_value,
        institution_net_value: d.institution_net_value,
        sma_score:             d.sma_score,
        sma_sync:              d.sma_sync,
      });
    } else if (signal === 'ACCUMULATION') {
      pts.push({
        label:  d.trade_date?.slice(0, 7),
        price:  null,
        type:   '수급▲',
        color:  '#00C896',
        arrow:  '△',
        pos:    'bottom',
        signal,
        foreign_net_value:     d.foreign_net_value,
        institution_net_value: d.institution_net_value,
        sma_score:             d.sma_score,
        sma_sync:              d.sma_sync,
      });
    } else if (signal === 'ESCAPE') {
      pts.push({
        label:  d.trade_date?.slice(0, 7),
        price:  null,
        type:   '수급▼',
        color:  '#FF4757',
        arrow:  '▽',
        pos:    'top',
        signal,
        foreign_net_value:     d.foreign_net_value,
        institution_net_value: d.institution_net_value,
        sma_score:             d.sma_score,
        sma_sync:              d.sma_sync,
      });
    }
    // NOISE는 표시 안 함
  });

  return pts;
};
