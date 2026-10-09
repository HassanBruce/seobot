import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = (k, d) => process.env[k] ?? d;

export const config = {
  siteUrl: env('SITE_URL', 'https://toolswhisper.io').replace(/\/$/, ''),
  sitemapUrl: env('SITEMAP_URL', ''),           // default: SITE_URL/sitemap.xml
  siteName: env('SITE_NAME', 'ToolsWhisper'),
  audience: env('AUDIENCE', 'developers, marketers and students who need quick free online tools'),
  toolUrlPattern: env('TOOL_URL_PATTERN', '/tools/'),   // which sitemap URLs are tools
  blogUrlPattern: env('BLOG_URL_PATTERN', '/blog/'),
  blogBaseUrl: env('BLOG_BASE_URL', ''),               // default: SITE_URL/blog
  maxPages: Number(env('AUDIT_MAX_PAGES', 300)),
  userAgent: env('USER_AGENT', 'seobot/1.0 (+site owner audit)'),

  aiBaseUrl: env('AI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
  aiApiKey: env('AI_API_KEY', ''),
  aiModel: env('AI_MODEL', 'gemini-2.5-flash'),

  // Google Search Console (free) via a service account JSON file
  gscKeyFile: env('GSC_KEY_FILE', ''),
  gscSite: env('GSC_SITE', ''),                 // e.g. sc-domain:toolswhisper.io

  // Publishing: folder (markdown/MDX files, optional git push) | webhook (POST to your Laravel/Next API) | none
  publishMode: env('PUBLISH_MODE', 'none'),
  contentDir: env('CONTENT_DIR', './data/posts'),
  fileExt: env('FILE_EXT', 'mdx'),
  gitPush: env('GIT_PUSH', 'false') === 'true',
  webhookUrl: env('WEBHOOK_URL', ''),
  webhookToken: env('WEBHOOK_TOKEN', ''),

  postsPerWeek: Number(env('POSTS_PER_WEEK', 3)),
  autoPublish: env('AUTO_PUBLISH', 'false') === 'true',

  telegramToken: env('TELEGRAM_BOT_TOKEN', ''),
  telegramChatId: env('TELEGRAM_CHAT_ID', ''),

  port: Number(env('PORT', 3400)),
  dataDir: env('DATA_DIR', './data'),
  adminPassword: env('ADMIN_PASSWORD', ''),
};

export const sitemapUrl = () => config.sitemapUrl || `${config.siteUrl}/sitemap.xml`;
export const blogBase = () => (config.blogBaseUrl || `${config.siteUrl}/blog`).replace(/\/$/, '');
