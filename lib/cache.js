const NodeCache = require('node-cache');

// maxKeys prevents unbounded memory growth on long-running instances.
// When the limit is reached, node-cache evicts the oldest entry automatically.

// latest/chapters: 15 min, max 500 entries
const cache = new NodeCache({ stdTTL: 900, checkperiod: 120, maxKeys: 500 });

// browse/search/manga: 30 min, max 1000 entries
const browseCache = new NodeCache({ stdTTL: 1800, checkperiod: 180, maxKeys: 1000 });

// covers: 24 h, max 2000 entries
const coverCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600, maxKeys: 2000 });

// Image buffers are large (~100–500 KB each); cap at 200 entries (~100 MB worst-case).
// images: 1 h, max 200 entries
const imgCache = new NodeCache({ stdTTL: 3600, checkperiod: 600, maxKeys: 200 });

// Parsed manga detail objects (title, chapters, genres…) — avoids re-parsing HTML on every hit.
// manga detail: 30 min, max 500 entries
const mangaDetailCache = new NodeCache({ stdTTL: 1800, checkperiod: 180, maxKeys: 500 });

// Parsed browse page results — avoids re-running Cheerio on cached HTML.
// browse results: 30 min, max 2000 entries
const browseResultCache = new NodeCache({ stdTTL: 1800, checkperiod: 180, maxKeys: 2000 });

module.exports = {
  cache,
  browseCache,
  coverCache,
  imgCache,
  mangaDetailCache,
  browseResultCache,
};
