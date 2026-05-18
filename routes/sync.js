const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const SLUG_RE = /^[a-zA-Z0-9_\-]{1,200}$/;

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

const router = express.Router();

// ─── GET bookmarks ────────────────────────────────────────────────────────────
router.get('/bookmarks', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY added_at DESC').all(req.user.id);
  const bookmarks = {};
  rows.forEach(r => {
    bookmarks[r.slug] = {
      slug: r.slug, title: r.title, cover: r.cover,
      link: r.link, badge: r.badge, rating: r.rating, addedAt: r.added_at,
    };
  });
  res.json({ bookmarks });
});

// ─── POST bookmarks ───────────────────────────────────────────────────────────
router.post('/bookmarks', requireAuth, (req, res) => {
  const { bookmarks } = req.body || {};
  if (!bookmarks || typeof bookmarks !== 'object')
    return res.status(400).json({ error: 'Invalid bookmarks data' });

  const upsert = db.prepare(`
    INSERT INTO bookmarks (user_id, slug, title, cover, link, badge, rating, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, slug) DO UPDATE SET
      title=excluded.title, cover=excluded.cover, link=excluded.link,
      badge=excluded.badge, rating=excluded.rating, added_at=excluded.added_at
  `);
  const deleteOne = db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND slug = ?');

  const serverSlugs = new Set(
    db.prepare('SELECT slug FROM bookmarks WHERE user_id = ?').all(req.user.id).map(r => r.slug)
  );
  const clientSlugs = new Set(Object.keys(bookmarks));

  const syncAll = db.transaction(() => {
    for (const [slug, b] of Object.entries(bookmarks)) {
      if (!isValidSlug(slug)) {
        console.warn('Sync: skipping invalid slug:', slug.slice(0, 50));
        continue;
      }
      upsert.run(req.user.id, slug, b.title || '', b.cover || '', b.link || '', b.badge || '', b.rating || '', b.addedAt || Date.now());
    }
    for (const slug of serverSlugs) {
      if (!clientSlugs.has(slug)) deleteOne.run(req.user.id, slug);
    }
  });

  syncAll();
  res.json({ ok: true });
});

// ─── GET history ──────────────────────────────────────────────────────────────
router.get('/history', requireAuth, (req, res) => {
  const histRows = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY last_read DESC').all(req.user.id);
  const readHistory = {};
  histRows.forEach(r => {
    readHistory[r.slug] = { slug: r.slug, title: r.title, cover: r.cover, link: r.link, lastRead: r.last_read };
  });

  const chapRows = db.prepare('SELECT slug, chapter_url FROM read_chapters WHERE user_id = ?').all(req.user.id);
  const lastRows = db.prepare('SELECT slug, chapter_url, chapter_title FROM last_read_chapter WHERE user_id = ?').all(req.user.id);

  const readChapters = {};
  chapRows.forEach(r => {
    const key = `${r.slug}_all`;
    if (!readChapters[key]) readChapters[key] = [];
    readChapters[key].push(r.chapter_url);
  });
  lastRows.forEach(r => {
    readChapters[r.slug] = { link: r.chapter_url, title: r.chapter_title };
  });

  res.json({ readHistory, readChapters });
});

// ─── POST history ─────────────────────────────────────────────────────────────
router.post('/history', requireAuth, (req, res) => {
  const { readHistory, readChapters } = req.body || {};

  const upsertHist = db.prepare(`
    INSERT INTO history (user_id, slug, title, cover, link, last_read)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, slug) DO UPDATE SET
      title=excluded.title, cover=excluded.cover, link=excluded.link, last_read=excluded.last_read
  `);
  const upsertChap = db.prepare(`
    INSERT OR IGNORE INTO read_chapters (user_id, slug, chapter_url) VALUES (?, ?, ?)
  `);
  const upsertLast = db.prepare(`
    INSERT INTO last_read_chapter (user_id, slug, chapter_url, chapter_title)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, slug) DO UPDATE SET chapter_url=excluded.chapter_url, chapter_title=excluded.chapter_title
  `);

  const syncAll = db.transaction(() => {
    if (readHistory && typeof readHistory === 'object') {
      for (const [slug, h] of Object.entries(readHistory)) {
        if (!isValidSlug(slug)) {
          console.warn('Sync: skipping invalid slug:', slug.slice(0, 50));
          continue;
        }
        upsertHist.run(req.user.id, slug, h.title || '', h.cover || '', h.link || '', h.lastRead || Date.now());
      }
    }
    if (readChapters && typeof readChapters === 'object') {
      for (const [key, val] of Object.entries(readChapters)) {
        if (key.endsWith('_all') && Array.isArray(val)) {
          const slug = key.replace(/_all$/, '');
          if (!isValidSlug(slug)) {
            console.warn('Sync: skipping invalid slug:', slug.slice(0, 50));
            continue;
          }
          for (const url of val) upsertChap.run(req.user.id, slug, url);
        } else if (!key.endsWith('_all') && val && val.link) {
          if (!isValidSlug(key)) {
            console.warn('Sync: skipping invalid slug:', key.slice(0, 50));
            continue;
          }
          upsertLast.run(req.user.id, key, val.link, val.title || '');
        }
      }
    }
  });

  syncAll();
  res.json({ ok: true });
});

module.exports = router;
