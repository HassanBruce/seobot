import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';

/** Google Search Console via a service account (free). */
export const gscEnabled = () => !!(config.gscKeyFile && config.gscSite && fs.existsSync(config.gscKeyFile));

const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function token() {
  const key = JSON.parse(fs.readFileSync(config.gscKeyFile, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  if (!res.ok) throw new Error(`GSC auth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

export async function query({ days = 28, dimensions = ['query', 'page'], rowLimit = 1000 } = {}) {
  const end = new Date(Date.now() - 2 * 86400_000); // GSC data lags ~2 days
  const start = new Date(end.getTime() - days * 86400_000);
  const d = x => x.toISOString().slice(0, 10);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.gscSite)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ startDate: d(start), endDate: d(end), dimensions, rowLimit }),
  });
  if (!res.ok) throw new Error(`GSC query ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()).rows ?? []).map(r => ({
    query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
  }));
}

/**
 * Opportunities:
 *  - striking: ranking 5–20 with real impressions → improve that page / write supporting post
 *  - lowCtr: top-5 ranking but CTR under 2% → rewrite title/description
 */
export function opportunities(rows, { minImpressions = 20 } = {}) {
  const striking = rows.filter(r => r.position >= 5 && r.position <= 20 && r.impressions >= minImpressions)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 30);
  const lowCtr = rows.filter(r => r.position < 5 && r.impressions >= minImpressions * 2 && r.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 20);
  const totals = rows.reduce((t, r) => ({ clicks: t.clicks + r.clicks, impressions: t.impressions + r.impressions }), { clicks: 0, impressions: 0 });
  return { striking, lowCtr, totals, queries: rows.length };
}
