/**
 * SEQUOIA GLOBAL — Interpretation Rules
 * engines/interpretationRules.js
 *
 * 브리핑 텍스트가 예언형으로 흐르지 않게 제한하는 규칙 엔진.
 * 세콰이어 철학: "가능 경로 판단" — 예측 금지, 상태 해석만.
 */

// ── 금지 표현 목록
const FORBIDDEN_PHRASES = [
  "반드시 상승", "반드시 하락",
  "확실한 폭락", "확실한 급등",
  "100% 확률",  "100%",
  "무조건",      "필연적",
  "반드시",      "확실히",
  "예상됩니다",  "전망됩니다",
  "될 것입니다", "오를 것입니다", "내릴 것입니다",
];

// ── 권장 표현 패턴
export const SAFE_PHRASES = {
  risk_rising:    "위험 신호가 확대되고 있습니다",
  risk_falling:   "위험 압력이 완화되는 흐름입니다",
  risk_neutral:   "뚜렷한 방향성 변화가 관찰되지 않습니다",
  transition_warn:"국면 전이 가능성이 관찰됩니다",
  pressure_up:    "압력이 확대되고 있습니다",
  pressure_down:  "압력이 완화되고 있습니다",
  pattern_match:  "과거 유사 국면에서는",
  observation:    "가능 경로로 판단됩니다",
};

/**
 * 텍스트에서 금지 표현 검출
 * @param {string} text
 * @returns {{ clean: boolean, found: string[] }}
 */
export function validateText(text) {
  if (!text) return { clean: true, found: [] };
  const found = FORBIDDEN_PHRASES.filter(p => text.includes(p));
  return { clean: found.length === 0, found };
}

/**
 * 금지 표현을 권장 표현으로 대체 (최후 방어선)
 * @param {string} text
 * @returns {string}
 */
export function sanitizeText(text) {
  if (!text) return text;
  let result = text;
  const replacements = {
    "확실히 상승": "상승 압력이 관찰됩니다",
    "확실히 하락": "하락 압력이 관찰됩니다",
    "반드시":      "가능성이",
    "무조건":      "경우에 따라",
    "필연적으로":  "구조적으로",
    "예상됩니다":  "관찰됩니다",
    "전망됩니다":  "판단됩니다",
  };
  Object.entries(replacements).forEach(([from, to]) => {
    result = result.replaceAll(from, to);
  });
  return result;
}

/**
 * 방향 레이블 → 안전한 브리핑 문장 생성 헬퍼
 * @param {"악화"|"개선"|"횡보"|"주의"|"경계"} direction
 * @param {string} subject  예: "미국 시장", "유동성"
 * @returns {string}
 */
export function directionPhrase(direction, subject = "시장") {
  const map = {
    "악화": `${subject}의 위험 신호가 확대되고 있습니다`,
    "개선": `${subject}의 위험 압력이 완화되는 흐름입니다`,
    "횡보": `${subject}은 뚜렷한 방향성 변화 없이 횡보 중입니다`,
    "주의": `${subject}에서 잠재적 변화 신호가 관찰됩니다`,
    "경계": `${subject}의 전이 가능성을 모니터링할 시기입니다`,
    "유지": `${subject}은 현재 국면을 유지하고 있습니다`,
  };
  return map[direction] || `${subject} 상태가 변화하고 있습니다`;
}
