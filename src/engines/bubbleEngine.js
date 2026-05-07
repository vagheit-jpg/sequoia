const sqClamp = (v, min, max) => Math.min(max, Math.max(min, v));

const sqNum = (v, d = 2) =>
  Number.isFinite(Number(v)) ? +Number(v).toFixed(d) : null;

export const BUBBLE_ENERGY_ARCHETYPES=[
  {id:"NASDAQ_2000", name:"1999~2000 NASDAQ", type:"IT 초버블형", energy:96, drawdown:"약 -78%", duration:"약 31개월 하락 · 장기 회복", dd:[55,78], months:[24,36], tags:["초고속상승","기술주집중","밸류팽창","모멘텀붕괴"]},
  {id:"JAPAN_1989", name:"1987~1989 일본 자산버블", type:"장기 자산버블형", energy:98, drawdown:"약 -60%~-80%", duration:"수년 하락 · 초장기 횡보", dd:[45,70], months:[36,120], tags:["자산버블","신용팽창","장기횡보","정책전환"]},
  {id:"KOSDAQ_2000", name:"1999~2000 코스닥", type:"한국 성장주 광풍형", energy:99, drawdown:"약 -80%~-90%", duration:"24~48개월 급락/침체", dd:[60,90], months:[24,48], tags:["소형성장주","개인투기","초과열","유동성축소"]},
  {id:"GFC_2008", name:"2007~2008 글로벌 금융위기", type:"금융위기 붕괴형", energy:82, drawdown:"약 -45%~-60%", duration:"12~24개월 하락", dd:[35,60], months:[12,24], tags:["신용경색","은행위기","레버리지","패닉"]},
  {id:"COVID_2020_LIQ", name:"2020~2021 코로나 유동성장", type:"유동성 과열형", energy:72, drawdown:"이후 성장주 -30%~-60%", duration:"12~30개월 조정", dd:[25,55], months:[12,30], tags:["초저금리","유동성","성장주","정책회수"]},
  {id:"BATTERY_2021", name:"2021~2023 2차전지/성장주", type:"테마 버블형", energy:88, drawdown:"주도주 -50%~-75%", duration:"18~36개월 조정", dd:[40,75], months:[18,36], tags:["테마집중","개인수급","밸류확장","후행조정"]},
  {id:"QT_2022", name:"2022 금리/QT 쇼크", type:"긴축충격형", energy:67, drawdown:"지수 -20%~-35%", duration:"9~18개월 조정", dd:[18,35], months:[9,18], tags:["금리급등","멀티플축소","달러강세","성장주압박"]},
  {id:"AI_SEMI_2026", name:"2024~2026 AI 반도체 집중장", type:"AI 집중 과열형", energy:90, drawdown:"가정범위 -35%~-60%", duration:"12~36개월 가능", dd:[30,60], months:[12,36], tags:["AI집중","대형주쏠림","실적기대","후행검증"]},
];

export const buildBubbleEnergyModel=({market,monthly,lastGap,lastRSI,lastMFI,bandLevel,sefScore=50,macdWeak=false,obvWeak=false,techTotal=0})=>{
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
