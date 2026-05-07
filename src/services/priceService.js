import { PRICE_CACHE_TTL } from "../constants/cache";

export const fetchPrice = async (ticker, market) => {
  try {
    const raw = localStorage.getItem(`sq_price_v2_${ticker}`);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < PRICE_CACHE_TTL && data?.monthly?.length) return data;
    }
  } catch {}

  try {
    const mkt = market || "";
    const res = await fetch(`/api/price?ticker=${ticker}${mkt ? `&market=${mkt}` : ""}`);
    if (!res.ok) throw new Error(`price API ${res.status}`);

    const data = await res.json();
    if (!data?.monthly?.length) return null;

    try {
      localStorage.setItem(`sq_price_v2_${ticker}`, JSON.stringify({ data, ts: Date.now() }));
    } catch {}

    return data;
  } catch (e) {
    console.warn("[fetchPrice] 실패:", e.message);
    return null;
  }
};
