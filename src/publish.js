import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from './config.js';
import { frontmatter, postUrl } from './content.js';

/**
 * folder:  writes <CONTENT_DIR>/<slug>.<ext> with frontmatter (Next.js MDX blogs, Hugo, Astro…),
 *          optionally git add/commit/push so your deploy picks it up.
 * webhook: POSTs JSON to your own endpoint (e.g. a Laravel route that creates the post).
 */
export async function publish(d) {
  if (config.publishMode === 'folder') {
    fs.mkdirSync(config.contentDir, { recursive: true });
    const file = path.join(config.contentDir, `${d.slug}.${config.fileExt}`);
    fs.writeFileSync(file, frontmatter(d) + d.markdown.trim() + '\n', 'utf8');
    if (config.gitPush) {
      const git = (...a) => execFileSync('git', ['-C', config.contentDir, ...a], { stdio: 'pipe' });
      git('add', file);
      git('commit', '-m', `blog: ${d.title}`);
      git('push');
    }
    return { url: postUrl(d.slug), file };
  }
  if (config.publishMode === 'webhook') {
    if (!config.webhookUrl) throw new Error('WEBHOOK_URL missing');
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.webhookToken}` },
      body: JSON.stringify({ title: d.title, slug: d.slug, description: d.description, tags: d.tags, content_markdown: d.markdown, status: 'published' }),
    });
    if (!res.ok) throw new Error(`Webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json().catch(() => ({}));
    return { url: body.url ?? postUrl(d.slug) };
  }
  throw new Error('PUBLISH_MODE is "none". Set folder or webhook in .env (or copy the markdown manually).');
}
