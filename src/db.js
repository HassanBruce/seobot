import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db;
export function getDb() {
  if (db) return db;
  const file = config.dataDir === ':memory:' ? ':memory:'
    : (fs.mkdirSync(config.dataDir, { recursive: true }), path.join(config.dataDir, 'seo.sqlite'));
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, keyword TEXT, intent TEXT, tool_url TEXT,
      reason TEXT, outline TEXT, status TEXT NOT NULL DEFAULT 'idea',   -- idea | drafted | skipped
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, idea_id INTEGER, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      description TEXT, keyword TEXT, tags TEXT, markdown TEXT NOT NULL,
      review TEXT,                     -- editor JSON: score, issues, todo
      status TEXT NOT NULL DEFAULT 'draft',  -- draft | approved | published | rejected
      published_url TEXT, error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  `);
  return db;
}

export const kvGet = (k, d = null) => getDb().prepare('SELECT v FROM kv WHERE k=?').get(k)?.v ?? d;
export const kvSet = (k, v) => getDb().prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

export function saveReport(kind, data) {
  getDb().prepare('INSERT INTO reports (kind, data) VALUES (?,?)').run(kind, JSON.stringify(data));
}
export function latestReport(kind) {
  const r = getDb().prepare('SELECT data, created_at FROM reports WHERE kind=? ORDER BY id DESC LIMIT 1').get(kind);
  return r ? { ...JSON.parse(r.data), savedAt: r.created_at } : null;
}

export function addIdea(i) {
  const exists = getDb().prepare('SELECT 1 FROM ideas WHERE lower(title)=lower(?) OR (keyword IS NOT NULL AND lower(keyword)=lower(?))').get(i.title, i.keyword ?? '');
  if (exists) return false;
  getDb().prepare('INSERT INTO ideas (title, keyword, intent, tool_url, reason, outline) VALUES (?,?,?,?,?,?)')
    .run(i.title, i.keyword ?? null, i.intent ?? null, i.tool_url ?? null, i.reason ?? null, JSON.stringify(i.outline ?? []));
  return true;
}
export const ideas = (status = 'idea', limit = 50) => getDb().prepare('SELECT * FROM ideas WHERE status=? ORDER BY id LIMIT ?').all(status, limit)
  .map(i => ({ ...i, outline: JSON.parse(i.outline ?? '[]') }));
export const setIdea = (id, status) => getDb().prepare('UPDATE ideas SET status=? WHERE id=?').run(status, id);

export function addDraft(d) {
  let slug = d.slug, n = 2;
  while (getDb().prepare('SELECT 1 FROM drafts WHERE slug=?').get(slug)) slug = `${d.slug}-${n++}`;
  const r = getDb().prepare(`INSERT INTO drafts (idea_id, title, slug, description, keyword, tags, markdown, review)
    VALUES (?,?,?,?,?,?,?,?)`).run(d.idea_id ?? null, d.title, slug, d.description, d.keyword ?? null,
    JSON.stringify(d.tags ?? []), d.markdown, JSON.stringify(d.review ?? {}));
  return Number(r.lastInsertRowid);
}
export function getDraft(id) {
  const d = getDb().prepare('SELECT * FROM drafts WHERE id=?').get(id);
  return d ? { ...d, tags: JSON.parse(d.tags ?? '[]'), review: JSON.parse(d.review ?? '{}') } : null;
}
export function updateDraft(id, f) {
  const keys = Object.keys(f);
  getDb().prepare(`UPDATE drafts SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`)
    .run(...keys.map(k => (typeof f[k] === 'object' && f[k] !== null ? JSON.stringify(f[k]) : f[k])), id);
}
export const drafts = (status, limit = 100) => (status
  ? getDb().prepare('SELECT * FROM drafts WHERE status=? ORDER BY id DESC LIMIT ?').all(status, limit)
  : getDb().prepare('SELECT * FROM drafts ORDER BY id DESC LIMIT ?').all(limit))
  .map(d => ({ ...d, review: JSON.parse(d.review ?? '{}') }));
export const draftTitles = () => getDb().prepare("SELECT title FROM drafts WHERE status != 'rejected'").all().map(r => r.title);
