import express from 'express';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import * as db from './db.js';
import * as jobs from './jobs.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let running = { busy: false, text: '' };

function layout(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${running.busy ? '<meta http-equiv="refresh" content="10">' : ''}
<style>
:root{--bg:#f6f6f2;--card:#fff;--ink:#1b1c19;--mute:#6b6d66;--line:#e2e1da;--accent:#2b59c3;--high:#b42318;--med:#a35a00;--ok:#13734f}
@media (prefers-color-scheme:dark){:root{--bg:#111210;--card:#1a1b18;--ink:#eaeae5;--mute:#9b9d95;--line:#2c2d29;--accent:#7d9bf3;--high:#f0776c;--med:#e7a14f;--ok:#45bf88}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:19px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:22px 0 8px}
nav{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 4px}nav a{color:var(--accent);text-decoration:none;font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}.mute{color:var(--mute);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}@media(min-width:640px){.grid{grid-template-columns:repeat(4,1fr)}}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}.stat b{display:block;font-size:22px}.stat span{color:var(--mute);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:7px 6px;border-top:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:500;border-top:0}
.scroll{overflow-x:auto}.high{color:var(--high);font-weight:600}.medium{color:var(--med)}.low{color:var(--mute)}
button,input,textarea{font:inherit;padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button{cursor:pointer}.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
textarea{width:100%;min-height:520px;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pill{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:1px 9px}
a{color:var(--accent)}ul{margin:6px 0;padding-left:20px}
</style></head><body><main>
<div class="row" style="justify-content:space-between"><h1>SEO assistant · ${esc(config.siteName)}</h1><span class="mute">${esc(running.text)}</span></div>
<nav><a href="/">Overview</a><a href="/drafts">Drafts</a><a href="/ideas">Ideas</a><a href="/audit">Audit</a><a href="/search">Search Console</a></nav>
${body}</main></body></html>`;
}

function run(name, fn) {
  if (running.busy) return;
  running = { busy: true, text: `${name}…` };
  fn().then(r => { running = { busy: false, text: `${name}: done${typeof r === 'number' ? ` (${r})` : ''}` }; })
    .catch(e => { running = { busy: false, text: `${name} failed: ${e.message}` }; });
}

const actions = () => `<form method="post" class="row">
<button formaction="/run/audit" ${running.busy ? 'disabled' : ''}>Run audit</button>
<button formaction="/run/plan" ${running.busy ? 'disabled' : ''}>New ideas</button>
<button formaction="/run/write" class="primary" ${running.busy ? 'disabled' : ''}>Write next post</button></form>`;

export function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use((req, res, next) => {
    if (!config.adminPassword) return res.status(503).send('Set ADMIN_PASSWORD in .env');
    const [, b64] = (req.get('authorization') ?? '').split(' ');
    const pass = Buffer.from(b64 ?? '', 'base64').toString().split(':').slice(1).join(':');
    if (pass === config.adminPassword) return next();
    res.set('WWW-Authenticate', 'Basic realm="seo"').sendStatus(401);
  });

  app.get('/', (_req, res) => {
    const a = db.latestReport('audit'), g = db.latestReport('gsc');
    res.send(layout('SEO', `
<div class="grid" style="margin-top:12px">
<div class="stat"><b>${db.drafts('draft').length}</b><span>Drafts to review</span></div>
<div class="stat"><b>${db.drafts('published').length}</b><span>Published by bot</span></div>
<div class="stat"><b class="${a?.counts.high ? 'high' : ''}">${a ? a.counts.high : '-'}</b><span>High issues</span></div>
<div class="stat"><b>${g ? g.totals.clicks : '-'}</b><span>Clicks (28 din)</span></div></div>
<h2>Actions</h2><div class="card">${actions()}<p class="mute">Bot khud: Monday audit + ideas + report, aur hafte mein ${config.postsPerWeek} drafts. Publish sirf tumhare Approve pe${config.autoPublish ? ' (AUTO_PUBLISH on hai)' : ''}.</p></div>
<h2>Is hafte ka kaam</h2><div class="card"><ul>
${db.drafts('draft').slice(0, 5).map(d => `<li><a href="/drafts/${d.id}">${esc(d.title)}</a> <span class="mute">score ${d.review.score ?? '-'}</span></li>`).join('') || '<li class="mute">Koi draft pending nahi.</li>'}
${a ? a.issues.filter(i => i.severity === 'high').slice(0, 5).map(i => `<li class="high">${esc(i.msg)} <span class="mute">${esc(i.url)}</span></li>`).join('') : '<li class="mute">Audit abhi nahi chala.</li>'}
${g ? g.lowCtr.slice(0, 3).map(r => `<li>Title/description behtar karo: "${esc(r.query)}" pe rank ${r.position.toFixed(1)} lekin CTR ${(r.ctr * 100).toFixed(1)}% <span class="mute">${esc(r.page)}</span></li>`).join('') : ''}
</ul></div>`));
  });

  app.get('/drafts', (_req, res) => {
    res.send(layout('Drafts', `<h2>Drafts</h2><div class="card scroll"><table><tr><th>#</th><th>Title</th><th>Keyword</th><th>Score</th><th>Status</th></tr>
${db.drafts().map(d => `<tr><td>${d.id}</td><td><a href="/drafts/${d.id}">${esc(d.title)}</a></td><td class="mute">${esc(d.keyword)}</td><td>${d.review.score ?? '-'}</td>
<td><span class="pill">${esc(d.status)}</span> ${d.published_url ? `<a href="${esc(d.published_url)}" target="_blank">view</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">Abhi koi draft nahi. Overview se "Write next post".</td></tr>'}
</table></div>`));
  });

  app.get('/drafts/:id', (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.sendStatus(404);
    const words = d.markdown.split(/\s+/).length;
    res.send(layout(d.title, `<h2>Draft #${d.id} · ${esc(d.status)}</h2>
<div class="card"><div class="mute">Keyword: ${esc(d.keyword)} · ${words} words · slug /${esc(d.slug)} · editor score ${d.review.score ?? '-'}/10</div>
${d.review.todo?.length ? `<p><b>Tumhe karna hai (publish se pehle):</b></p><ul>${d.review.todo.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
${(d.markdown.match(/\[SCREENSHOT:[^\]]*\]/g) ?? []).length ? `<p class="medium">${(d.markdown.match(/\[SCREENSHOT:[^\]]*\]/g)).length} screenshot markers. Asli screenshots lagao ya line hata do.</p>` : ''}
${d.error ? `<p class="high">Last error: ${esc(d.error)}</p>` : ''}
<form method="post" action="/drafts/${d.id}">
<p><input name="title" value="${esc(d.title)}" style="width:100%"></p>
<p><input name="description" value="${esc(d.description)}" style="width:100%"></p>
<textarea name="markdown">${esc(d.markdown)}</textarea>
<div class="row" style="margin-top:10px"><button name="action" value="save">Save</button>
<button name="action" value="publish" class="primary" onclick="return confirm('Publish karein?')">Save + Approve & publish</button>
<button name="action" value="reject">Reject</button></div></form></div>`));
  });

  app.post('/drafts/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { title, description, markdown, action } = req.body;
    db.updateDraft(id, { title: String(title).slice(0, 70), description: String(description).slice(0, 200), markdown: String(markdown) });
    if (action === 'reject') db.updateDraft(id, { status: 'rejected' });
    if (action === 'publish') {
      try { await jobs.approve(id); } catch { /* error saved on draft */ }
    }
    res.redirect(`/drafts/${id}`);
  });

  app.get('/ideas', (_req, res) => {
    res.send(layout('Ideas', `<h2>Ideas queue</h2><div class="card scroll"><table><tr><th>Title</th><th>Keyword</th><th>Why</th><th></th></tr>
${db.ideas('idea').map(i => `<tr><td>${esc(i.title)}</td><td class="mute">${esc(i.keyword)}</td><td class="mute">${esc(i.reason)}</td>
<td><form method="post" action="/ideas/${i.id}/skip"><button>Skip</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="mute">Khali. "New ideas" dabao.</td></tr>'}
</table></div>`));
  });
  app.post('/ideas/:id/skip', (req, res) => { db.setIdea(Number(req.params.id), 'skipped'); res.redirect('/ideas'); });

  app.get('/audit', (_req, res) => {
    const a = db.latestReport('audit');
    if (!a) return res.send(layout('Audit', `<h2>Audit</h2><div class="card">Abhi nahi chala. ${actions()}</div>`));
    const order = { high: 0, medium: 1, low: 2 };
    res.send(layout('Audit', `<h2>Audit · ${esc(a.savedAt)} UTC · ${a.pages} pages</h2>
<div class="card"><b class="high">${a.counts.high} high</b> · <span class="medium">${a.counts.medium} medium</span> · <span class="low">${a.counts.low} low</span> · ${a.broken.length} broken links · ${a.thin.length} thin pages</div>
${a.broken.length ? `<h2>Broken internal links</h2><div class="card scroll"><table><tr><th>Link</th><th>Found on</th><th>Status</th></tr>${a.broken.map(b => `<tr><td>${esc(b.link)}</td><td class="mute">${esc(b.from)}</td><td class="high">${b.status}</td></tr>`).join('')}</table></div>` : ''}
${a.duplicateTitles.length ? `<h2>Duplicate titles</h2><div class="card"><ul>${a.duplicateTitles.map(d => `<li>"${esc(d.value)}" — ${d.urls.length} pages</li>`).join('')}</ul></div>` : ''}
<h2>Issues</h2><div class="card scroll"><table><tr><th>Severity</th><th>Issue</th><th>Page</th></tr>
${[...a.issues].sort((x, y) => order[x.severity] - order[y.severity]).slice(0, 400).map(i => `<tr><td class="${i.severity}">${i.severity}</td><td>${esc(i.msg)}</td><td class="mute">${esc(i.url)}</td></tr>`).join('')}
</table></div>`));
  });

  app.get('/search', (_req, res) => {
    const g = db.latestReport('gsc');
    if (!g) return res.send(layout('Search Console', `<h2>Search Console</h2><div class="card">Connected nahi (README dekho: GSC_KEY_FILE, GSC_SITE). Ya Monday ke report ka intezar.</div>`));
    const row = r => `<tr><td>${esc(r.query)}</td><td>${r.position.toFixed(1)}</td><td>${r.impressions}</td><td>${r.clicks}</td><td>${(r.ctr * 100).toFixed(1)}%</td><td class="mute">${esc(r.page)}</td></tr>`;
    const head = '<tr><th>Query</th><th>Pos</th><th>Impr.</th><th>Clicks</th><th>CTR</th><th>Page</th></tr>';
    res.send(layout('Search Console', `<h2>Totals (28 din)</h2><div class="card">${g.totals.clicks} clicks · ${g.totals.impressions} impressions · ${g.queries} query/page rows</div>
<h2>Page 1 ke qareeb (rank 5–20): in pe post/improvement</h2><div class="card scroll"><table>${head}${g.striking.map(row).join('')}</table></div>
<h2>Achi rank, kam clicks: title/description badlo</h2><div class="card scroll"><table>${head}${g.lowCtr.map(row).join('')}</table></div>`));
  });

  app.post('/run/audit', (_req, res) => { run('Audit', jobs.audit); res.redirect('/'); });
  app.post('/run/plan', (_req, res) => { run('Ideas', () => jobs.plan()); res.redirect('/ideas'); });
  app.post('/run/write', (_req, res) => { run('Writing', jobs.writeNext); res.redirect('/drafts'); });

  return app;
}

export const _running = () => running;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  db.getDb();
  createApp().listen(config.port, () => console.log(`SEO dashboard on :${config.port}`));
  setInterval(() => jobs.tick(), 10 * 60_000);
  jobs.tick();
}
