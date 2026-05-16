// api/jarvis.js — 자비스 Claude API Route
// @anthropic-ai/sdk 없이 fetch로 직접 호출 (package.json 수정 불필요)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { system, prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt 없음' });

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API 키 없음' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: system || '당신은 자비스입니다. 오건영 스타일로 쉽게 설명합니다.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `Claude API 오류: ${err}` });
    }

    const data = await response.json();
    const interpretation = data.content?.[0]?.text || '';

    return res.status(200).json({ interpretation });

  } catch (err) {
    console.error('자비스 API 오류:', err);
    return res.status(500).json({ error: err.message });
  }
}
