import { config } from './config.js';

export async function chatJson(prompt, { temperature = 0.6, retries = 3 } = {}) {
  if (!config.aiApiKey) throw new Error('AI_API_KEY missing in .env');
  let last;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`${config.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiApiKey}` },
      body: JSON.stringify({ model: config.aiModel, temperature, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
    });
    if ([429, 500, 502, 503].includes(res.status)) {
      last = new Error(`AI ${res.status}`);
      await new Promise(r => setTimeout(r, 4000 * (i + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const text = (await res.json()).choices?.[0]?.message?.content ?? '';
    const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  }
  throw last;
}
