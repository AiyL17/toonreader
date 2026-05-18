const cheerio = require('cheerio');
const { axiosInstance, BASE_URL } = require('./axios');
const { cache, coverCache } = require('./cache');

// ─── In-flight deduplication ──────────────────────────────────────────────────
// Prevents duplicate concurrent requests for the same URL/key.
const inFlight = new Map();

// ─── Generic cached HTML fetch ────────────────────────────────────────────────
async function fetchHTML(url, cacheStore = cache) {
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

// ─── Resolve missing cover via manga detail page ──────────────────────────────
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

// ─── Parse a manga card element from Cheerio ─────────────────────────────────
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

// ─── Fetch and parse latest cards for a given server page ────────────────────
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

// ─── Prefetch a server page into cache in the background ─────────────────────
function prefetch(serverPage) {
  const key = 'latest-cards:' + serverPage;
  if (!cache.get(key) && !inFlight.has(key)) {
    fetchLatestCards(serverPage).catch(() => {});
  }
}

// ─── Parse a full manga detail page ──────────────────────────────────────────
// Used by both /api/manga/:slug and /api/manga/batch.
// Pass full=false to get only title, cover, and chapters (faster for batch).
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

module.exports = {
  fetchHTML,
  fetchLatestCards,
  prefetch,
  parseCard,
  parseMangaPage,
  resolveCover,
  pLimit,
  normalizeForSearch,
  titleMatchesQuery,
};
