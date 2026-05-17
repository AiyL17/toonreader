const express    = require('express');
const cheerio    = require('cheerio');
const NodeCache  = require('node-cache');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const axios      = require('axios');
const http       = require('http');
const https      = require('https');
const compression = require('compression');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db         = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'toonreader-secret-change-in-production';
const JWT_EXPIRY = '30d';

// Warn loudly when running with the default insecure secret
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: JWT_SECRET env var is not set. Using insecure default. Set JWT_SECRET before deploying.');
}

const app = express();

// ─── Compression ──────────────────────────────────────────────────────────────
// Lower threshold to 512 B so even small JSON API responses get compressed.
app.use(compression({ threshold: 512 }));

// ─── Caches ───────────────────────────────────────────────────────────────────
// maxKeys prevents unbounded memory growth on long-running instances.
// When the limit is reached, node-cache evicts the oldest entry automatically.
const cache            = new NodeCache({ stdTTL: 900,   checkperiod: 120,  maxKeys: 500  }); // latest/chapters: 15 min, max 500 entries
const browseCache      = new NodeCache({ stdTTL: 1800,  checkperiod: 180,  maxKeys: 1000 }); // browse/search/manga: 30 min, max 1000 entries
const coverCache       = new NodeCache({ stdTTL: 86400, checkperiod: 3600, maxKeys: 2000 }); // covers: 24 h, max 2000 entries
// Image buffers are large (~100–500 KB each); cap at 200 entries (~100 MB worst-case).
const imgCache         = new NodeCache({ stdTTL: 3600,  checkperiod: 600,  maxKeys: 200  }); // images: 1 h, max 200 entries
// Parsed manga detail objects (title, chapters, genres…) — avoids re-parsing HTML on every hit.
const mangaDetailCache = new NodeCache({ stdTTL: 1800,  checkperiod: 180,  maxKeys: 500  }); // manga detail: 30 min, max 500 entries
// Parsed browse page results — avoids re-running Cheerio on cached HTML.
const browseResultCache = new NodeCache({ stdTTL: 1800, checkperiod: 180,  maxKeys: 2000 }); // browse results: 30 min, max 2000 entries

const BASE_URL = 'https://mangadistrict.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': BASE_URL + '/',
};

// ─── Axios instance with keep-alive ──────────────────────────────────────────
const axiosInstance = axios.create({
  headers: HEADERS,
  timeout: 20000,
  httpAgent:  new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
});

// ─── In-flight deduplication ─────────────────────────────────────────────────
const inFlight = new Map();

// ─── Generic cached axios fetch ──────────────────────────────────────────────
async function fetchHTML(url, cacheStore = browseCache) {
  const cacheKey = 'html:' + url;
  const cached = cacheStore.get(cacheKey);
  if (cached) return cached;

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = (async () => {
    const response = await axiosInstance.get(url);
    cacheStore.set(cacheKey, response.data);
    return response.data;
  })();

  inFlight.set(cacheKey, promise);
  promise.finally(() => inFlight.delete(cacheKey));
  return promise;
}

// ─── Fetch latest cards ───────────────────────────────────────────────────────
async function fetchLatestCards(serverPage) {
  const cacheKey = 'latest-cards:' + serverPage;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = (async () => {
    const url = `${BASE_URL}/series/?page=${serverPage}&m_orderby=latest`;
    const response = await axiosInstance.get(url);
    const $ = cheerio.load(response.data);
    const cards = [];

    $('.page-item-detail').each((_, el) => {
      const card = parseCard($, el);
      if (card) {
        card.latestChapter = card.chapters[0]?.title || '';
        cards.push(card);
      }
    });

    // Resolve missing covers in parallel, capped at 5 concurrent requests
    const missing = cards.filter(c => !c.cover);
    if (missing.length > 0) {
      await pLimit(missing, 5, async (card) => {
        const cover = await resolveCover(card.slug).catch(() => '');
        if (cover) card.cover = cover;
      });
    }

    cache.set(cacheKey, cards);
    return cards;
  })();

  inFlight.set(cacheKey, promise);
  promise.finally(() => inFlight.delete(cacheKey));
  return promise;
}

// ─── Simple concurrency limiter ───────────────────────────────────────────────
async function pLimit(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]).catch(() => null);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Resolve missing cover via axios ─────────────────────────────────────────
async function resolveCover(slug) {
  const cacheKey = 'cover:' + slug;
  const cached = coverCache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `${BASE_URL}/series/${slug}/`;
    const response = await axiosInstance.get(url);
    const $ = cheerio.load(response.data);
    const $img = $('.summary_image img');
    const rawCover = (
      $img.attr('data-default-src') ||
      $img.attr('data-src') ||
      $img.attr('data-lazy-src') ||
      $img.attr('src') ||
      ''
    ).trim();
    const cover = rawCover.startsWith('data:') ? '' : rawCover;
    if (cover) coverCache.set(cacheKey, cover);
    return cover;
  } catch (err) {
    console.error(`Cover resolve failed for ${slug}:`, err.message);
    return '';
  }
}

// ─── Parse manga card from Cheerio ───────────────────────────────────────────
function parseCard($, el) {
  const $el = $(el);
  const $titleLink = $el.find('.post-title h3 a, .post-title h4 a');
  const title = $titleLink.text().trim();
  const link  = $titleLink.attr('href') || '';

  const $img = $el.find('img').first();
  const rawCover = (
    $img.attr('data-src') ||
    $img.attr('data-lazy-src') ||
    $img.attr('data-original') ||
    $img.attr('data-cfsrc') ||
    $img.attr('data-default-src') ||
    $img.attr('src') ||
    ''
  ).trim();
  const cover = rawCover.startsWith('data:') ? '' : rawCover;

  const rating   = $el.find('.score').text().trim();
  const badgeRaw = $el.find('.manga-title-badges').text().trim();
  const badges   = [];
  if (badgeRaw.includes('18+')) badges.push('18+');
  if (/hot/i.test(badgeRaw))    badges.push('Hot');
  if (/new/i.test(badgeRaw))    badges.push('New');
  if (/end/i.test(badgeRaw))    badges.push('End');
  const badge = badges.join(' ');

  const chapters = [];
  $el.find('.chapter a').each((_, ch) => {
    chapters.push({ title: $(ch).text().trim(), link: $(ch).attr('href') || '' });
  });

  const slug = link.replace(BASE_URL + '/series/', '').replace(/\/$/, '');
  if (!title || !link) return null;
  return { title, link, cover, rating, badge, chapters, slug };
}

// ─── Prefetch helper ──────────────────────────────────────────────────────────
function prefetch(serverPage) {
  const key = 'latest-cards:' + serverPage;
  if (!cache.get(key) && !inFlight.has(key)) {
    fetchLatestCards(serverPage).catch(() => {});
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
// Global rate limiter — 30 req/s per IP across all routes
const limiter = rateLimit({ windowMs: 1000, max: 30 });
// Stricter limiter for auth endpoints — 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
}));
app.use(express.json({ limit: '2mb' }));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ─── API: Register ────────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });
  if (username.length < 3 || username.length > 30)
    return res.status(400).json({ error: 'Username must be 3–30 characters' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const result = stmt.run(username, hashed);
    const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, user: { id: result.lastInsertRowid, username } });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── API: Login ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── API: Logout ──────────────────────────────────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ─── API: Me (check session) ──────────────────────────────────────────────────
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ user: null });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json({ user: { id: user.id, username: user.username } });
  } catch {
    res.json({ user: null });
  }
});

// ─── API: Sync — Bookmarks ────────────────────────────────────────────────────
app.get('/api/sync/bookmarks', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY added_at DESC').all(req.user.id);
  const bookmarks = {};
  rows.forEach(r => {
    bookmarks[r.slug] = { slug: r.slug, title: r.title, cover: r.cover, link: r.link, badge: r.badge, rating: r.rating, addedAt: r.added_at };
  });
  res.json({ bookmarks });
});

app.post('/api/sync/bookmarks', requireAuth, (req, res) => {
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

  // Get current server slugs
  const serverSlugs = new Set(
    db.prepare('SELECT slug FROM bookmarks WHERE user_id = ?').all(req.user.id).map(r => r.slug)
  );
  const clientSlugs = new Set(Object.keys(bookmarks));

  const syncAll = db.transaction(() => {
    // Upsert all client bookmarks
    for (const [slug, b] of Object.entries(bookmarks)) {
      upsert.run(req.user.id, slug, b.title || '', b.cover || '', b.link || '', b.badge || '', b.rating || '', b.addedAt || Date.now());
    }
    // Remove server bookmarks not in client
    for (const slug of serverSlugs) {
      if (!clientSlugs.has(slug)) deleteOne.run(req.user.id, slug);
    }
  });

  syncAll();
  res.json({ ok: true });
});

// ─── API: Sync — History ──────────────────────────────────────────────────────
app.get('/api/sync/history', requireAuth, (req, res) => {
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

app.post('/api/sync/history', requireAuth, (req, res) => {
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
        upsertHist.run(req.user.id, slug, h.title || '', h.cover || '', h.link || '', h.lastRead || Date.now());
      }
    }
    if (readChapters && typeof readChapters === 'object') {
      for (const [key, val] of Object.entries(readChapters)) {
        if (key.endsWith('_all') && Array.isArray(val)) {
          const slug = key.replace(/_all$/, '');
          for (const url of val) upsertChap.run(req.user.id, slug, url);
        } else if (!key.endsWith('_all') && val && val.link) {
          upsertLast.run(req.user.id, key, val.link, val.title || '');
        }
      }
    }
  });

  syncAll();
  res.json({ ok: true });
});

// ─── API: Latest ──────────────────────────────────────────────────────────────
app.get('/api/latest', async (req, res) => {
  const serverPage = parseInt(req.query.page) || 1;
  try {
    const cards = await fetchLatestCards(serverPage);
    prefetch(serverPage + 1);
    prefetch(serverPage + 2);
    // Allow browsers/SW to serve a stale copy for up to 5 min while revalidating
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ results: cards, page: serverPage });
  } catch (err) {
    console.error('Latest error:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest updates', details: err.message });
  }
});

// ─── API: Browse ──────────────────────────────────────────────────────────────
app.get('/api/browse', async (req, res) => {
  const { page = 1, order = 'latest', genre = '' } = req.query;
  try {
    const url = genre
      ? `${BASE_URL}/series/?page=${page}&m_orderby=${order}&genre[]=${encodeURIComponent(genre)}`
      : `${BASE_URL}/series/?page=${page}&m_orderby=${order}`;

    // Check parsed-result cache first to skip Cheerio re-parse on hot paths
    const resultCacheKey = `browse-parsed:${url}`;
    const cachedResult = browseResultCache.get(resultCacheKey);
    if (cachedResult) {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      return res.json(cachedResult);
    }

    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.page-item-detail').each((_, el) => {
      const card = parseCard($, el);
      if (card) {
        card.latestChapter = card.chapters[0]?.title || '';
        results.push(card);
      }
    });

    let totalPages = 0;
    const lastPageLink = $('.wp-pagenavi a:last-child').attr('href') || '';
    const pageMatch = lastPageLink.match(/page\/(\d+)/);
    if (pageMatch) totalPages = parseInt(pageMatch[1]);

    const payload = { results, page: parseInt(page), totalPages };
    browseResultCache.set(resultCacheKey, payload);

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(payload);
  } catch (err) {
    console.error('Browse error:', err.message);
    res.status(500).json({ error: 'Failed to fetch browse results', details: err.message });
  }
});

// ─── Search helpers ───────────────────────────────────────────────────────────
function normalizeForSearch(str) {
  return str
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleMatchesQuery(title, query) {
  const normTitle = normalizeForSearch(title);
  const normQuery = normalizeForSearch(query);
  const words = normQuery.split(' ').filter(Boolean);
  return words.every(word => normTitle.includes(word));
}

// ─── API: Search ──────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { q, page = 1 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const normalized = q
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/[^\w\s'\-.,!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const url = `${BASE_URL}/?s=${encodeURIComponent(normalized)}&post_type=wp-manga&paged=${page}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const rawResults = [];

    $('.page-item-detail').each((_, el) => {
      const card = parseCard($, el);
      if (card) {
        card.latestChapter = card.chapters[0]?.title || '';
        rawResults.push(card);
      }
    });

    const results = rawResults.filter(card => titleMatchesQuery(card.title, q));

    let totalPages = 1;
    const lastPageLink = $('.wp-pagenavi a:last-child').attr('href') || '';
    const pageMatch = lastPageLink.match(/paged=(\d+)/);
    if (pageMatch) totalPages = parseInt(pageMatch[1]);

    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    res.json({ results, page: parseInt(page), totalPages });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to fetch search results', details: err.message });
  }
});

// ─── Shared manga-page parser ─────────────────────────────────────────────────
// Used by both /api/manga/:slug and /api/manga/batch to avoid duplicating
// Cheerio traversal logic.
async function parseMangaPage($, slug, full = true) {
  const title    = $('.post-title h1, .post-title h3').first().text().trim();
  const rawCover = $('.summary_image img').attr('src') || $('.summary_image img').attr('data-src') || '';
  const cover    = rawCover.startsWith('data:') ? await resolveCover(slug) : rawCover;

  const chapters = [];
  $('.wp-manga-chapter').each((_, el) => {
    const $el = $(el);
    const chLink  = $el.find('a').attr('href') || '';
    const chTitle = $el.find('a').text().trim();
    const chDate  = $el.find('.chapter-release-date i').text().trim();
    if (chLink) chapters.push({ title: chTitle, link: chLink, date: chDate });
  });

  if (!full) return { title, cover, chapters };

  const summary = $('.summary__content p').text().trim() || $('.summary__content').text().trim();
  const rating  = $('.score').first().text().trim();
  const status  = $('.post-status .summary-content').first().text().trim();
  const author  = $('.author-content a').map((_, el) => $(el).text().trim()).get().join(', ');
  const genres  = $('.genres-content a').map((_, el) => $(el).text().trim()).get();

  return { title, cover, summary, rating, status, author, genres, chapters };
}

// ─── API: Manga Detail ────────────────────────────────────────────────────────
app.get('/api/manga/batch', async (req, res) => {
  // Batch endpoint: GET /api/manga/batch?slugs=slug1,slug2,...
  // Returns { slug: { title, cover, chapters[0..1] } } for up to 20 slugs in one round-trip.
  const raw = (req.query.slugs || '').toString().trim();
  if (!raw) return res.status(400).json({ error: 'slugs parameter required' });

  const slugs = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

  const results = await Promise.all(slugs.map(async (slug) => {
    // Serve from parsed cache when available
    const cached = mangaDetailCache.get(slug);
    if (cached) return [slug, { title: cached.title, cover: cached.cover, chapters: cached.chapters.slice(0, 2) }];

    try {
      const url  = `${BASE_URL}/series/${slug}/`;
      const html = await fetchHTML(url);
      const $    = cheerio.load(html);

      const detail = await parseMangaPage($, slug, false);
      // Store in cache so /api/manga/:slug also benefits
      mangaDetailCache.set(slug, detail);

      return [slug, { title: detail.title, cover: detail.cover, chapters: detail.chapters.slice(0, 2) }];
    } catch {
      return [slug, null];
    }
  }));

  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  res.json(Object.fromEntries(results));
});

app.get('/api/manga/*', async (req, res) => {
  const slug = req.params[0];

  // Serve from parsed-detail cache to skip Cheerio re-parse on hot paths
  const cachedDetail = mangaDetailCache.get(slug);
  if (cachedDetail) {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return res.json(cachedDetail);
  }

  const url  = `${BASE_URL}/series/${slug}/`;
  try {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    const payload = await parseMangaPage($, slug, true);
    payload.url = url;
    mangaDetailCache.set(slug, payload);

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(payload);
  } catch (err) {
    console.error('Manga detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch manga details', details: err.message });
  }
});

// ─── API: Chapter Images ──────────────────────────────────────────────────────
app.get('/api/chapter', async (req, res) => {
  const { url: chapterUrl } = req.query;
  if (!chapterUrl) return res.status(400).json({ error: 'Chapter URL required' });
  if (!chapterUrl.startsWith(BASE_URL)) return res.status(400).json({ error: 'Invalid URL' });

  try {
    const html = await fetchHTML(chapterUrl, cache);
    const $ = cheerio.load(html);
    const images = [];

    $('.reading-content .page-break img, .reading-content img').each((_, el) => {
      const src = ($(el).attr('data-src') || $(el).attr('src') || '').trim();
      if (src && !src.includes('data:image')) images.push(src);
    });

    if (images.length === 0) {
      $('img.wp-manga-chapter-img').each((_, el) => {
        const src = ($(el).attr('data-src') || $(el).attr('src') || '').trim();
        if (src) images.push(src);
      });
    }

    const prevChapter  = $('a.prev_page, .nav-previous a').first().attr('href') || null;
    const nextChapter  = $('a.next_page, .nav-next a').first().attr('href') || null;
    const chapterTitle = $('.breadcrumb li:last-child span, .c-breadcrumb li:last-child').text().trim();
    const mangaTitle   = $('.breadcrumb li:nth-last-child(2) a, .c-breadcrumb li:nth-last-child(2) a').text().trim();

    res.json({ images, prevChapter, nextChapter, chapterTitle, mangaTitle });
  } catch (err) {
    console.error('Chapter error:', err.message);
    res.status(500).json({ error: 'Failed to fetch chapter', details: err.message });
  }
});

// ─── API: Image Proxy ─────────────────────────────────────────────────────────
const ALLOWED_IMG_HOSTS = [
  'mangadistrict.com',
  'cdn.mangadistrict.com',
  'i0.wp.com',
  'i1.wp.com',
  'i2.wp.com',
  'i3.wp.com',
];

app.get('/api/image', async (req, res) => {
  const { url: imgUrl } = req.query;
  if (!imgUrl) return res.status(400).json({ error: 'Image URL required' });

  let parsedHost;
  try {
    parsedHost = new URL(imgUrl).hostname;
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const allowed = ALLOWED_IMG_HOSTS.some(h => parsedHost === h || parsedHost.endsWith('.' + h));
  if (!allowed) return res.status(400).json({ error: 'Image host not allowed' });

  const cacheKey = 'img:' + imgUrl;
  const cached = imgCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buffer);
  }

  try {
    const response = await axiosInstance.get(imgUrl, {
      headers: { ...HEADERS, 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      responseType: 'arraybuffer',
      timeout: 20000,
    });
    const buffer      = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || 'image/jpeg';
    imgCache.set(cacheKey, { buffer, contentType });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('Image proxy error:', err.message);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// ─── Serve frontend ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Startup ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ToonReader running at http://localhost:${PORT}`);
  console.log(`Source: ${BASE_URL}`);
  console.log('Prefetching home pages 1-5...');
  for (let p = 1; p <= 5; p++) prefetch(p);
  console.log('Prefetch started in background.');
});
