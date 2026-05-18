const express  = require('express');
const cheerio  = require('cheerio');
const { BASE_URL } = require('../lib/axios');
const {
  fetchHTML,
  fetchLatestCards,
  prefetch,
  parseCard,
  parseMangaPage,
  titleMatchesQuery,
} = require('../lib/scraper');
const { cache, browseResultCache, mangaDetailCache } = require('../lib/cache');

const router = express.Router();

// ─── Latest ───────────────────────────────────────────────────────────────────
router.get('/latest', async (req, res) => {
  const serverPage = parseInt(req.query.page, 10) || 1;
  try {
    const cards = await fetchLatestCards(serverPage);
    prefetch(serverPage + 1);
    prefetch(serverPage + 2);
    // Allow browsers/SW to serve a stale copy for up to 5 min while revalidating
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ results: cards, page: serverPage });
  } catch (err) {
    console.error('Latest error:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest updates' });
  }
});

// ─── Browse ───────────────────────────────────────────────────────────────────
router.get('/browse', async (req, res) => {
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
    if (pageMatch) totalPages = parseInt(pageMatch[1], 10);

    const payload = { results, page: parseInt(page, 10), totalPages };
    browseResultCache.set(resultCacheKey, payload);

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(payload);
  } catch (err) {
    console.error('Browse error:', err.message);
    res.status(500).json({ error: 'Failed to fetch browse results' });
  }
});

// ─── Search ───────────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
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
    if (pageMatch) totalPages = parseInt(pageMatch[1], 10);

    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    res.json({ results, page: parseInt(page, 10), totalPages });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});

// ─── Manga batch ──────────────────────────────────────────────────────────────
// GET /api/manga/batch?slugs=slug1,slug2,...
// Returns { slug: { title, cover, chapters[0..1] } } for up to 20 slugs.
router.get('/manga/batch', async (req, res) => {
  const raw = (req.query.slugs || '').toString().trim();
  if (!raw) return res.status(400).json({ error: 'slugs parameter required' });

  const slugs = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

  const results = await Promise.all(slugs.map(async (slug) => {
    const cached = mangaDetailCache.get(slug);
    if (cached) return [slug, { title: cached.title, cover: cached.cover, chapters: cached.chapters.slice(0, 2) }];

    try {
      const url    = `${BASE_URL}/series/${slug}/`;
      const html   = await fetchHTML(url);
      const $      = cheerio.load(html);
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

// ─── Manga detail ─────────────────────────────────────────────────────────────
router.get('/manga/*', async (req, res) => {
  const slug = req.params[0];

  const cachedDetail = mangaDetailCache.get(slug);
  if (cachedDetail) {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return res.json(cachedDetail);
  }

  const url = `${BASE_URL}/series/${slug}/`;
  try {
    const html    = await fetchHTML(url);
    const $       = cheerio.load(html);
    const payload = await parseMangaPage($, slug, true);
    payload.url   = url;
    mangaDetailCache.set(slug, payload);

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(payload);
  } catch (err) {
    console.error('Manga detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch manga details' });
  }
});

// ─── Chapter images ───────────────────────────────────────────────────────────
router.get('/chapter', async (req, res) => {
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
    res.status(500).json({ error: 'Failed to fetch chapter' });
  }
});

module.exports = router;
