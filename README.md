# sequoia quantum system

Next.js + Vercel 배포형 대시보드입니다.

## 핵심 기능
- 한글 종목명 실시간 검색 (OpenDART corpCode.xml 기반)
- 실시간 시세: 키움 REST 우선, 실패 시 Yahoo 폴백
- 월봉 차트: Yahoo 월봉 + 60월선 + 이격도 신호
- 재무: OpenDART fresh fetch 우선
- 그래프: 분기 중심, 주요지표만 연간/분기 전환
- DCF: 최근 연간 FCF 기준 3시나리오
- 다크/라이트 모드

## 실행
```bash
npm install
npm run dev
```

## 배포
GitHub 업로드 후 Vercel에서 **Framework Preset = Next.js**, **Output Directory 비움**으로 배포하세요.

## 필수 환경변수
- `DART_API_KEY`
- `KIWOOM_APP_KEY`
- `KIWOOM_SECRET_KEY`
- `KIWOOM_QUOTE_URL`
- `KIWOOM_QUOTE_API_ID`
- `USE_KIWOOM_QUOTE=true`

## 메모
- 재무는 샘플 JSON 우선 로딩을 제거했습니다.
- OpenDART `013`은 다음 분기/연도로 fallback 탐색합니다.
- 분기 수익성/현금흐름은 누적값을 차분 계산하여 분기값으로 변환합니다.
