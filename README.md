# Sequoia MVP

빠르고 고급스럽게 핵심 5기능만 담은 국내주식 대시보드입니다.

## 포함 기능
- 실시간 주가: 키움 REST API 우선, 실패 시 Yahoo 폴백
- 월봉 차트: Yahoo 월봉 + 60월선 + 이격도 신호
- 재무제표: FnGuide 캐시 JSON 또는 서버 스크래핑
- 재무 그래프: 5개년 주요지표, 주가-EPS, 주가-FCF, 부채/유동비율
- DCF 적정가치: 최근 연간 FCF 기준 단순 모델

## 실행
```bash
npm install
npm run dev
```

## 빌드
```bash
npm run build
```

## 배포
이 폴더 전체를 GitHub에 올린 뒤 Vercel로 import 하면 됩니다.

## 환경변수
`.env.example`를 참고해 Vercel 환경변수에 맞춰 등록하세요.

### 이미 키움 키를 Vercel에 넣어둔 경우
다음 이름으로 맞춰 두면 바로 인식됩니다.
- `KIWOOM_APP_KEY`
- `KIWOOM_SECRET_KEY`
- `USE_KIWOOM_QUOTE`
- `KIWOOM_QUOTE_URL`
- `KIWOOM_QUOTE_API_ID`

## 재무 캐시 갱신
```bash
npm run fetch:financials 005930
```
생성 위치:
- `public/data/financials/005930.json`

## 기본 종목
- 삼성전자 005930 샘플 캐시 포함

## 주의
- FnGuide HTML 구조가 바뀌면 파서 수정이 필요합니다.
- 키움 현재가 TR은 사용자의 승인/설정된 REST API 항목에 맞춰 `KIWOOM_QUOTE_URL`, `KIWOOM_QUOTE_API_ID`를 넣어야 합니다.
- Yahoo 월봉은 대체 데이터 소스입니다.
