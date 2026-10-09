import { config } from './config.js';
import * as db from './db.js';
import { runAudit } from './audit.js';
import { gscEnabled, query, opportunities } from './gsc.js';
import { planTopics, writeArticle, editArticle, siteInventory } from './content.js';
import { publish } from './publish.js';

export async function notify(text) {
  if (!config.telegramToken || !config.telegramChatId) return;
  await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegramChatId, text, disable_web_page_preview: true }),
  }).catch(() => {});
}

export async function audit() {
  const a = await runAudit();
  db.saveReport('audit', a);
  return a;
}

export async function searchConsole() {
  if (!gscEnabled()) return null;
  const o = opportunities(await query());
  db.saveReport('gsc', o);
  return o;
}

export async function plan(count = 6) {
  const a = db.latestReport('audit') ?? await audit();
  const g = db.latestReport('gsc') ?? await searchConsole().catch(() => null);
  const ideas = await planTopics({ audit: a, gsc: g, existingTitles: [...db.draftTitles(), ...db.ideas('idea').map(i => i.title)], count });
  let added = 0;
  for (const i of ideas) if (db.addIdea(i)) added++;
  return added;
}

/** Writes the next idea into a reviewed draft. */
export async function writeNext() {
  let [idea] = db.ideas('idea', 1);
  if (!idea) { await plan(); [idea] = db.ideas('idea', 1); }
  if (!idea) throw new Error('No ideas available');
  const inv = siteInventory(db.latestReport('audit'));
  const related = [...inv.posts, ...inv.tools].filter(p => p.url !== idea.tool_url).slice(0, 12);
  const draft = await writeArticle(idea, related);
  const edited = await editArticle(draft, idea);
  const id = db.addDraft({ idea_id: idea.id, slug: draft.slug, tags: draft.tags, keyword: idea.keyword, ...edited });
  db.setIdea(idea.id, 'drafted');
  const d = db.getDraft(id);
  if (config.autoPublish) await approve(id);
  else await notify(`📝 Naya draft #${id}: ${d.title}\nScore ${d.review.score ?? '-'} /10\nTumhe karna hai: ${(d.review.todo ?? []).slice(0, 3).join('; ') || '-'}\nDashboard pe dekh ke Approve karo.`);
  return id;
}

export async function approve(id) {
  const d = db.getDraft(id);
  if (!d) throw new Error(`No draft ${id}`);
  try {
    const r = await publish(d);
    db.updateDraft(id, { status: 'published', published_url: r.url, error: null });
    await notify(`✅ Published: ${d.title}\n${r.url}`);
    return r;
  } catch (e) {
    db.updateDraft(id, { status: 'approved', error: e.message });
    throw e;
  }
}

export async function weeklyReport() {
  const a = db.latestReport('audit');
  const g = db.latestReport('gsc');
  const lines = [`📈 SEO weekly — ${config.siteName}`];
  if (g) lines.push(`Search: ${g.totals.clicks} clicks, ${g.totals.impressions} impressions (28 din)`, `Page 1 ke qareeb queries: ${g.striking.length}`);
  if (a) lines.push(`Audit: ${a.pages} pages · ${a.counts.high} high / ${a.counts.medium} medium issues · ${a.broken.length} broken links`);
  lines.push(`Drafts review ke liye: ${db.drafts('draft').length}`);
  await notify(lines.join('\n'));
  return lines.join('\n');
}

/**
 * Weekly rhythm (Pakistan time):
 *  Monday 09:00  audit + Search Console + new ideas + weekly report
 *  Draft days    one draft per day, POSTS_PER_WEEK times a week (Mon/Wed/Fri for 3)
 */
const PKT = 5 * 3600_000;
const DRAFT_DAYS = { 1: [3], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5] };

export function dueJobs(now = Date.now()) {
  const t = new Date(now + PKT);
  const day = t.getUTCDay(), hour = t.getUTCHours(), date = t.toISOString().slice(0, 10);
  const jobs = [];
  if (day === 1 && hour >= 9 && db.kvGet('weekly_done') !== date) jobs.push('weekly');
  const days = DRAFT_DAYS[Math.min(5, Math.max(1, config.postsPerWeek))];
  if (days.includes(day) && hour >= 11 && db.kvGet('draft_done') !== date) jobs.push('draft');
  return { jobs, date };
}

export async function tick(now = Date.now()) {
  const { jobs, date } = dueJobs(now);
  for (const j of jobs) {
    try {
      if (j === 'weekly') {
        db.kvSet('weekly_done', date);
        await audit();
        await searchConsole().catch(e => notify(`⚠️ Search Console: ${e.message}`));
        await plan();
        await weeklyReport();
      }
      if (j === 'draft') {
        db.kvSet('draft_done', date);
        await writeNext();
      }
    } catch (e) {
      console.error(`[${j}]`, e);
      await notify(`⚠️ SEO bot (${j}) error: ${e.message.slice(0, 300)}`);
    }
  }
  return jobs;
}
