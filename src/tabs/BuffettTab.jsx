import { useState } from "react";

export default function BuffettTab({ C, Q, todayQ, CATS, CAT_COLOR, CAT_ICON }) {
  const [catFilter, setCatFilter] = useState("전체");
  const [whoFilter, setWhoFilter] = useState("전체");
  const [idx, setIdx] = useState(0);

  // 인물별 색상 (이모티콘 없이 텍스트만)
  const WHO_LIST = [
    { id: "전체", col: C.teal },
    { id: "워런 버핏", col: C.gold },
    { id: "찰리 멍거", col: C.purple },
    { id: "그레이엄", col: "#60A8DC" },
    { id: "피터 린치", col: C.green },
    { id: "하워드 막스", col: C.orange },
    { id: "필립 피셔", col: "#7EC8A0" },
    { id: "세스 클라만", col: C.red },
    { id: "존 템플턴", col: "#A78BFA" },
    { id: "파브라이", col: "#F472B6" },
    { id: "리루", col: "#34D399" },
    { id: "테리 스미스", col: "#FB923C" },
  ];

  const filtered = (() => {
    let q = catFilter === "전체" ? Q : Q.filter(r => r.cat === catFilter);
    if (whoFilter !== "전체") q = q.filter(r => (r.who || "워런 버핏") === whoFilter);
    return q;
  })();
  const current = filtered[idx] || filtered[0];
  const accent = CAT_COLOR[current?.cat] || C.gold;

  const prev = () => setIdx(i => (i - 1 + filtered.length) % filtered.length);
  const next = () => setIdx(i => (i + 1) % filtered.length);
  const changeCat = (cat) => { setCatFilter(cat); setIdx(0); };
  const changeWho = (who) => { setWhoFilter(who); setIdx(0); };

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>

      {/* ── 오늘의 어록 헤더 */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.gold}44`, borderRadius: 12, padding: "14px 16px", marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>

          <div>
            <div style={{ fontSize: 13, fontWeight: 900, color: C.gold, fontFamily: "monospace", letterSpacing: "0.05em" }}>📚 투자거장의 말</div>
            <div style={{ fontSize: 9, color: C.muted }}>투자거장 어록 {Q.length}선</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 8, color: C.muted }}>오늘의 어록</div>
            <div style={{ fontSize: 9, color: C.gold, fontWeight: 700, fontFamily: "monospace" }}>#{todayQ?.id}</div>
          </div>
        </div>
        {/* 오늘의 어록 카드 */}
        <div style={{ background: `${C.gold}0E`, border: `1px solid ${C.gold}33`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, color: CAT_COLOR[todayQ?.cat] || C.gold, fontWeight: 700, marginBottom: 5, letterSpacing: "0.06em" }}>
            {CAT_ICON[todayQ?.cat]} {todayQ?.cat}
          </div>
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.75, fontStyle: "italic", marginBottom: 6 }}>
            "{todayQ?.en}"
          </div>
          <div style={{ fontSize: 12, color: C.gold, lineHeight: 1.7, fontWeight: 600, marginBottom: 5 }}>
            "{todayQ?.ko}"
          </div>
          <div style={{ fontSize: 9, textAlign: "right" }}>
            {(() => {
              const s = todayQ?.src || "";
              if (s.includes(" — ")) {
                const [who, ...rest] = s.split(" — ");
                return <span>
                  <span style={{ color: C.gold }}>〈{who}〉</span>
                  <span style={{ color: C.muted }}> {rest.join(" — ")}</span>
                </span>;
              }
              return <span style={{ color: C.gold }}>〈{s}〉</span>;
            })()}
          </div>
        </div>
      </div>


      {/* ── 투자거장 필터 (가로 스크롤) */}
      <div style={{
        overflowX: "auto", marginBottom: 8, paddingBottom: 4,
        scrollbarWidth: "none", msOverflowStyle: "none"
      }}>
        <div style={{ display: "flex", gap: 5, width: "max-content" }}>
          {WHO_LIST.map(w => {
            const active = whoFilter === w.id;
            const cnt = w.id === "전체" ? Q.length : Q.filter(r => (r.who || "워런 버핏") === w.id).length;
            return (
              <button key={w.id} onClick={() => changeWho(w.id)} style={{
                background: active ? `${w.col}22` : C.card,
                border: `1px solid ${active ? w.col : C.border}`,
                borderRadius: 16, padding: "4px 11px",
                color: active ? w.col : C.muted,
                fontSize: 9, fontWeight: active ? 700 : 400,
                cursor: "pointer", transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}>
                {w.id}
                <span style={{
                  marginLeft: 4, fontSize: 8,
                  color: active ? w.col : C.border,
                  fontFamily: "monospace",
                }}>{cnt}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 카테고리 필터 */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
        {CATS.map(cat => {
          const active = catFilter === cat;
          const col = cat === "전체" ? C.gold : (CAT_COLOR[cat] || C.muted);
          return (
            <button key={cat} onClick={() => changeCat(cat)} style={{
              background: active ? `${col}22` : C.card,
              border: `1px solid ${active ? col : C.border}`,
              borderRadius: 20, padding: "5px 11px",
              color: active ? col : C.muted,
              fontSize: 10, fontWeight: active ? 700 : 400,
              cursor: "pointer", transition: "all 0.15s",
            }}>
              {cat === "전체" ? "전체" : CAT_ICON[cat] + " " + cat}
            </button>
          );
        })}
      </div>

      {/* ── 메인 어록 카드 */}
      {current && (
        <div style={{
          background: C.card, border: `1px solid ${accent}55`,
          borderRadius: 12, padding: "18px 16px", marginBottom: 12,
          boxShadow: `0 0 24px ${accent}10`,
        }}>
          {/* 카테고리 + 번호 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{
              background: `${accent}18`, border: `1px solid ${accent}44`,
              borderRadius: 16, padding: "4px 12px",
              fontSize: 10, color: accent, fontWeight: 700,
            }}>
              {CAT_ICON[current.cat]} {current.cat}
            </div>
            <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>
              #{current.id} / {filtered.length}
            </div>
          </div>

          {/* 영문 원문 */}
          <div style={{
            fontSize: 12, color: C.muted, lineHeight: 1.85, fontStyle: "italic",
            marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${C.border}`,
          }}>
            "{current.en}"
          </div>

          {/* 한국어 번역 */}
          <div style={{
            fontSize: 14, color: C.text, lineHeight: 1.8, fontWeight: 600,
            marginBottom: 12,
          }}>
            "{current.ko}"
          </div>

          {/* 출처 */}
          <div style={{ fontSize: 9, textAlign: "right" }}>
            {(() => {
              const s = current.src || "";
              if (s.includes(" — ")) {
                const [who, ...rest] = s.split(" — ");
                return <span>
                  <span style={{ color: C.gold }}>〈{who}〉</span>
                  <span style={{ color: C.muted }}> {rest.join(" — ")}</span>
                </span>;
              }
              return <span style={{ color: C.gold }}>〈{s}〉</span>;
            })()}
          </div>
        </div>
      )}

      {/* ── 네비게이션 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <button onClick={prev} style={{
          flex: 1, background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "10px", color: C.muted,
          fontSize: 13, cursor: "pointer", fontWeight: 700,
        }}>← 이전</button>

        <div style={{
          textAlign: "center", padding: "8px 16px",
          background: C.card2, borderRadius: 10, border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 10, color: C.muted }}>
            {catFilter === "전체" ? "전체" : CAT_ICON[catFilter] + " " + catFilter}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>
            {idx + 1} / {filtered.length}
          </div>
        </div>

        <button onClick={next} style={{
          flex: 1, background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "10px", color: C.muted,
          fontSize: 13, cursor: "pointer", fontWeight: 700,
        }}>다음 →</button>
      </div>

      {/* ── 카테고리별 어록 수 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
        <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, fontWeight: 700 }}>카테고리별 어록 수</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {CATS.filter(c => c !== "전체").map(cat => {
            const cnt = Q.filter(q => q.cat === cat).length;
            const col = CAT_COLOR[cat] || C.muted;
            return (
              <div key={cat} onClick={() => changeCat(cat)} style={{
                display: "flex", alignItems: "center", gap: 4,
                background: `${col}12`, border: `1px solid ${col}33`,
                borderRadius: 8, padding: "4px 8px", cursor: "pointer",
              }}>
                <span style={{ fontSize: 9 }}>{CAT_ICON[cat]}</span>
                <span style={{ fontSize: 9, color: col, fontWeight: 700 }}>{cat}</span>
                <span style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>{cnt}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
