
import csv, json
from pathlib import Path
BASE = Path(__file__).resolve().parent
TEMPLATES = BASE / "templates"
def read_csv(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))
def to_number(value):
    if value is None or value == "": return None
    try: return float(value) if "." in value else int(value)
    except ValueError: return value
def normalize_rows(rows):
    return [{k: to_number(v) for k, v in row.items()} for row in rows]
def build_json(meta, annual_csv, quarterly_csv, monthly_csv, output_json):
    annual = normalize_rows(read_csv(annual_csv))
    quarterly = normalize_rows(read_csv(quarterly_csv))
    monthly = normalize_rows(read_csv(monthly_csv))
    shares = int(meta.get("shares", 0)); current_price = float(meta.get("currentPrice", 0)); prev_close = float(meta.get("prevClose", current_price)); ttm = meta.get("ttm", {})
    result = {
        "corp_name": meta["corp_name"], "stock_code": meta["stock_code"], "corp_code": meta["corp_code"], "market": meta.get("market", "KOSPI"), "shares": shares,
        "price": {"currentPrice": current_price, "prevClose": prev_close, "change": current_price - prev_close, "changePct": ((current_price / prev_close - 1) * 100) if prev_close else 0},
        "annual": annual, "quarterly": quarterly,
        "ttm": {"revenue": ttm.get("revenue", 0), "op": ttm.get("op", 0), "net": ttm.get("net", 0), "eps": ttm.get("eps", 0), "bps": ttm.get("bps", 0), "fcf": ttm.get("fcf", 0), "fcf_per_share": (ttm.get("fcf", 0) / shares) if shares else 0, "per": (current_price / ttm.get("eps", 1)) if ttm.get("eps") else 0, "pbr": (current_price / ttm.get("bps", 1)) if ttm.get("bps") else 0},
        "monthly": monthly, "meta": {"updatedAt": meta.get("updatedAt", "YYYY-MM-DD"), "source": {"price":"STATIC_INPUT","financial":"STATIC_INPUT"}}
    }
    with open(output_json, "w", encoding="utf-8") as f: json.dump(result, f, ensure_ascii=False, indent=2)
if __name__ == "__main__":
    sample_meta = {"corp_name":"회사명","stock_code":"000000","corp_code":"00000000","market":"KOSPI","shares":1000000,"currentPrice":10000,"prevClose":9800,"updatedAt":"2026-04-14","ttm":{"revenue":100000,"op":10000,"net":8000,"eps":800,"bps":12000,"fcf":7000}}
    out = BASE / "sample_output.json"
    build_json(sample_meta, TEMPLATES / "annual_template.csv", TEMPLATES / "quarterly_template.csv", TEMPLATES / "monthly_template.csv", out)
    print(f"created: {out}")
