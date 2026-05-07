export default function OutsiderTab({ C, annData, hasFinData, price }) {
  if (!hasFinData || !annData?.length) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "24px", textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>📖</div>
        <div style={{ color: C.gold, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>아웃사이더 CEO 적합도 분석</div>
        <div style={{ color: C.muted, fontSize: 11 }}>재무제표를 업로드하면 분석을 시작합니다.</div>
      </div>
    );
  }

  const rows = annData.filter(r => r.year).slice(-5);
  const n = rows.length;
  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const lastRow = rows[rows.length - 1];

  // ── 1. 현금배분 철학 (35점)
  // A. FCF 마진 — 오너이익 마인드
  const fcfMarginArr = rows.filter(r => r.fcf != null && r.rev != null && r.rev > 0).map(r => r.fcf / r.rev * 100);
  const avgFcfMargin = fcfMarginArr.length ? avg(fcfMarginArr) : null;
  let fcfMarginScore = 0;
  if (avgFcfMargin != null) {
    if (avgFcfMargin >= 20) fcfMarginScore = 15;
    else if (avgFcfMargin >= 12) fcfMarginScore = 11;
    else if (avgFcfMargin >= 7) fcfMarginScore = 7;
    else if (avgFcfMargin >= 3) fcfMarginScore = 3;
  }

  // B. 자사주 매입 / 배당 보다 자본배분 우선 (재무CF에서 추정)
  const cffArr = rows.filter(r => r.cff != null).map(r => r.cff);
  const avgCff = cffArr.length ? avg(cffArr) : null;
  let buybackScore = 0;
  if (avgCff != null) {
    if (avgCff < 0) {
      const ratio = Math.abs(avgCff) / (Math.abs(avg(rows.filter(r => r.rev > 0).map(r => r.rev))) || 1) * 100;
      if (ratio >= 5) buybackScore = 12;
      else if (ratio >= 2) buybackScore = 8;
      else buybackScore = 5;
    } else {
      buybackScore = 1;
    }
  }

  // C. FCF/순이익 전환율
  const fcfConvArr = rows.filter(r => r.fcf != null && r.net != null && r.net > 0).map(r => r.fcf / r.net * 100);
  const avgFcfConv = fcfConvArr.length ? avg(fcfConvArr) : null;
  let fcfConvScore = 0;
  if (avgFcfConv != null) {
    if (avgFcfConv >= 100) fcfConvScore = 8;
    else if (avgFcfConv >= 80) fcfConvScore = 6;
    else if (avgFcfConv >= 50) fcfConvScore = 3;
    else fcfConvScore = 1;
  } else if (rows.filter(r => r.fcf != null && r.fcf > 0).length === rows.length) {
    fcfConvScore = 4;
  }
  const cashDistScore = fcfMarginScore + buybackScore + fcfConvScore;

  // ── 2. 자본효율성 극대화 (30점)
  const roeArr = rows.filter(r => r.roe != null).map(r => r.roe);
  const avgROE = roeArr.length ? avg(roeArr) : null;
  let roeScore = 0;
  if (avgROE != null) {
    if (avgROE >= 25) roeScore = 15;
    else if (avgROE >= 20) roeScore = 12;
    else if (avgROE >= 15) roeScore = 8;
    else if (avgROE >= 10) roeScore = 4;
  }

  const capexRevArr = rows.filter(r => r.capex != null && r.rev != null && r.rev > 0).map(r => Math.abs(r.capex) / r.rev * 100);
  const avgCapexRev = capexRevArr.length ? avg(capexRevArr) : null;
  let capexLightScore = 0;
  if (avgCapexRev != null) {
    if (avgCapexRev < 3) capexLightScore = 15;
    else if (avgCapexRev < 6) capexLightScore = 11;
    else if (avgCapexRev < 10) capexLightScore = 7;
    else if (avgCapexRev < 20) capexLightScore = 3;
    else capexLightScore = 1;
  }
  const capitalEffScore = roeScore + capexLightScore;

  // ── 3. 보수적 레버리지 (20점)
  const debtRatio = lastRow?.debt ?? null;
  const debtTrendArr = rows.filter(r => r.debt != null).map(r => r.debt);
  const debtTrend = debtTrendArr.length >= 2 ? debtTrendArr[debtTrendArr.length - 1] - debtTrendArr[0] : null;
  let leverageScore = 0;
  if (debtRatio != null) {
    if (debtRatio < 50) leverageScore = 12;
    else if (debtRatio < 100) leverageScore = 9;
    else if (debtRatio < 150) leverageScore = 5;
    else if (debtRatio < 200) leverageScore = 2;
  }
  let debtTrendScore = 0;
  if (debtTrend != null) {
    if (debtTrend < -20) debtTrendScore = 8;
    else if (debtTrend < 0) debtTrendScore = 5;
    else if (debtTrend < 10) debtTrendScore = 2;
  } else if (debtRatio != null && debtRatio < 80) {
    debtTrendScore = 3;
  }
  const leverTotalScore = leverageScore + debtTrendScore;

  // ── 4. 오너십 마인드 (15점)
  const opmArr = rows.filter(r => r.opm != null).map(r => r.opm);
  const avgOPM = opmArr.length ? avg(opmArr) : null;
  const opmMin = opmArr.length ? Math.min(...opmArr) : null;
  let ownershipScore = 0;
  if (avgOPM != null) {
    if (avgOPM >= 20 && opmMin >= 10) ownershipScore = 15;
    else if (avgOPM >= 15 && opmMin >= 7) ownershipScore = 11;
    else if (avgOPM >= 10 && opmMin >= 5) ownershipScore = 7;
    else if (avgOPM >= 5) ownershipScore = 4;
    else ownershipScore = 1;
  }

  const total = cashDistScore + capitalEffScore + leverTotalScore + ownershipScore;

  // ── 등급
  let grade, gradeColor, gradeIcon, gradeDesc;
  if (total >= 85) { grade = "아웃사이더 A+"; gradeColor = C.green; gradeIcon = "🏆"; gradeDesc = "손다이크 8인의 경영철학과 고도로 일치. 자본배분 천재형 기업."; }
  else if (total >= 70) { grade = "아웃사이더 A"; gradeColor = C.teal; gradeIcon = "🌟"; gradeDesc = "현금 중심 경영이 뚜렷. 장기 복리 투자 적합 기업."; }
  else if (total >= 55) { grade = "아웃사이더 B"; gradeColor = C.gold; gradeIcon = "✅"; gradeDesc = "부분적으로 아웃사이더 특성 보유. 세부 항목 점검 필요."; }
  else if (total >= 35) { grade = "아웃사이더 C"; gradeColor = C.orange; gradeIcon = "⚠️"; gradeDesc = "일부 지표 부합. 성장형 또는 전통 경영 방식에 가까움."; }
  else { grade = "비해당"; gradeColor = C.red; gradeIcon = "❌"; gradeDesc = "아웃사이더 기준과 거리 있음. 자본배분 철학 재확인 필요."; }

  const sections = [
    {
      title: "현금배분 철학", full: 35, score: cashDistScore,
      desc: "이익보다 FCF, 배당보다 자사주·재투자 — 손다이크 CEO의 핵심 DNA",
      items: [
        {
          label: "FCF 마진", score: fcfMarginScore, max: 15,
          val: avgFcfMargin != null ? `${avgFcfMargin.toFixed(1)}%` : "—",
          bench: "12% 이상",
          detail: avgFcfMargin != null ? (avgFcfMargin >= 20 ? "탁월" : avgFcfMargin >= 12 ? "우수" : avgFcfMargin >= 7 ? "양호" : avgFcfMargin >= 3 ? "미흡" : "미달") : "데이터 없음"
        },
        {
          label: "자본환원 성향 (재무CF)", score: buybackScore, max: 12,
          val: avgCff != null ? `${avgCff < 0 ? "환원" : "확장"} (평균 ${avgCff != null ? Math.round(avgCff).toLocaleString() + "억" : "—"})` : "—",
          bench: "재무CF 음수 (자사주·부채상환 우세)",
          detail: avgCff != null ? (avgCff < 0 ? "자본환원 우세" : "외부조달/배당 확장 성향") : "데이터 없음"
        },
        {
          label: "FCF/순이익 전환율", score: fcfConvScore, max: 8,
          val: avgFcfConv != null ? `${avgFcfConv.toFixed(0)}%` : "—",
          bench: "80% 이상",
          detail: avgFcfConv != null ? (avgFcfConv >= 100 ? "탁월" : avgFcfConv >= 80 ? "우수" : avgFcfConv >= 50 ? "양호" : "미흡") : "데이터 없음"
        },
      ]
    },
    {
      title: "자본효율성 극대화", full: 30, score: capitalEffScore,
      desc: "적은 자산으로 높은 이익 — 경량 비즈니스 모델을 선호",
      items: [
        {
          label: "ROE (자기자본 복리)", score: roeScore, max: 15,
          val: avgROE != null ? `${avgROE.toFixed(1)}%` : "—",
          bench: "20% 이상",
          detail: avgROE != null ? (avgROE >= 25 ? "탁월" : avgROE >= 20 ? "우수" : avgROE >= 15 ? "양호" : avgROE >= 10 ? "미흡" : "미달") : "데이터 없음"
        },
        {
          label: "CAPEX 집약도 (매출 대비)", score: capexLightScore, max: 15,
          val: avgCapexRev != null ? `${avgCapexRev.toFixed(1)}%` : "—",
          bench: "매출의 6% 이하",
          detail: avgCapexRev != null ? (avgCapexRev < 3 ? "초경량 모델" : avgCapexRev < 6 ? "경량" : avgCapexRev < 10 ? "보통" : avgCapexRev < 20 ? "자산 집약" : "중공업형") : "데이터 없음"
        },
      ]
    },
    {
      title: "보수적 레버리지", full: 20, score: leverTotalScore,
      desc: "부채는 도구이지 습관이 아니다 — 재무 유연성 최우선",
      items: [
        {
          label: "현재 부채비율", score: leverageScore, max: 12,
          val: debtRatio != null ? `${debtRatio}%` : "—",
          bench: "100% 이하",
          detail: debtRatio != null ? (debtRatio < 50 ? "매우 보수적" : debtRatio < 100 ? "안전" : debtRatio < 150 ? "보통" : debtRatio < 200 ? "주의" : "위험") : "데이터 없음"
        },
        {
          label: "부채 추세", score: debtTrendScore, max: 8,
          val: debtTrend != null ? `${debtTrend > 0 ? "+" : ""}${Math.round(debtTrend)}%p (${n}년간)` : "—",
          bench: "감소 또는 유지",
          detail: debtTrend != null ? (debtTrend < -20 ? "적극 축소" : debtTrend < 0 ? "감소" : debtTrend < 10 ? "유지" : "증가 주의") : "데이터 부족"
        },
      ]
    },
    {
      title: "오너십 마인드 (수익성 집중)", full: 15, score: ownershipScore,
      desc: "단기 성과보다 장기 수익성 — 경기 관계없이 일관된 영업이익률",
      items: [
        {
          label: "영업이익률 수준·일관성", score: ownershipScore, max: 15,
          val: avgOPM != null ? `평균 ${avgOPM.toFixed(1)}% / 최저 ${opmMin != null ? opmMin.toFixed(1) : "-"}%` : "—",
          bench: "평균 15% 이상 & 최저 7% 이상",
          detail: avgOPM != null ? (avgOPM >= 20 && opmMin >= 10 ? "탁월·일관" : avgOPM >= 15 ? "우수" : avgOPM >= 10 ? "양호" : "개선 필요") : "데이터 없음"
        },
      ]
    },
  ];

  const arcLen = 251.2;
  const dashOffset = arcLen * (1 - total / 100);

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>

      {/* ── 책 소개 + 방법론 범례 */}
      <div style={{
        background: `${C.gold}0A`, border: `1px solid ${C.gold}33`,
        borderRadius: 12, padding: "14px 16px", marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>📖</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, color: C.gold, letterSpacing: "0.04em", marginBottom: 2 }}>
              현금의 재발견 — 윌리엄 N. 손다이크 Jr. (The Outsiders, 2012)
            </div>
            <div style={{ fontSize: 9, color: C.muted, lineHeight: 1.75 }}>
              S&P500 대비 <span style={{ color: C.teal, fontWeight: 700 }}>20배 이상의 초과수익</span>을 달성한 8인의 CEO를 분석한 저서.
              이들의 공통점은 화려한 비전 발표나 M&A가 아닌, <span style={{ color: C.orange, fontWeight: 700 }}>조용한 자본배분 능력</span>이었습니다.
            </div>
          </div>
        </div>

        {/* 등급 척도 설명 */}
        <div style={{ fontSize: 9, color: C.gold, fontWeight: 700, marginBottom: 6, letterSpacing: "0.06em" }}>
          🏅 적합도 등급 척도 (100점 만점)
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { grade: "A+", score: "85~100", color: C.green, icon: "🏆", desc: "손다이크 8인과 고도로 일치. 자본배분 천재형 — 장기 핵심 보유 적합" },
            { grade: "A", score: "70~84", color: C.teal, icon: "🌟", desc: "현금 중심 경영 뚜렷. 장기 복리 투자에 적합한 우수 기업" },
            { grade: "B", score: "55~69", color: C.gold, icon: "✅", desc: "부분적 아웃사이더 특성. 세부 항목 점검 후 투자 고려" },
            { grade: "C", score: "35~54", color: C.orange, icon: "⚠️", desc: "일부 지표만 부합. 성장형·전통 경영 방식 혼재" },
            { grade: "비해당", score: "~34", color: C.red, icon: "❌", desc: "아웃사이더 기준과 거리 있음. 자본배분 철학 재확인 필요" },
          ].map(({ grade, score, color, icon, desc }) => (
            <div key={grade} style={{
              background: C.card2, borderRadius: 7, padding: "6px 9px",
              border: `1px solid ${color}44`, flex: "1 1 calc(50% - 4px)", minWidth: 140,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <span style={{ fontSize: 11 }}>{icon}</span>
                <span style={{ color: color, fontWeight: 900, fontSize: 10, fontFamily: "monospace" }}>{grade}</span>
                <span style={{ color: `${C.muted}88`, fontSize: 8, marginLeft: 2 }}>({score}점)</span>
              </div>
              <div style={{ color: C.muted, fontSize: 8, lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        {/* 8인 소개 */}
        <div style={{ fontSize: 9, color: C.gold, fontWeight: 700, marginBottom: 6, letterSpacing: "0.06em" }}>
          📋 손다이크가 선정한 아웃사이더 CEO 8인
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10 }}>
          {[
            { ceo: "워런 버핏", company: "버크셔 해서웨이", ret: "S&P 대비 ×135", color: C.gold },
            { ceo: "헨리 싱글턴", company: "텔레다인", ret: "S&P 대비 ×12", color: C.teal },
            { ceo: "존 맬론", company: "TCI/리버티 미디어", ret: "S&P 대비 ×40 (절대 ×900)", color: C.purple },
            { ceo: "톰 머피", company: "캐피털 시티즈/ABC", ret: "S&P 대비 ×16.7", color: C.blue },
            { ceo: "딕 스미스", company: "제너럴 시네마", ret: "S&P 대비 ×15.8", color: C.orange },
            { ceo: "캐서린 그레이엄", company: "워싱턴 포스트", ret: "S&P 대비 ×18", color: C.cyan },
            { ceo: "빌 스털링", company: "랠스턴 퓨리나", ret: "S&P 대비 ×2.5", color: C.green },
            { ceo: "빌 앤더스", company: "제너럴 다이나믹스", ret: "S&P 대비 ×6.7", color: C.pink },
          ].map(({ ceo, company, ret, color }) => (
            <div key={ceo} style={{
              background: C.card2, borderRadius: 6, padding: "5px 8px",
              border: `1px solid ${color}33`,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: color }}>{ceo}</div>
              <div style={{ fontSize: 8, color: C.muted }}>{company}</div>
              <div style={{ fontSize: 8, color: C.teal, fontFamily: "monospace" }}>{ret}</div>
            </div>
          ))}
        </div>

        {/* 핵심 원칙 */}
        <div style={{ fontSize: 9, color: C.gold, fontWeight: 700, marginBottom: 5, letterSpacing: "0.06em" }}>
          🎯 아웃사이더 CEO 5대 공통 원칙
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {[
            { no: "①", title: "현금흐름 중심 사고", desc: "EPS보다 FCF. 장부 이익이 아닌 실제 현금을 기준으로 기업을 평가" },
            { no: "②", title: "자본배분이 최우선 임무", desc: "경영자의 가장 중요한 역할은 자본을 어디에 배치할지 결정하는 것" },
            { no: "③", title: "자사주 매입의 적극 활용", desc: "주가가 내재가치 대비 저평가될 때 자사주 매입이 최고의 투자" },
            { no: "④", title: "보수적 레버리지", desc: "부채는 전략적 도구. 과도한 레버리지로 재무 유연성을 훼손하지 않음" },
            { no: "⑤", title: "분권화 + 비용 절감", desc: "본사는 작게, 현장에 권한 위임. 군살 없는 조직 = 높은 FCF 마진" },
          ].map(({ no, title, desc }) => (
            <div key={no} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ color: C.teal, fontWeight: 900, fontSize: 9, flexShrink: 0, marginTop: 1 }}>{no}</span>
              <div>
                <span style={{ color: C.text, fontWeight: 700, fontSize: 9 }}>{title}: </span>
                <span style={{ color: C.muted, fontSize: 9 }}>{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 총점 헤더 카드 */}
      <div style={{
        background: C.card, border: `2px solid ${gradeColor}55`,
        borderRadius: 14, padding: "18px 16px", marginBottom: 12,
        boxShadow: `0 0 32px ${gradeColor}12`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
            <svg width="90" height="90" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="40" fill="none" stroke={C.dim} strokeWidth="8" />
              <circle cx="45" cy="45" r="40" fill="none"
                stroke={gradeColor} strokeWidth="8"
                strokeDasharray={arcLen}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform="rotate(-90 45 45)"
                style={{ transition: "stroke-dashoffset 0.8s ease" }}
              />
            </svg>
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color: gradeColor, lineHeight: 1 }}>{total}</div>
              <div style={{ fontSize: 8, color: C.muted }}>/ 100</div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, letterSpacing: "0.06em" }}>
              📖 아웃사이더 CEO 적합도 · {n}년 평균 기준
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{gradeIcon}</span>
              <span style={{ fontSize: 15, fontWeight: 900, color: gradeColor, fontFamily: "monospace" }}>{grade}</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.6 }}>{gradeDesc}</div>
            <div style={{
              fontSize: 8, color: C.muted, marginTop: 6,
              background: C.card2, borderRadius: 6, padding: "4px 8px",
              border: `1px solid ${C.border}`, display: "inline-block",
            }}>
              현금배분35 + 자본효율30 + 레버리지20 + 오너십15
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

      {/* ── 한계 및 유의사항 */}
      <div style={{
        background: `${C.blue}08`, border: `1px solid ${C.blue}30`,
        borderRadius: 10, padding: "12px 14px",
      }}>
        <div style={{ fontSize: 9, color: C.blue, fontWeight: 700, marginBottom: 5, letterSpacing: "0.06em" }}>
          ⚠️ 분석 유의사항
        </div>
        <div style={{ fontSize: 9, color: C.muted, lineHeight: 1.75 }}>
          • 본 분석은 DART 공시 재무데이터 기반 <span style={{ color: C.text, fontWeight: 600 }}>정량 근사치</span>입니다. 실제 아웃사이더 여부는 경영진 지분율·M&A 전략·분권화 구조 등 정성 요소 포함 필요.<br />
          • <span style={{ color: C.text, fontWeight: 600 }}>자본환원 항목</span>은 재무CF 전체로 근사하므로, 차입금 상환과 자사주 매입을 합산한 수치입니다.<br />
          • 한국 기업의 경우 지배구조·오너 일가 특성상 서구 아웃사이더 기준과 문화적 차이가 있을 수 있습니다.
        </div>
        <div style={{ fontSize: 8, color: `${C.muted}88`, textAlign: "right", marginTop: 6 }}>
          — 참고: William N. Thorndike Jr., <i>The Outsiders</i> (2012) / 국내판: 현금의 재발견
        </div>
      </div>
    </div>
  );
}
