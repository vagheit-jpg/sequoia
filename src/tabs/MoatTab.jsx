export default function MoatTab({ C, annData, hasFinData }) {
  if (!hasFinData || !annData?.length) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "24px", textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🛡️</div>
        <div style={{ color: C.gold, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>경제적 해자 분석</div>
        <div style={{ color: C.muted, fontSize: 11 }}>재무제표를 업로드하면 경제적 해자 점수를 산출합니다.</div>
      </div>
    );
  }

  // ── 데이터 준비 (최대 5년)
  const rows = annData.filter(r => r.year).slice(-5);
  const n = rows.length;
  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const stddev = (arr) => {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  };

  // ── 1. 자본 효율성 (40점)
  const roicArr = rows.filter(r => r.net != null && (r.equity != null || r.assets != null)).map(r => {
    const invested = r.equity || (r.assets - (r.liab || 0));
    return invested > 0 ? (r.net / invested * 100) : null;
  }).filter(v => v != null);
  const avgROIC = roicArr.length ? avg(roicArr) : null;

  const roeArr = rows.filter(r => r.roe != null).map(r => r.roe);
  const avgROE = roeArr.length ? avg(roeArr) : null;
  const roeConsistent = roeArr.length >= 2 && roeArr.every(v => v >= 10);

  let roicScore = 0, roeScore = 0;
  if (avgROIC != null) {
    if (avgROIC >= 20) roicScore = 20;
    else if (avgROIC >= 15) roicScore = 15;
    else if (avgROIC >= 10) roicScore = 8;
    else if (avgROIC >= 5) roicScore = 3;
  }
  if (avgROE != null) {
    if (avgROE >= 20 && roeConsistent) roeScore = 20;
    else if (avgROE >= 15) roeScore = 15;
    else if (avgROE >= 10) roeScore = 8;
    else if (avgROE >= 5) roeScore = 3;
  }
  const capitalScore = roicScore + roeScore;

  // ── 2. 수익성 및 가격 결정력 (30점)
  const opmArr = rows.filter(r => r.opm != null).map(r => r.opm);
  const avgOPM = opmArr.length ? avg(opmArr) : null;
  const opmStd = opmArr.length >= 2 ? stddev(opmArr) : null;

  const gpArr = rows.filter(r => r.op != null && r.rev != null && r.rev > 0).map(r => r.op / r.rev * 100);
  const avgGP = gpArr.length ? avg(gpArr) : null;

  let gmScore = 0, opmStabilityScore = 0;
  const gpRef = avgGP ?? avgOPM;
  if (gpRef != null) {
    if (gpRef >= 30) gmScore = 15;
    else if (gpRef >= 20) gmScore = 10;
    else if (gpRef >= 12) gmScore = 5;
    else if (gpRef >= 5) gmScore = 2;
  }
  if (opmStd != null) {
    if (opmStd < 3) opmStabilityScore = 15;
    else if (opmStd < 5) opmStabilityScore = 12;
    else if (opmStd < 10) opmStabilityScore = 7;
    else opmStabilityScore = 2;
  } else if (avgOPM != null) {
    opmStabilityScore = 5;
  }
  const profitScore = gmScore + opmStabilityScore;

  // ── 3. 현금 창출 (20점)
  const fcfConvArr = rows.filter(r => r.fcf != null && r.net != null && r.net > 0).map(r => r.fcf / r.net * 100);
  const avgFcfConv = fcfConvArr.length ? avg(fcfConvArr) : null;

  const capexRatioArr = rows.filter(r => r.capex != null && r.cfo != null && r.cfo > 0).map(r => Math.abs(r.capex) / r.cfo * 100);
  const avgCapexRatio = capexRatioArr.length ? avg(capexRatioArr) : null;

  let fcfConvScore = 0, capexScore = 0;
  if (avgFcfConv != null) {
    if (avgFcfConv >= 100) fcfConvScore = 10;
    else if (avgFcfConv >= 80) fcfConvScore = 10;
    else if (avgFcfConv >= 50) fcfConvScore = 6;
    else if (avgFcfConv >= 0) fcfConvScore = 3;
  } else if (rows.filter(r => r.fcf != null && r.fcf > 0).length === rows.length) {
    fcfConvScore = 6;
  }
  if (avgCapexRatio != null) {
    if (avgCapexRatio < 15) capexScore = 10;
    else if (avgCapexRatio < 25) capexScore = 10;
    else if (avgCapexRatio < 40) capexScore = 5;
    else capexScore = 1;
  } else if (rows.filter(r => r.cfo != null && r.cfo > 0).length > 0) {
    capexScore = 5;
  }
  const cashScore = fcfConvScore + capexScore;

  // ── 4. 재무 건전성 (10점)
  const lastRow = rows[rows.length - 1];
  const debtRatio = lastRow?.debt ?? null;
  let safetyScore = 0;
  if (debtRatio != null) {
    if (debtRatio < 50) safetyScore = 10;
    else if (debtRatio < 80) safetyScore = 10;
    else if (debtRatio < 150) safetyScore = 5;
    else if (debtRatio < 250) safetyScore = 2;
  }

  // ── 총점
  const total = capitalScore + profitScore + cashScore + safetyScore;

  // ── 해자 등급
  let moatGrade, moatColor, moatIcon, moatDesc;
  if (total >= 80) { moatGrade = "광역 해자"; moatColor = C.green; moatIcon = "🏰"; moatDesc = "탁월한 경쟁 우위. 10년 이상 지속 가능한 해자."; }
  else if (total >= 60) { moatGrade = "넓은 해자"; moatColor = C.teal; moatIcon = "🛡️"; moatDesc = "견고한 경쟁 우위. 장기 투자 적합."; }
  else if (total >= 40) { moatGrade = "좁은 해자"; moatColor = C.gold; moatIcon = "⚔️"; moatDesc = "일부 경쟁 우위. 지속성 모니터링 필요."; }
  else if (total >= 20) { moatGrade = "해자 미약"; moatColor = C.orange; moatIcon = "🏚️"; moatDesc = "경쟁 우위 약함. 가격 우위 확인 필요."; }
  else { moatGrade = "해자 없음"; moatColor = C.red; moatIcon = "💔"; moatDesc = "경쟁 우위 확인 불가. 추가 분석 필요."; }

  const sections = [
    {
      title: "자본 효율성", full: 40, score: capitalScore,
      desc: "해자의 가장 강력한 증거 — 적은 자본으로 많은 수익",
      items: [
        {
          label: "ROIC (투하자본수익률)", score: roicScore, max: 20,
          val: avgROIC != null ? `${avgROIC.toFixed(1)}%` : "—",
          bench: "15% 이상",
          detail: avgROIC != null ? (avgROIC >= 20 ? "탁월" : avgROIC >= 15 ? "우수" : avgROIC >= 10 ? "양호" : avgROIC >= 5 ? "미흡" : "미달") : "데이터 없음",
        },
        {
          label: "ROE (자기자본이익률)", score: roeScore, max: 20,
          val: avgROE != null ? `${avgROE.toFixed(1)}%` : "—",
          bench: "15% 이상 + 일관성",
          detail: avgROE != null ? (avgROE >= 20 ? "탁월" : avgROE >= 15 ? "우수" : avgROE >= 10 ? "양호" : avgROE >= 5 ? "미흡" : "미달") : "데이터 없음",
        },
      ]
    },
    {
      title: "수익성 및 가격 결정력", full: 30, score: profitScore,
      desc: "브랜드와 독점력 — 경기에 상관없이 이익을 지키는 방어력",
      items: [
        {
          label: "영업이익률 수준", score: gmScore, max: 15,
          val: gpRef != null ? `${gpRef.toFixed(1)}%` : "—",
          bench: "30% 이상 (OPM 기준)",
          detail: gpRef != null ? (gpRef >= 30 ? "탁월" : gpRef >= 20 ? "우수" : gpRef >= 12 ? "양호" : gpRef >= 5 ? "미흡" : "미달") : "데이터 없음",
        },
        {
          label: "영업이익률 안정성", score: opmStabilityScore, max: 15,
          val: opmStd != null ? `σ ${opmStd.toFixed(1)}%` : "—",
          bench: "표준편차 10% 이내",
          detail: opmStd != null ? (opmStd < 3 ? "매우 안정" : opmStd < 5 ? "안정" : opmStd < 10 ? "보통" : "불안정") : "데이터 필요(2년+)",
        },
      ]
    },
    {
      title: "현금 창출 및 잉여력", full: 20, score: cashScore,
      desc: "실질적 생존력 — 장부 이익이 아닌 실제 현금",
      items: [
        {
          label: "FCF 전환율", score: fcfConvScore, max: 10,
          val: avgFcfConv != null ? `${avgFcfConv.toFixed(0)}%` : "—",
          bench: "80% 이상",
          detail: avgFcfConv != null ? (avgFcfConv >= 100 ? "탁월" : avgFcfConv >= 80 ? "우수" : avgFcfConv >= 50 ? "양호" : avgFcfConv >= 0 ? "미흡" : "적자FCF") : "데이터 없음",
        },
        {
          label: "CAPEX 부담율", score: capexScore, max: 10,
          val: avgCapexRatio != null ? `${avgCapexRatio.toFixed(0)}%` : "—",
          bench: "CFO의 25% 이내",
          detail: avgCapexRatio != null ? (avgCapexRatio < 15 ? "경량 모델" : avgCapexRatio < 25 ? "양호" : avgCapexRatio < 40 ? "보통" : "중자산") : "데이터 없음",
        },
      ]
    },
    {
      title: "재무 건전성", full: 10, score: safetyScore,
      desc: "외부 충격에도 해자가 무너지지 않을 최소 방벽",
      items: [
        {
          label: "부채비율", score: safetyScore, max: 10,
          val: debtRatio != null ? `${debtRatio}%` : "—",
          bench: "80% 이하",
          detail: debtRatio != null ? (debtRatio < 50 ? "매우 안전" : debtRatio < 80 ? "안전" : debtRatio < 150 ? "보통" : debtRatio < 250 ? "주의" : "위험") : "데이터 없음",
        },
      ]
    },
  ];

  const arcLen = 251.2;
  const dashOffset = arcLen * (1 - total / 100);

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>

      {/* ── 총점 헤더 카드 */}
      <div style={{
        background: C.card, border: `2px solid ${moatColor}55`,
        borderRadius: 14, padding: "18px 16px", marginBottom: 12,
        boxShadow: `0 0 32px ${moatColor}12`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* 원형 게이지 */}
          <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
            <svg width="90" height="90" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="40" fill="none" stroke={C.dim} strokeWidth="8" />
              <circle cx="45" cy="45" r="40" fill="none"
                stroke={moatColor} strokeWidth="8"
                strokeDasharray={arcLen}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform="rotate(-90 45 45)"
                style={{ transition: "stroke-dashoffset 0.8s ease" }}
              />
            </svg>
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color: moatColor, lineHeight: 1 }}>{total}</div>
              <div style={{ fontSize: 8, color: C.muted }}>/ 100</div>
            </div>
          </div>
          {/* 등급 정보 */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, letterSpacing: "0.06em" }}>
              🛡️ 경제적 해자 스코어 · {n}년 평균 기준
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{moatIcon}</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: moatColor, fontFamily: "monospace" }}>{moatGrade}</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.6 }}>{moatDesc}</div>
            <div style={{
              fontSize: 8, color: C.muted, marginTop: 6,
              background: C.card2, borderRadius: 6, padding: "4px 8px",
              border: `1px solid ${C.border}`, display: "inline-block",
            }}>
              버핏 기준 · 자본효율40+수익성30+현금창출20+건전성10
            </div>
          </div>
        </div>

        {/* 섹션 점수 바 요약 */}
        <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {sections.map(s => {
            const pct2 = Math.round(s.score / s.full * 100);
            const col = pct2 >= 75 ? C.green : pct2 >= 50 ? C.gold : pct2 >= 25 ? C.orange : C.red;
            return (
              <div key={s.title} style={{
                flex: "1 1 calc(50% - 6px)", minWidth: 120,
                background: C.card2, borderRadius: 8, padding: "7px 10px",
                border: `1px solid ${col}33`
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: C.muted }}>{s.title}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: col }}>
                    {s.score}/{s.full}
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: C.dim, overflow: "hidden" }}>
                  <div style={{ width: `${pct2}%`, height: "100%", background: col, borderRadius: 2, transition: "width 0.6s ease" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 섹션별 상세 */}
      {sections.map(sec => {
        const secPct = Math.round(sec.score / sec.full * 100);
        const secCol = secPct >= 75 ? C.green : secPct >= 50 ? C.gold : secPct >= 25 ? C.orange : C.red;
        return (
          <div key={sec.title} style={{
            background: C.card, border: `1px solid ${secCol}33`,
            borderRadius: 12, padding: "13px 14px", marginBottom: 10,
          }}>
            {/* 섹션 헤더 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: secCol, marginBottom: 3 }}>{sec.title}</div>
                <div style={{ fontSize: 9, color: C.muted }}>{sec.desc}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: secCol }}>{sec.score}</div>
                <div style={{ fontSize: 8, color: C.muted }}>/ {sec.full}점</div>
              </div>
            </div>
            {/* 지표 행 */}
            {sec.items.map(item => {
              const itemPct = Math.round(item.score / item.max * 100);
              const itemCol = itemPct >= 75 ? C.green : itemPct >= 50 ? C.gold : itemPct >= 25 ? C.orange : C.red;
              return (
                <div key={item.label} style={{
                  background: C.card2, borderRadius: 8, padding: "9px 11px", marginBottom: 6,
                  border: `1px solid ${C.border}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div>
                      <span style={{ fontSize: 10, color: C.text, fontWeight: 600 }}>{item.label}</span>
                      <span style={{ fontSize: 8, color: C.muted, marginLeft: 6 }}>(기준: {item.bench})</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: itemCol }}>{item.val}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: itemCol,
                        background: `${itemCol}18`, borderRadius: 4, padding: "1px 7px",
                        border: `1px solid ${itemCol}44`,
                      }}>{item.score}/{item.max}</span>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: C.dim, overflow: "hidden", marginBottom: 4 }}>
                    <div style={{ width: `${itemPct}%`, height: "100%", background: itemCol, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 9, color: itemCol, fontWeight: 600 }}>{item.detail}</div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* ── 버핏의 해자 철학 */}
      <div style={{
        background: `${C.gold}0A`, border: `1px solid ${C.gold}30`,
        borderRadius: 10, padding: "12px 14px",
      }}>
        <div style={{ fontSize: 9, color: C.gold, fontWeight: 700, marginBottom: 6, letterSpacing: "0.06em" }}>버핏의 해자 철학</div>
        <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.75, fontStyle: "italic" }}>
          "해자의 본질은 자본을 재투자했을 때 평균 이상의 수익을 지속적으로 창출하는 능력에 있습니다.
          ROE 15% 이상이 오랫동안 지속된다면 그것이 해자의 증거입니다."
        </div>
        <div style={{ fontSize: 8, color: C.muted, textAlign: "right", marginTop: 4 }}>— 워런 버핏, 버크셔 해서웨이 주주서한</div>
      </div>
    </div>
  );
}
