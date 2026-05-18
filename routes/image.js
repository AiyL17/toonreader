const express = require('express');
const { axiosInstance, HEADERS } = require('../lib/axios');
const { imgCache } = require('../lib/cache');

const router = express.Router();

const ALLOWED_IMG_HOSTS = [
  'mangadistrict.com',
  'cdn.mangadistrict.com',
  'i0.wp.com',
  'i1.wp.com',
  'i2.wp.com',
  'i3.wp.com',
];

// ─── Image proxy ──────────────────────────────────────────────────────────────
// Proxies manga cover and page images to bypass CORS restrictions.
// Only allows requests to whitelisted hostnames.
router.get('/', async (req, res) => {
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

module.exports = router;
