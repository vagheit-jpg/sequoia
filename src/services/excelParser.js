import * as XLSX from "xlsx";

const FIELD_MAP = {
  "매출액":"rev","영업이익":"op","당기순이익":"net","영업이익률":"opm","순이익률":"npm",
  "자산총계":"assets","부채총계":"liab","자본총계":"equity","부채비율":"debt","자본유보율":"retained",
  "영업활동현금흐름":"cfo","투자활동현금흐름":"cfi","재무활동현금흐름":"cff","FCF":"fcf",
  "ROE(%)":"roe","ROA(%)":"roa","EPS(원)":"eps","BPS(원)":"bps",
  "PER(배)":"per","PBR(배)":"pbr","발행주식수(보통주)":"shares",
  "설비투자(CAPEX)":"capex","현금DPS(원)":"dps","현금배당수익률":"divYield","현금배당성향(%)":"divPayout",
};

const parseSheet = (sheet) => {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return [];

  const isYear = (v) => /^20[0-9]{2}/.test(String(v || "").trim());

  let hIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if (rows[i].slice(1).filter(isYear).length >= 1) {
      hIdx = i;
      break;
    }
  }

  if (hIdx === -1) return [];

  const periods = rows[hIdx]
    .slice(1)
    .map((h) => String(h || "").replace(/\n/g, " ").trim())
    .filter(Boolean);

  if (!periods.length) return [];

  const result = periods.map((p) => ({ period: p }));

  rows.slice(hIdx + 1).forEach((row) => {
    const label = String(row[0] || "").trim();
    const field = FIELD_MAP[label];

    if (!field) return;

    periods.forEach((p, i) => {
      const raw = String(row[i + 1] || "").replace(/,/g, "").trim();
      result[i][field] =
        raw === "" || raw === "-" || raw === "N/A" ? null : parseFloat(raw);
    });
  });

  return result;
};

const exYear = (p) => {
  const m = String(p || "").match(/^(20[0-9]{2})/);
  return m ? parseInt(m[1]) : 0;
};

const exMonth = (p) => {
  const m = String(p || "").match(/[\/\.]([0-9]{1,2})/);
  return m ? parseInt(m[1]) : 12;
};

const parseAnn = (sheet) =>
  parseSheet(sheet)
    .map((r) => ({ ...r, year: exYear(r.period) }))
    .filter((r) => r.year > 0);

const parseQtr = (sheet) =>
  parseSheet(sheet)
    .map((r) => {
      const year = exYear(r.period);
      const month = exMonth(r.period);
      const quarter = Math.ceil(month / 3);

      return {
        ...r,
        year,
        month,
        quarter,
        label: `${year}Q${quarter}`,
      };
    })
    .filter((r) => r.year > 0);

const parseDiv = (sheet) =>
  parseSheet(sheet)
    .map((r) => ({ ...r, year: exYear(r.period) }))
    .filter((r) => r.year > 0 && r.dps != null);

export const parseExcel = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const find = (kws) => wb.SheetNames.find((n) => kws.some((k) => n.includes(k)));

        resolve({
          ticker: file.name.match(/^(\d{6})/)?.[1] || "",
          name: file.name.replace(/\.xlsx?$/, "").replace(/^\d{6}_/, ""),
          annData: parseAnn(wb.Sheets[find(["연간", "①"])] || {}),
          qtrData: parseQtr(wb.Sheets[find(["분기", "②"])] || {}),
          divData: parseDiv(wb.Sheets[find(["배당", "③"])] || {}),
        });
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
