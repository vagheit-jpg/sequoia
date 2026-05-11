const safeNum = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, min, max) => Math.max(min, Math.min(max, safeNum(v, min)));

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x, mean, sd) {
  if (!sd || sd <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (sd * Math.sqrt(2))));
}

function pctChange(curr, prev) {
  curr = safeNum(curr, null);
  prev = safeNum(prev, null);
  if (curr == null || prev == null || curr <= 0 || prev <= 0) return null;
  return (curr - prev) / Math.abs(prev);
}

function monthlyVolatility(monthly) {
  if (!Array.isArray(monthly) || monthly.length < 6) return 0.14;
  const rets = [];
  for (let i = 1; i < monthly.length; i++) {
    const p0 = safeNum(monthly[i - 1]?.price, 0);
    const p1 = safeNum(monthly[i]?.price, 0);
    if (p0 > 0 && p1 > 0) rets.push(Math.log(p1 / p0));
  }
  if (rets.length < 3) return 0.14;
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return clamp(Math.sqrt(variance), 0.03, 0.40);
}

function buildAnnualEpsSeries(annData = []) {
  return (annData || [])
    .filter((r) => r?.eps != null && Number.isFinite(Number(r.eps)) && Number(r.eps) > 0)
    .map((r) => ({
      year: Number(r.year || 0),
      label: String(r.year || ""),
      eps: Number(r.eps),
      roe: safeNum(r.roe, null),
    }))
    .filter((r) => r.year > 0)
    .sort((a, b) => a.year - b.year);
}

function buildQuarterlyTtmEpsSeries(qtrData = []) {
  const q = (qtrData || [])
    .filter((r) => r?.eps != null && Number.isFinite(Number(r.eps)))
    .map((r, i) => ({
      idx: i,
      label: r.label || `${r.year || ""}.${r.quarter || ""}`,
      eps: Number(r.eps),
    }));
  if (q.length < 8) return [];
  const out = [];
  for (let i = 3; i < q.length; i++) {
    const ttm = q.slice(i - 3, i + 1).reduce((s, r) => s + r.eps, 0);
    if (ttm > 0) out.push({ label: q[i].label, eps: ttm });
  }
  return out;
}

function percentile(values, p) {
  const arr = (values || []).filter((v) => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!arr.length) return null;
  const idx = (arr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
}

function median(values) {
  return percentile(values, 0.5);
}

function growthProfile(financials = {}) {
  const annual = buildAnnualEpsSeries(financials.annData || []);
  const qTtm = buildQuarterlyTtmEpsSeries(financials.qtrData || []);
  const source = qTtm.length >= 8 ? qTtm : annual;
  const rates = [];
  if (source === qTtm) {
    for (let i = 4; i < qTtm.length; i++) {
      const g = pctChange(qTtm[i].eps, qTtm[i - 4].eps);
      if (g != null) rates.push(g);
    }
  } else {
    for (let i = 1; i < annual.length; i++) {
      const g = pctChange(annual[i].eps, annual[i - 1].eps);
      if (g != null) rates.push(g);
    }
  }
  const longRates = rates.slice(-5);
  const recentRates = rates.slice(-2);
  const longGrowth = longRates.length ? longRates.reduce((s, v) => s + v, 0) / longRates.length : 0;
  const recentGrowth = recentRates.length ? recentRates.reduce((s, v) => s + v, 0) / recentRates.length : longGrowth;
  const latestGrowth = rates.length ? rates.at(-1) : 0;
  const prevGrowth = rates.length >= 2 ? rates.at(-2) : latestGrowth;
  const epsAcceleration = latestGrowth - prevGrowth;

  // 장기성장률 60% + 최근성장률 30% + EPS 가속도 10%.
  // 단, 가속도는 향후 3년 전체를 지배하지 않도록 이후 계산에서 별도 감쇠 처리한다.
  const blendedGrowth = clamp(longGrowth * 0.60 + recentGrowth * 0.30 + epsAcceleration * 0.10, -0.20, 0.42);

  const roeSeries = annual.filter((r) => r.roe != null && Number.isFinite(Number(r.roe))).map((r) => Number(r.roe));
  const roeLatest = roeSeries.length ? roeSeries.at(-1) : safeNum(financials.roe, 10);
  const roeAvg3 = roeSeries.length ? roeSeries.slice(-3).reduce((s, v) => s + v, 0) / roeSeries.slice(-3).length : safeNum(financials.avgRoe3, roeLatest);
  const roePrev = roeSeries.length >= 2 ? roeSeries.at(-2) : roeLatest;
  const roeDelta = roeLatest - roePrev;
  const latestEps = (qTtm.length ? qTtm.at(-1)?.eps : annual.at(-1)?.eps) || safeNum(financials.eps, 0);
  return {
    source: source === qTtm ? "quarterlyTTM" : "annual",
    latestEps,
    longGrowth,
    recentGrowth,
    epsAcceleration,
    blendedGrowth,
    roeLatest,
    roeAvg3,
    roeDelta,
  };
}

function historicalMultipleStats({ monthly = [], annData = [] }) {
  const annual = buildAnnualEpsSeries(annData);
  if (!monthly?.length || !annual.length) {
    return { count: 0, median: null, p25: null, p75: null, min: null, max: null };
  }
  const epsByYear = new Map(annual.map((r) => [r.year, r.eps]));
  const pers = [];
  for (const m of monthly) {
    const year = Number(m.year || String(m.label || "").slice(0, 4));
    const eps = epsByYear.get(year) || epsByYear.get(year - 1);
    const price = safeNum(m.price, 0);
    if (eps > 0 && price > 0) {
      const per = price / eps;
      if (per > 2 && per < 120) pers.push(per);
    }
  }
  if (!pers.length) return { count: 0, median: null, p25: null, p75: null, min: null, max: null };
  return {
    count: pers.length,
    median: median(pers),
    p25: percentile(pers, 0.25),
    p75: percentile(pers, 0.75),
    min: Math.min(...pers),
    max: Math.max(...pers),
  };
}

function theoryMultiple({ growth, roe, roeDelta, baseMultiple }) {
  const base = clamp(baseMultiple || 18, 6, 35);
  const growthPremium = clamp(1 + growth * 1.55, 0.65, 1.85);
  const roePremium = clamp(1 + ((roe - 10) / 100) * 1.35, 0.75, 1.55);
  const roeTrendPremium = clamp(1 + (roeDelta / 100) * 0.90, 0.90, 1.12);
  const multiple = clamp(base * growthPremium * roePremium * roeTrendPremium, 4, 55);
  return { base, growthPremium, roePremium, roeTrendPremium, multiple };
}

function calibratedMultiple({ growth, roe, roeDelta, baseMultiple, hist }) {
  const theory = theoryMultiple({ growth, roe, roeDelta, baseMultiple });
  if (!hist || hist.count < 12 || !Number.isFinite(hist.median)) {
    return { ...theory, historicalMultiple: null, historicalWeight: 0, calibratedMultiple: theory.multiple };
  }

  const histCenter = clamp(hist.median, 4, 55);
  const histBandMid = hist.p75 && hist.p25 ? clamp((hist.p25 + hist.p75) / 2, 4, 55) : histCenter;
  const historicalMultiple = histCenter * 0.70 + histBandMid * 0.30;

  // 핵심 보정: 역사 PER은 보조 보정값입니다. 기업의 현재 성장성과 ROE가 만드는 이론 멀티플을 지배하지 못하게 25% 상한을 둡니다.
  const historicalWeight = clamp(hist.count / 240, 0.10, 0.25);
  const calibrated = clamp(theory.multiple * (1 - historicalWeight) + historicalMultiple * historicalWeight, 4, 55);
  return { ...theory, historicalMultiple, historicalWeight, calibratedMultiple: calibrated };
}

function saturatedGap(rawGap) {
  const sign = Math.sign(rawGap);
  const abs = Math.abs(rawGap);
  // QMA 이격은 잠재에너지이지만 무한 중력이 아닙니다. tanh로 포화시켜 극단 이격에서 1원 붕괴를 방지합니다.
  return sign * 1.35 * Math.tanh(abs / 1.35);
}

function gravityAdjustment({ gap, dynamicIV, lambda, decay }) {
  const egap = saturatedGap(gap);
  const raw = -lambda * Math.sign(egap) * Math.pow(Math.abs(egap), 2) * dynamicIV * decay;
  // 중력은 내재가치 궤적을 누르거나 끌어올리지만, 내재가치 자체를 파괴하지 못하도록 ±45% cap을 둡니다.
  const cap = dynamicIV * 0.45;
  return clamp(raw, -cap, cap);
}

export function buildSequoiaFormulaLab({
  currentPrice,
  intrinsicValue,
  monthly = [],
  qmaGap = null,
  financials = {},
  months = 36,
}) {
  const p0 = safeNum(currentPrice, 0);
  const dcfAnchor = safeNum(intrinsicValue, 0);
  if (p0 <= 0 || dcfAnchor <= 0) {
    return { ready: false, reason: "현재가 또는 내재가치 데이터 부족", points: [], probabilities: [], meta: {} };
  }

  const gp = growthProfile(financials);
  const latestEps = gp.latestEps > 0 ? gp.latestEps : dcfAnchor / 15;
  const impliedCurrentMultiple = latestEps > 0 && p0 > 0 ? p0 / latestEps : null;
  const dcfMultiple = latestEps > 0 ? dcfAnchor / latestEps : 15;
  const hist = historicalMultipleStats({ monthly, annData: financials.annData || [] });
  const histAnchor = hist?.median ? clamp(hist.median, 4, 45) : null;

  // DCF Anchor를 중심으로 두되, 현재 시장 PER과 역사 PER는 보조 보정값으로만 사용합니다.
  const baseMultiple = clamp(
    histAnchor != null
      ? dcfMultiple * 0.60 + histAnchor * 0.20 + (Number.isFinite(impliedCurrentMultiple) ? impliedCurrentMultiple : histAnchor) * 0.20
      : Number.isFinite(impliedCurrentMultiple)
        ? dcfMultiple * 0.70 + impliedCurrentMultiple * 0.30
        : dcfMultiple,
    4,
    42
  );

  const baseVol = monthlyVolatility(monthly);
  const gapPct = qmaGap == null ? 0 : safeNum(qmaGap, 0);
  const gap = clamp(gapPct / 100, -2.5, 3.5);
  const effectiveGap = saturatedGap(gap);
  const qmaLine0 = Math.max(1, p0 / Math.max(0.05, 1 + gap));
  const lambda = 0.24;
  const mNow = calibratedMultiple({ growth: gp.blendedGrowth, roe: gp.roeLatest, roeDelta: gp.roeDelta, baseMultiple, hist });
  const qmaGravityNow = gravityAdjustment({ gap, dynamicIV: dcfAnchor, lambda, decay: 1 });

  const roeQuality = clamp(gp.roeLatest / 15, 0.45, 1.55);
  const growthStabilityPenalty = clamp(Math.abs(gp.epsAcceleration) * 0.55, 0, 0.16);
  const histUncertaintyDiscount = hist.count >= 36 ? -0.015 : hist.count >= 12 ? -0.005 : 0.02;
  const sigmaBase = clamp(
    baseVol * 1.08 + growthStabilityPenalty + histUncertaintyDiscount + (roeQuality < 1 ? (1 - roeQuality) * 0.07 : -Math.min(0.04, (roeQuality - 1) * 0.035)),
    0.07,
    0.48
  );
  const upsideSkew = clamp(1 + Math.max(0, -effectiveGap) * 0.65 + Math.max(0, gp.blendedGrowth) * 0.28, 0.75, 1.90);
  const downsideSkew = clamp(1 + Math.max(0, effectiveGap) * 0.72 + Math.max(0, -gp.blendedGrowth) * 0.45, 0.80, 2.05);

  const points = [];
  for (let t = 0; t <= months; t++) {
    const years = t / 12;

    // EPS 가속도는 중요하지만, 3년 전체를 지배하면 과도한 우하향/우상향 왜곡이 생깁니다. 초기에만 완만히 반영하고 빠르게 감쇠시킵니다.
    const accelAdj = clamp(gp.epsAcceleration, -0.12, 0.12) * 0.18 * Math.exp(-years / 1.25);
    const growthForT = clamp(gp.blendedGrowth + accelAdj, -0.18, 0.38);

    const epsT = latestEps * Math.pow(1 + growthForT, years);
    const m = calibratedMultiple({ growth: growthForT, roe: gp.roeLatest, roeDelta: gp.roeDelta, baseMultiple, hist });
    const rawIv = epsT * m.calibratedMultiple;
    const rawIv0 = latestEps * mNow.calibratedMultiple;
    const anchorScale = rawIv0 > 0 ? dcfAnchor / rawIv0 : 1;
    const dynamicIV = Math.max(1, rawIv * anchorScale);

    const gravityDecay = Math.exp(-0.045 * t);
    const qmaGravityAdj = gravityAdjustment({ gap, dynamicIV, lambda, decay: gravityDecay });
    const expected = Math.max(dynamicIV * 0.35, dynamicIV + qmaGravityAdj);

    const sigma = expected * sigmaBase * Math.sqrt(Math.max(t, 1) / 12);
    const upper50 = expected + 0.67 * sigma * upsideSkew;
    const lower50 = expected - 0.67 * sigma * downsideSkew;
    const upper80 = expected + 1.28 * sigma * upsideSkew;
    const lower80 = expected - 1.28 * sigma * downsideSkew;

    // 세콰이어 하방 방어선: 기업가치 중심축이 살아있는 경우 확률밴드 하단이 0원으로 붕괴하지 않게 제한합니다.
    // 단순한 가격 예측 바닥이 아니라, IV(t)의 생존가치 하단을 의미합니다.
    const valueFloor = Math.max(1, dynamicIV * 0.35);
    const qmaLine = qmaLine0 * Math.pow(1 + clamp(gp.blendedGrowth * 0.45, -0.08, 0.14), years);

    points.push({
      month: t,
      label: t === 0 ? "현재" : `T+${t}M`,
      expected: Math.round(expected),
      dynamicIV: Math.round(dynamicIV),
      fairValue: Math.round(dcfAnchor),
      dcfAnchor: Math.round(dcfAnchor),
      qmaLine: Math.round(qmaLine),
      qmaGravityAdj: Math.round(qmaGravityAdj),
      effectiveGap: Number((effectiveGap * 100).toFixed(1)),
      upper80: Math.round(upper80),
      lower80: Math.max(Math.round(valueFloor), Math.round(lower80)),
      upper50: Math.round(upper50),
      lower50: Math.max(Math.round(valueFloor), Math.round(lower50)),
      sd: Math.round(sigma),
      eps: Math.round(epsT),
      multiple: Number(m.calibratedMultiple.toFixed(1)),
      theoryMultiple: Number(m.multiple.toFixed(1)),
      historicalMultiple: m.historicalMultiple == null ? null : Number(m.historicalMultiple.toFixed(1)),
    });
  }

  const makeProb = (m) => {
    const pt = points.find((x) => x.month === m) || points.at(-1);
    const mean = pt.expected;
    const sd = Math.max(pt.sd, mean * 0.08);
    const bands = [
      { label: `${Math.round(mean * 0.7).toLocaleString()}원 미만`, min: 0, max: mean * 0.7 },
      { label: `${Math.round(mean * 0.7).toLocaleString()}~${Math.round(mean * 0.9).toLocaleString()}원`, min: mean * 0.7, max: mean * 0.9 },
      { label: `${Math.round(mean * 0.9).toLocaleString()}~${Math.round(mean * 1.1).toLocaleString()}원`, min: mean * 0.9, max: mean * 1.1 },
      { label: `${Math.round(mean * 1.1).toLocaleString()}~${Math.round(mean * 1.3).toLocaleString()}원`, min: mean * 1.1, max: mean * 1.3 },
      { label: `${Math.round(mean * 1.3).toLocaleString()}원 이상`, min: mean * 1.3, max: Infinity },
    ];
    return {
      month: m,
      expected: mean,
      bands: bands.map((b) => ({
        label: b.label,
        probability: Math.round(((b.max === Infinity ? 1 : normalCdf(b.max, mean, sd)) - normalCdf(b.min, mean, sd)) * 100),
      })),
    };
  };

  const gravityLabel = gapPct > 20 ? "하방 중력" : gapPct < -20 ? "상방 중력" : "중립 중력";
  const trajectoryLabel = gp.blendedGrowth > 0.12 ? "성장 가속" : gp.blendedGrowth > 0.03 ? "완만한 성장" : gp.blendedGrowth < -0.03 ? "감속/역성장" : "정체";
  const multipleLabel = hist.count >= 12 ? "역사 보정형" : "이론 중심형";

  return {
    ready: true,
    points,
    probabilities: [makeProb(6), makeProb(12), makeProb(24), makeProb(36)],
    meta: {
      formula: "P(t) ~ [EPS(t) × M(t)] + Gqma(t) ± B(t)",
      latestEps,
      blendedGrowth: gp.blendedGrowth,
      longGrowth: gp.longGrowth,
      recentGrowth: gp.recentGrowth,
      epsAcceleration: gp.epsAcceleration,
      roeLatest: gp.roeLatest,
      roeAvg3: gp.roeAvg3,
      roeDelta: gp.roeDelta,
      baseMultiple,
      dynamicMultiple: mNow.calibratedMultiple,
      theoryMultiple: mNow.multiple,
      historicalMultiple: mNow.historicalMultiple,
      historicalWeight: mNow.historicalWeight,
      historicalMultipleStats: hist,
      multipleLabel,
      dynamicMultipleDesc: "고성장·고ROE 기반 미래 기대 멀티플",
      historicalMultipleDesc: "최근 시장이 이 종목에 실제 부여했던 평균 PER",
      valueCoreDesc: "기업가치 중심축 = EPS(t) × M(t)",
      expectedPathDesc: "시장 예상 가격 경로 = 기업가치 중심축 + QMA 중력장",
      growthPremium: mNow.growthPremium,
      roePremium: mNow.roePremium,
      qmaGap: gapPct,
      effectiveQmaGap: effectiveGap * 100,
      qmaGravityNow,
      gravityLabel,
      trajectoryLabel,
      sigmaBase,
      upsideSkew,
      downsideSkew,
      baseVol,
      dcfAnchor,
      currentPrice: p0,
      qmaLine0,
      note: "EPS 성장궤적 × 동적 멀티플(역사 PER 보조 보정) + 포화형 QMA 평균회귀 중력장 + 확률분포 밴드",
    },
  };
}
