// api/jarvis.js — 자비스 Claude API Route
// 세콰이어 /api/ 폴더 구조에 맞춤 (macro.js, price.js와 동일한 방식)

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { system, prompt } = req.body;

    if (!prompt) return res.status(400).json({ error: 'prompt 없음' });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: system || '당신은 자비스입니다. 오건영 스타일로 쉽게 설명합니다.',
      messages: [{ role: 'user', content: prompt }],
    });

    const interpretation = message.content[0].text;

    return res.status(200).json({ interpretation });

  } catch (err) {
    console.error('자비스 API 오류:', err);
    return res.status(500).json({ error: err.message });
  }
}
