"""
세콰이어 프로젝트 — 스마트머니 엔진
STEP 2: Pykrx 일별 수급 수집 스크립트
- 코스피200 + 코스닥150 + 커스텀 종목
- 매일 장마감 후 GitHub Actions에서 실행
- Supabase smart_money_daily 테이블에 적재
"""

import os
import time
import logging
from datetime import datetime, date, timedelta

import pandas as pd
from pykrx import stock
from supabase import create_client, Client

# ────────────────────────────────────────────
# 설정
# ────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
log = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ────────────────────────────────────────────
# 유니버스 로드
# ────────────────────────────────────────────

def get_universe() -> list[dict]:
    """Supabase에서 활성 종목 전체 로드"""
    res = supabase.table("stock_universe").select("*").eq("is_active", True).execute()
    return res.data

def get_kospi200_tickers(date_str: str) -> list[str]:
    """Pykrx로 코스피200 구성종목 조회"""
    try:
        tickers = stock.get_index_portfolio_deposit_file("1028", date_str)
        return list(tickers)
    except Exception as e:
        log.warning(f"코스피200 조회 실패: {e}")
        return []

def get_kosdaq150_tickers(date_str: str) -> list[str]:
    """Pykrx로 코스닥150 구성종목 조회"""
    try:
        tickers = stock.get_index_portfolio_deposit_file("2203", date_str)
        return list(tickers)
    except Exception as e:
        log.warning(f"코스닥150 조회 실패: {e}")
        return []

# ────────────────────────────────────────────
# SMA 지수 계산
# ────────────────────────────────────────────

def calc_sma_score(
    foreign_net_value: float,
    institution_net_value: float,
    trading_value: float,
    foreign_net_20d_avg: float,
    institution_net_20d_avg: float,
) -> dict:
    """
    SMA 3대 지수 계산
    - 가속도: 평소 대비 에너지
    - 동기화: 외인+기관 공동전선
    - 점유율: 시장 지배력
    """
    # 1. 가속도 필터
    foreign_acc = 0.0
    institution_acc = 0.0

    if foreign_net_20d_avg and abs(foreign_net_20d_avg) > 0:
        foreign_acc = foreign_net_value / abs(foreign_net_20d_avg)
    if institution_net_20d_avg and abs(institution_net_20d_avg) > 0:
        institution_acc = institution_net_value / abs(institution_net_20d_avg)

    acceleration = (foreign_acc + institution_acc) / 2

    # 2. 동기화 필터
    def sign(x):
        if x > 0: return 1
        elif x < 0: return -1
        return 0

    sync = sign(foreign_net_value) + sign(institution_net_value)

    # 3. 점유율 필터
    dominance = 0.0
    if trading_value and trading_value > 0:
        dominance = ((foreign_net_value + institution_net_value) / trading_value) * 100

    # 4. 종합 SMA 점수
    score = (acceleration * 0.5) + (sync * 0.3) + (dominance * 0.2)

    # 5. 시그널 판정
    if score > 3.0:
        signal = "SUPERNOVA"       # 초신성 유입
    elif score > 1.5:
        signal = "ACCUMULATION"    # 스마트머니 매집
    elif score > -1.0:
        signal = "NOISE"           # 노이즈 구간
    else:
        signal = "ESCAPE"          # 스마트머니 탈출

    return {
        "sma_acceleration": round(acceleration, 4),
        "sma_sync": sync,
        "sma_dominance": round(dominance, 4),
        "sma_score": round(score, 4),
        "sma_signal": signal,
    }

# ────────────────────────────────────────────
# 수집 메인
# ────────────────────────────────────────────

def collect_daily(target_date: str):
    """
    특정 날짜의 수급 데이터 수집 및 적재
    target_date: 'YYYYMMDD'
    """
    log.info(f"=== 수집 시작: {target_date} ===")

    # 유니버스 구성
    kospi200 = get_kospi200_tickers(target_date)
    kosdaq150 = get_kosdaq150_tickers(target_date)
    custom_stocks = get_universe()
    custom_tickers = [s["ticker"] for s in custom_stocks]

    all_tickers = list(set(kospi200 + kosdaq150 + custom_tickers))
    log.info(f"총 종목 수: {len(all_tickers)}개 (코스피200: {len(kospi200)}, 코스닥150: {len(kosdaq150)}, 커스텀: {len(custom_tickers)})")

    # 20일 전 날짜 (가속도 계산용 이동평균)
    target_dt = datetime.strptime(target_date, "%Y%m%d")
    from_date = (target_dt - timedelta(days=30)).strftime("%Y%m%d")

    rows = []
    errors = []

    for i, ticker in enumerate(all_tickers):
        try:
            # 투자자별 순매수 (20일치)
            df_investor = stock.get_market_trading_value_by_date(
                from_date, target_date, ticker
            )

            if df_investor is None or df_investor.empty:
                continue

            # 오늘 행
            today_row = df_investor[df_investor.index == target_dt]
            if today_row.empty:
                continue

            # 컬럼명 정리 (pykrx 버전마다 다를 수 있음)
            cols = df_investor.columns.tolist()

            def get_col(keywords):
                for k in keywords:
                    for c in cols:
                        if k in c:
                            return c
                return None

            foreign_col = get_col(["외국인", "외국"])
            institution_col = get_col(["기관", "기관계"])
            individual_col = get_col(["개인"])

            foreign_net_value = int(today_row[foreign_col].values[0]) if foreign_col else 0
            institution_net_value = int(today_row[institution_col].values[0]) if institution_col else 0
            individual_net_value = int(today_row[individual_col].values[0]) if individual_col else 0

            # 20일 평균 (가속도용)
            recent = df_investor.iloc[-21:-1]  # 오늘 제외 20일
            foreign_20d_avg = float(recent[foreign_col].mean()) if foreign_col and len(recent) > 0 else 0
            institution_20d_avg = float(recent[institution_col].mean()) if institution_col and len(recent) > 0 else 0

            # OHLCV (거래대금)
            df_ohlcv = stock.get_market_ohlcv_by_date(target_date, target_date, ticker)
            close = 0
            volume = 0
            trading_value = 0

            if df_ohlcv is not None and not df_ohlcv.empty:
                row_ohlcv = df_ohlcv.iloc[0]
                close = int(row_ohlcv.get("종가", row_ohlcv.get("Close", 0)))
                volume = int(row_ohlcv.get("거래량", row_ohlcv.get("Volume", 0)))
                trading_value = int(row_ohlcv.get("거래대금", 0))

            # SMA 계산
            sma = calc_sma_score(
                foreign_net_value=foreign_net_value,
                institution_net_value=institution_net_value,
                trading_value=trading_value,
                foreign_net_20d_avg=foreign_20d_avg,
                institution_net_20d_avg=institution_20d_avg,
            )

            rows.append({
                "ticker": ticker,
                "trade_date": target_dt.strftime("%Y-%m-%d"),
                "close": close,
                "volume": volume,
                "trading_value": trading_value,
                "foreign_net_value": foreign_net_value,
                "institution_net_value": institution_net_value,
                "individual_net_value": individual_net_value,
                **sma,
            })

            # API 과부하 방지
            if (i + 1) % 50 == 0:
                log.info(f"진행: {i+1}/{len(all_tickers)}")
                time.sleep(1)

        except Exception as e:
            errors.append({"ticker": ticker, "error": str(e)})
            continue

    # Supabase 적재
    if rows:
        # upsert (중복 방지)
        res = supabase.table("smart_money_daily").upsert(
            rows, on_conflict="ticker,trade_date"
        ).execute()
        log.info(f"✅ 적재 완료: {len(rows)}행")
    else:
        log.warning("⚠️ 적재할 데이터 없음")

    if errors:
        log.warning(f"⚠️ 오류 종목 {len(errors)}개: {[e['ticker'] for e in errors[:10]]}")

    log.info(f"=== 수집 완료: {target_date} ===")
    return len(rows)


# ────────────────────────────────────────────
# 실행
# ────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        # 특정 날짜 지정: python collect_smart_money.py 20260415
        target = sys.argv[1]
    else:
        # 기본: 어제 (장마감 후 실행 기준)
        target = (date.today() - timedelta(days=1)).strftime("%Y%m%d")

    collect_daily(target)
