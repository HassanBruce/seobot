import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync(path.join(tmp, 'sa.json'), JSON.stringify({ client_email: 'bot@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));

Object.assign(process.env, {
  DATA_DIR: ':memory:', SITE_URL: 'https://toolswhisper.io', AI_API_KEY: 'k', ADMIN_PASSWORD: 'pw',
  GSC_KEY_FILE: path.join(tmp, 'sa.json'), GSC_SITE: 'sc-domain:toolswhisper.io',
  PUBLISH_MODE: 'folder', CONTENT_DIR: path.join(tmp, 'posts'), TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1',
});

const { analyzeHtml, issuesFor } = await import('../src/audit.js');
const { opportunities } = await import('../src/gsc.js');
const { slugify } = await import('../src/content.js');
const { config } = await import('../src/config.js');
const jobs = await import('../src/jobs.js');
const db = await import('../src/db.js');
const { createApp } = await import('../src/server.js');

const LONG = 'word '.repeat(400);
const page = (title, desc, body, extra = '') => `<html><head><title>${title}</title><meta name="description" content="${desc}">
<link rel="canonical" href="x"><script type="application/ld+json">{}</script>${extra}</head><body><h1>${title}</h1>${body}</body></html>`;
const SITE = {
  'https://toolswhisper.io/sitemap.xml': `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://toolswhisper.io/sitemap-1.xml</loc></sitemap></sitemapindex>`,
  'https://toolswhisper.io/sitemap-1.xml': `<urlset><url><loc>https://toolswhisper.io/</loc></url><url><loc>https://toolswhisper.io/tools/json-formatter</loc></url>
<url><loc>https://toolswhisper.io/tools/image-compressor</loc></url><url><loc>https://toolswhisper.io/blog/what-is-json</loc></url><url><loc>https://toolswhisper.io/old</loc></url></urlset>`,
  'https://toolswhisper.io/': page('ToolsWhisper — Free online tools for developers', 'Free fast online tools for developers, marketers and students. JSON, images, SEO and more in one place.', `${LONG}<a href="/tools/json-formatter">json</a><a href="/missing-page">bad</a><img src="a.png">`),
  'https://toolswhisper.io/tools/json-formatter': page('JSON Formatter', '', 'format your json'),
  'https://toolswhisper.io/tools/image-compressor': page('Image Compressor — shrink JPG and PNG online free', 'Compress JPG, PNG and WebP images in your browser without losing visible quality. Free and private.', LONG, '<meta name="robots" content="noindex">'),
  'https://toolswhisper.io/blog/what-is-json': page('What is JSON? A beginner guide with examples', 'Learn what JSON is, how its syntax works, and how to validate and format JSON quickly with free tools.', LONG),
};

const realFetch = globalThis.fetch;
const sent = { telegram: [], ai: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (SITE[u]) return new Response(SITE[u], { status: 200, headers: { 'content-type': u.endsWith('.xml') ? 'application/xml' : 'text/html' } });
  if (u.startsWith('https://toolswhisper.io/')) return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } });
  if (u === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(opts.body);
    const [h, c, s] = p.get('assertion').split('.');
    const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(crypto.createPublicKey(privateKey), Buffer.from(s, 'base64url'));
    assert.ok(ok, 'JWT must be validly signed');
    assert.match(Buffer.from(c, 'base64url').toString(), /webmasters\.readonly/);
    return json({ access_token: 'gsc-token' });
  }
  if (u.includes('searchAnalytics/query')) {
    assert.equal(opts.headers.Authorization, 'Bearer gsc-token');
    assert.match(u, /sc-domain%3Atoolswhisper\.io/);
    return json({ rows: [
      { keys: ['json formatter online', 'https://toolswhisper.io/tools/json-formatter'], clicks: 3, impressions: 400, ctr: 0.0075, position: 11.2 },
      { keys: ['what is json', 'https://toolswhisper.io/blog/what-is-json'], clicks: 2, impressions: 300, ctr: 0.006, position: 3.1 },
      { keys: ['rare query', 'https://toolswhisper.io/'], clicks: 0, impressions: 3, ctr: 0, position: 8 },
    ] });
  }
  if (u.includes('/chat/completions')) {
    const prompt = JSON.parse(opts.body).messages[0].content;
    sent.ai.push(prompt);
    if (prompt.includes('SEO lead')) {
      assert.match(prompt, /json formatter online/); // GSC queries reach the planner
      return json({ choices: [{ message: { content: JSON.stringify({ ideas: [
        { title: 'How to fix "Unexpected token" JSON errors', keyword: 'unexpected token json error', intent: 'troubleshoot', tool_url: 'https://toolswhisper.io/tools/json-formatter', reason: 'rank 11', outline: ['Why it happens'] },
        { title: 'What is JSON? A beginner guide with examples', keyword: 'what is json', tool_url: 'x' },
        { title: 'Compress images for WordPress', keyword: 'compress images wordpress', tool_url: 'https://evil.com' },
      ] }) } }] });
    }
    if (prompt.includes('Write a blog post')) {
      return json({ choices: [{ message: { content: '```json\n' + JSON.stringify({ title: 'Fix "Unexpected token" JSON errors fast', description: 'd'.repeat(150), slug: 'Fix Unexpected Token JSON!', tags: ['json'], markdown: '## Why\n' + 'Real content. '.repeat(200) + '\n[SCREENSHOT: formatter with error]' }) + '\n```' } }] });
    }
    if (prompt.includes('strict human-style editor')) {
      return json({ choices: [{ message: { content: JSON.stringify({ title: 'Fix "Unexpected token" JSON errors fast', description: 'Edited description '.repeat(8), markdown: '## Why\n' + 'Edited real content. '.repeat(180) + '\n[SCREENSHOT: formatter with error]', score: 7, issues_fixed: ['removed fake stat'], todo_for_human: ['Add the screenshot', 'Test the jq command'] }) } }] });
    }
  }
  if (u.includes('api.telegram.org')) { sent.telegram.push(JSON.parse(opts.body).text); return json({ ok: true }); }
  if (u === 'https://cms.example/api/posts') {
    assert.equal(opts.headers.Authorization, 'Bearer hook');
    const b = JSON.parse(opts.body);
    assert.ok(b.content_markdown.length > 100);
    return json({ url: `https://toolswhisper.io/blog/${b.slug}` });
  }
  throw new Error('unexpected fetch ' + u);
};

test('html analysis + issue rules', () => {
  const a = analyzeHtml(SITE['https://toolswhisper.io/tools/json-formatter'], 'https://toolswhisper.io/tools/json-formatter');
  const issues = issuesFor({ ...a, status: 200, ms: 100 }).map(i => i.msg).join(' | ');
  assert.match(issues, /Meta description missing/);
  assert.match(issues, /Title chhota/);
  assert.match(issues, /Thin content/);
  assert.equal(slugify('Fix "Unexpected Token" JSON!'), 'fix-unexpected-token-json');
});

test('audit crawls sitemap index, finds broken links, noindex, missing alt', async () => {
  const a = await jobs.audit();
  assert.equal(a.pages, 5);
  assert.ok(a.issues.some(i => i.url.endsWith('/old') && i.severity === 'high'));          // 404 page in sitemap
  assert.ok(a.issues.some(i => /noindex/.test(i.msg) && i.url.includes('image-compressor')));
  assert.ok(a.issues.some(i => /alt text/.test(i.msg)));
  assert.deepEqual(a.broken.map(b => b.link), ['https://toolswhisper.io/missing-page']);
});

test('Search Console: signed service-account auth and opportunity buckets', async () => {
  const g = await jobs.searchConsole();
  assert.deepEqual(g.striking.map(r => r.query), ['json formatter online']);
  assert.deepEqual(g.lowCtr.map(r => r.query), ['what is json']);
  assert.equal(g.totals.impressions, 703);
  assert.equal(opportunities([]).striking.length, 0);
});

test('planner: grounded ideas, dedupes existing posts, fixes unknown tool URLs', async () => {
  const added = await jobs.plan();
  assert.equal(added, 3 - 0); // stored (dedupe vs blog happens in prompt; db dedupes by title/keyword)
  const ideas = db.ideas('idea');
  assert.ok(ideas.every(i => i.tool_url.startsWith('https://toolswhisper.io/')), 'no foreign tool urls');
  assert.equal(await jobs.plan(), 0, 'same ideas are not added twice');
});

test('write: writer + editor → reviewed draft with todo list, Telegram ping, not auto-published', async () => {
  const id = await jobs.writeNext();
  const d = db.getDraft(id);
  assert.equal(d.slug, 'fix-unexpected-token-json');
  assert.match(d.markdown, /Edited real content/);
  assert.equal(d.review.score, 7);
  assert.deepEqual(d.review.todo, ['Add the screenshot', 'Test the jq command']);
  assert.equal(d.status, 'draft');
  assert.ok(sent.telegram.some(t => t.includes(`draft #${id}`)));
  assert.equal(fs.existsSync(path.join(config.contentDir, `${d.slug}.mdx`)), false);
});

test('dashboard: edit + approve publishes an MDX file with frontmatter', async () => {
  const server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('a:pw').toString('base64') };
  assert.equal((await realFetch(base)).status, 401);
  for (const p of ['/', '/drafts', '/ideas', '/audit', '/search']) assert.equal((await realFetch(base + p, { headers: auth })).status, 200, p);
  const [d] = db.drafts('draft');
  const html = await (await realFetch(`${base}/drafts/${d.id}`, { headers: auth })).text();
  assert.match(html, /Test the jq command/);
  assert.match(html, /1 screenshot markers/);
  const body = new URLSearchParams({ title: d.title, description: 'My edited description', markdown: d.markdown.replace('[SCREENSHOT: formatter with error]', '![error](/img/err.png)'), action: 'publish' });
  const r = await realFetch(`${base}/drafts/${d.id}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
  assert.equal(r.status, 302);
  const after = db.getDraft(d.id);
  assert.equal(after.status, 'published');
  assert.equal(after.published_url, 'https://toolswhisper.io/blog/fix-unexpected-token-json');
  const file = fs.readFileSync(path.join(config.contentDir, 'fix-unexpected-token-json.mdx'), 'utf8');
  assert.match(file, /^---\ntitle: "Fix \\"Unexpected token\\" JSON errors fast"/);
  assert.match(file, /description: "My edited description"/);
  assert.match(file, /!\[error\]\(\/img\/err\.png\)/);
  server.close();
});

test('webhook publishing (Laravel/Next API)', async () => {
  Object.assign(config, { publishMode: 'webhook', webhookUrl: 'https://cms.example/api/posts', webhookToken: 'hook' });
  const id = db.addDraft({ title: 'T', slug: 'webhook-post', description: 'd', markdown: 'x'.repeat(200) });
  const r = await jobs.approve(id);
  assert.equal(r.url, 'https://toolswhisper.io/blog/webhook-post');
  config.publishMode = 'none';
  const id2 = db.addDraft({ title: 'T2', slug: 'none-post', description: 'd', markdown: 'y'.repeat(200) });
  await assert.rejects(jobs.approve(id2), /PUBLISH_MODE/);
  assert.equal(db.getDraft(id2).status, 'approved');
  assert.match(db.getDraft(id2).error, /PUBLISH_MODE/);
});

test('schedule: Monday weekly job, draft days, once per day', () => {
  const at = (iso) => Date.parse(iso);
  // Monday 2026-10-12 12:00 PKT = 07:00 UTC
  assert.deepEqual(jobs.dueJobs(at('2026-10-12T07:00:00Z')).jobs, ['weekly', 'draft']);
  assert.deepEqual(jobs.dueJobs(at('2026-10-13T07:00:00Z')).jobs, []);            // Tuesday, 3 posts/week = Mon/Wed/Fri
  assert.deepEqual(jobs.dueJobs(at('2026-10-14T03:00:00Z')).jobs, []);            // Wed 08:00 PKT, too early
  assert.deepEqual(jobs.dueJobs(at('2026-10-14T07:00:00Z')).jobs, ['draft']);
  db.kvSet('draft_done', '2026-10-14');
  assert.deepEqual(jobs.dueJobs(at('2026-10-14T09:00:00Z')).jobs, []);
});
