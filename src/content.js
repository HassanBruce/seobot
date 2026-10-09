import { config, blogBase } from './config.js';
import { chatJson } from './ai.js';

export const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 70);

export function siteInventory(audit) {
  const pages = audit?.pageList ?? [];
  return {
    tools: pages.filter(p => p.url.includes(config.toolUrlPattern)).map(p => ({ url: p.url, title: p.title })),
    posts: pages.filter(p => p.url.includes(config.blogUrlPattern)).map(p => ({ url: p.url, title: p.title })),
  };
}

/** Topic plan: grounded in the site's own tools + Search Console queries. */
export async function planTopics({ audit, gsc, existingTitles = [], count = 6 }) {
  const inv = siteInventory(audit);
  const queries = [...(gsc?.striking ?? [])].slice(0, 25).map(r => ({ q: r.query, pos: Math.round(r.position), imp: r.impressions, page: r.page }));
  const prompt = `You are the SEO lead for ${config.siteName} (${config.siteUrl}), a free online tools site for ${config.audience}.
Tools on the site: ${JSON.stringify(inv.tools.slice(0, 80))}
Existing blog posts and drafts: ${JSON.stringify([...inv.posts.map(p => p.title), ...existingTitles].slice(0, 150))}
Search Console queries where we rank 5-20 (real demand): ${JSON.stringify(queries)}

Propose ${count} NEW blog posts that will bring search traffic AND help visitors use our tools. Rules:
- Each post must be tied to ONE of our tools (tool_url from the list) and solve a real task (how-to, troubleshooting, comparison, explainer).
- Prefer topics backed by the Search Console queries; otherwise long-tail, low-competition, specific queries.
- No duplicates of existing posts. No generic listicles ("10 best...") unless they genuinely compare our tool fairly.
Return ONLY JSON: {"ideas":[{"title":"","keyword":"main search query","intent":"how-to|troubleshoot|explainer|comparison","tool_url":"","reason":"why this will rank / which query","outline":["H2 ..."]}]}`;
  const out = await chatJson(prompt, { temperature: 0.7 });
  const tools = new Set(inv.tools.map(t => t.url));
  return (out.ideas ?? []).filter(i => i.title && i.keyword).map(i => ({ ...i, tool_url: tools.has(i.tool_url) ? i.tool_url : (inv.tools[0]?.url ?? config.siteUrl) }));
}

/** Writer pass: a useful, specific article in Markdown. */
export async function writeArticle(idea, related = []) {
  const prompt = `Write a blog post for ${config.siteName} (${config.siteUrl}), audience: ${config.audience}.
Title: "${idea.title}". Main keyword: "${idea.keyword}". Search intent: ${idea.intent ?? 'how-to'}.
Our tool to feature: ${idea.tool_url}. Outline ideas: ${JSON.stringify(idea.outline ?? [])}
Related pages on our site you may link to: ${JSON.stringify(related.slice(0, 8))}

Quality rules (this is what makes it rank and pass AdSense review):
- Answer the main question in the first 2-3 sentences. No fluffy intro, no "In today's digital world".
- Practical and specific: real example inputs and outputs (in code blocks), exact steps, common mistakes and how to fix them.
- Show how to do it with our tool (link to it with descriptive anchor text) AND briefly how to do it without it, so it is genuinely helpful.
- Never invent statistics, studies, quotes, prices or features you are not sure about. If something depends on the reader's setup, say so.
- Where a screenshot of our tool would help, put a line: [SCREENSHOT: what to capture].
- 900-1500 words, H2/H3 structure, short paragraphs, a short FAQ (3-4 real questions) at the end.
- Natural keyword use; no keyword stuffing.
Return ONLY JSON: {"title":"(<=60 chars)","description":"meta description 140-160 chars","slug":"url-slug","tags":["..."],"markdown":"full article in Markdown WITHOUT the H1 title"}`;
  const a = await chatJson(prompt, { temperature: 0.6 });
  if (!a.markdown || a.markdown.length < 1500) throw new Error('Writer returned too little content');
  return { ...a, slug: slugify(a.slug || a.title), title: (a.title || idea.title).slice(0, 70) };
}

/** Editor pass: checks claims and quality like a human editor; fixes what it can, lists what needs YOU. */
export async function editArticle(article, idea) {
  const prompt = `You are a strict human-style editor. Review this blog post for ${config.siteName}.
Main keyword: "${idea.keyword}". Featured tool: ${idea.tool_url}.

Check and FIX directly in the text:
- factual claims that are unverifiable or likely wrong (remove or soften them), invented numbers/quotes
- technically wrong code or steps
- repetitive phrases, filler, AI clichés ("delve", "in today's fast-paced world", "unlock", "game-changer", "seamless")
- missing link to the featured tool, weak first paragraph
Keep the author's structure. Keep [SCREENSHOT: ...] markers.

Then score 1-10 for usefulness and list what a human must still do (e.g. add screenshots, test a command, add personal experience).

Post JSON: ${JSON.stringify({ title: article.title, description: article.description, markdown: article.markdown })}
Return ONLY JSON: {"title":"","description":"","markdown":"","score":0,"issues_fixed":["..."],"todo_for_human":["..."]}`;
  const e = await chatJson(prompt, { temperature: 0.3 });
  const ok = e.markdown && e.markdown.length > article.markdown.length * 0.6;
  return {
    title: (e.title || article.title).slice(0, 70),
    description: e.description || article.description,
    markdown: ok ? e.markdown : article.markdown,
    review: { score: Number(e.score) || null, fixed: e.issues_fixed ?? [], todo: e.todo_for_human ?? [], editorApplied: !!ok },
  };
}

export function frontmatter(d) {
  const esc = s => String(s ?? '').replace(/"/g, '\\"');
  return `---
title: "${esc(d.title)}"
description: "${esc(d.description)}"
slug: "${d.slug}"
date: "${new Date().toISOString().slice(0, 10)}"
tags: [${(d.tags ?? []).map(t => `"${esc(t)}"`).join(', ')}]
---

`;
}

export const postUrl = slug => `${blogBase()}/${slug}`;
