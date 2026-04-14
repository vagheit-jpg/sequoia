const DART_BASE = 'https://opendart.fss.or.kr/api';

export function getDartKey() {
  const key = process.env.DART_API_KEY;
  if (!key) throw new Error('DART_API_KEY is missing');
  return key;
}

export async function dartGetJson<T>(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ crtfc_key: getDartKey(), ...params });
  const res = await fetch(`${DART_BASE}/${path}?${qs.toString()}`, {
    next: { revalidate: 3600 },
    cache: 'force-cache',
  });
  if (!res.ok) throw new Error(`DART HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
