import { config, sitemapUrl } from './config.js';

async function get(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': config.userAgent } });
    const body = /html|xml|text/.test(res.headers.get('content-type') ?? '') ? await res.text() : '';
    return { status: res.status, location: res.headers.get('location'), body, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message, body: '', ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

/** Reads sitemap.xml (and nested sitemap indexes). */
export async function sitemapUrls(url = sitemapUrl(), depth = 0) {
  const r = await get(url);
  if (r.status !== 200) throw new Error(`Sitemap ${url} → HTTP ${r.status || r.error}`);
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
  if (/<sitemapindex/i.test(r.body) && depth < 2) {
    const out = [];
    for (const s of locs) out.push(...await sitemapUrls(s, depth + 1));
    return [...new Set(out)];
  }
  return [...new Set(locs)];
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];

export function analyzeHtml(html, url) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = n => { const t = metaTags.find(m => new RegExp(`(name|property)\\s*=\\s*["']${n}["']`, 'i').test(m)); return t ? decode(attr(t, 'content') ?? '') : ''; };
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  const canonical = attr(linkTags.find(l => /rel\s*=\s*["']canonical["']/i.test(l)) ?? '', 'href') ?? '';
  const h1s = (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? []).map(h => decode(h.replace(/<[^>]+>/g, '')));
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgs.filter(i => !/\balt\s*=\s*["'][^"']+["']/i.test(i)).length;
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const words = (text.match(/[A-Za-z؀-ۿ0-9']{2,}/g) ?? []).length;
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)].map(m => m[1]);
  const internal = [];
  for (const href of links) {
    try {
      const u = new URL(href, url);
      if (u.host === new URL(config.siteUrl).host && /^https?:$/.test(u.protocol)) internal.push(u.href.split('#')[0]);
    } catch { /* ignore */ }
  }
  return {
    title, description: meta('description'), ogImage: meta('og:image'), robots: meta('robots'),
    canonical, h1s, images: imgs.length, noAlt, words,
    hasSchema: /application\/ld\+json/i.test(html), internalLinks: [...new Set(internal)],
  };
}

export function issuesFor(p) {
  const out = [];
  const add = (severity, msg) => out.push({ severity, msg });
  if (p.status !== 200) { add('high', `HTTP ${p.status || p.error}`); return out; }
  if (/noindex/i.test(p.robots)) add('high', 'noindex laga hua hai (Google index nahi karega)');
  if (!p.title) add('high', 'Title missing');
  else if (p.title.length < 25) add('medium', `Title chhota (${p.title.length} chars)`);
  else if (p.title.length > 65) add('low', `Title lamba (${p.title.length} chars), Google kaat dega`);
  if (!p.description) add('high', 'Meta description missing');
  else if (p.description.length < 70 || p.description.length > 165) add('low', `Meta description ${p.description.length} chars (70–160 behtar)`);
  if (p.h1s.length === 0) add('medium', 'H1 missing');
  if (p.h1s.length > 1) add('low', `${p.h1s.length} H1 tags`);
  if (!p.canonical) add('low', 'Canonical tag missing');
  if (p.words < 300) add('medium', `Thin content (${p.words} words). AdSense "low value content" ka risk`);
  if (p.noAlt) add('low', `${p.noAlt} images bina alt text`);
  if (!p.hasSchema) add('low', 'Structured data (schema) nahi');
  if (p.ms > 2500) add('medium', `Slow response (${(p.ms / 1000).toFixed(1)}s)`);
  return out;
}

/** Crawls every sitemap URL, analyses it, and checks internal links for 404s. */
export async function runAudit({ concurrency = 4 } = {}) {
  const urls = (await sitemapUrls()).slice(0, config.maxPages);
  const pages = [];
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      const r = await get(url);
      const a = r.status === 200 ? analyzeHtml(r.body, url) : { h1s: [], internalLinks: [] };
      const page = { url, status: r.status, error: r.error, ms: r.ms, location: r.location, ...a };
      page.issues = issuesFor(page);
      pages.push(page);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // broken internal links (only those not already crawled)
  const known = new Map(pages.map(p => [p.url, p.status]));
  const linked = new Map();
  for (const p of pages) for (const l of p.internalLinks ?? []) if (!linked.has(l)) linked.set(l, p.url);
  const broken = [];
  for (const [link, from] of [...linked].slice(0, 500)) {
    const st = known.get(link) ?? (await get(link, 10000)).status;
    known.set(link, st);
    if (st >= 400 || st === 0) broken.push({ link, from, status: st });
  }

  // duplicates
  const dupe = key => {
    const m = new Map();
    for (const p of pages) if (p[key]) m.set(p[key], [...(m.get(p[key]) ?? []), p.url]);
    return [...m].filter(([, v]) => v.length > 1).map(([value, urls]) => ({ value, urls }));
  };

  const all = pages.flatMap(p => p.issues.map(x => ({ ...x, url: p.url })));
  return {
    at: new Date().toISOString(),
    pages: pages.length,
    issues: all,
    counts: { high: all.filter(x => x.severity === 'high').length, medium: all.filter(x => x.severity === 'medium').length, low: all.filter(x => x.severity === 'low').length },
    broken,
    duplicateTitles: dupe('title'),
    duplicateDescriptions: dupe('description'),
    thin: pages.filter(p => p.status === 200 && p.words < 300).map(p => ({ url: p.url, words: p.words })),
    pageList: pages.map(p => ({ url: p.url, title: p.title, description: p.description, words: p.words, status: p.status })),
  };
}
