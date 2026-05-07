import { SB_URL, SB_KEY } from "../constants/supabase";

const sbFetch = async (path, opts = {}) => {
  const { headers: extraHeaders = {}, ...restOpts } = opts;

  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
    ...restOpts,
  });

  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
};

export const sbGetStocks = () => sbFetch("stocks?select=*&order=name");

export const sbUpsertStock = (s) =>
  sbFetch("stocks?on_conflict=ticker", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      ticker: s.ticker,
      name: s.name,
      ann_data: s.annData || [],
      qtr_data: s.qtrData || [],
      div_data: s.divData || [],
      updated_at: new Date().toISOString(),
    }),
  });

export const sbUpsertPredictionSnapshot = (snapshot) =>
  sbFetch("sefcon_prediction_snapshots?on_conflict=snapshot_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(snapshot),
  });

export const sbDeleteStock = (ticker) =>
  sbFetch(`stocks?ticker=eq.${ticker}`, { method: "DELETE" });

export const rowToStock = (r) => ({
  ticker: r.ticker,
  name: r.name,
  annData: r.ann_data || [],
  qtrData: r.qtr_data || [],
  divData: r.div_data || [],
});
