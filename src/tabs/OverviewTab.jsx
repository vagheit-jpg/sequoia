export default function OverviewTab({
  C,
  readingEngine,
  hasFinData,
  lastAnn,
}) {
  const re = readingEngine;
  const hasPriceZone = re.gap !== null;
  const hasFin = hasFinData;

  if (!hasFin) {
    return (
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 16px",marginBottom:12}}>
        <div style={{color:C.muted,fontSize:10,letterSpacing:"0.1em",marginBottom:6}}>🔍 SEQUOIA 판독</div>
        <div style={{color:C.muted,fontSize:12,textAlign:"center",padding:"8px 0",lineHeight:1.8}}>
          📂 재무 데이터를 업로드해야<br/>판독을 볼 수 있습니다.
        </div>
      </div>
    );
  }

  const vc = re.verdictColor || C.muted;

  return (
    <div style={{
      background:`linear-gradient(135deg,${vc}12,${C.card})`,
      border:`2px solid ${vc}55`,
      borderRadius:14,padding:"14px 15px",marginBottom:12,
      position:"relative",overflow:"hidden",
    }}>
      <div style={{position:"absolute",top:-30,right:-30,width:100,height:100,
        background:`radial-gradient(circle,${vc}20,transparent 70%)`,pointerEvents:"none"}}/>

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

      <div style={{borderTop:`1px solid ${C.border}`,marginBottom:10}}/>

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
}
