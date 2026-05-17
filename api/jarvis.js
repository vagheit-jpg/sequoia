// api/jarvis.js — 자비스 Claude API Route (웹서치 지원)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { system, prompt, useWebSearch = false } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt 없음' });

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API 키 없음' });

    const body = {
      model:    'claude-sonnet-4-6',
      max_tokens: 800,
      system:   system || '당신은 자비스입니다. 오건영 스타일로 쉽게 설명합니다.',
      messages: [{ role: 'user', content: prompt }],
    };

    // 웹서치 툴 추가 (요청 시)
    if (useWebSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `Claude API 오류: ${err}` });
    }

    const data = await response.json();
    // 텍스트 블록만 추출 (웹서치 결과 블록 제외)
    const interpretation = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || '';

    return res.status(200).json({ interpretation });
  } catch (err) {
    console.error('자비스 API 오류:', err);
    return res.status(500).json({ error: err.message });
  }
}
