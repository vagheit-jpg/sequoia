// 1차 시공에서는 실제 API 연결 대신 함수 껍데기만 둡니다.
// 2차 시공부터 /api/corplist, /api/yahoo, /api/dart, /api/price를 연결합니다.

export async function searchCorpList() {
  return [];
}

export async function fetchPrice() {
  return null;
}

export async function fetchYahooMonthly() {
  return [];
}

export async function fetchDartAnnual() {
  return [];
}
