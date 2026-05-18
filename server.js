const express      = require('express');
const compression  = require('compression');
const cookieParser = require('cookie-parser');
const path         = require('path');

const { limiter }  = require('./middleware/auth');
const authRoutes   = require('./routes/auth');
const syncRoutes   = require('./routes/sync');
const contentRoutes = require('./routes/content');
const imageRoutes  = require('./routes/image');
const { prefetch } = require('./lib/scraper');

// Warn loudly when running with the default insecure JWT secret
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: JWT_SECRET env var is not set. Using insecure default. Set JWT_SECRET before deploying.');
}

const app = express();

// ─── Core middleware ──────────────────────────────────────────────────────────
// Lower threshold to 512 B so even small JSON API responses get compressed.
app.use(compression({ threshold: 512 }));
app.set('trust proxy', 1);
app.use(limiter);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));
app.use(express.json({ limit: '2mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/sync',  syncRoutes);
app.use('/api',       contentRoutes);
app.use('/api/image', imageRoutes);

// ─── Serve frontend (SPA fallback) ────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ToonReader running at http://localhost:${PORT}`);
  // prefetch() is a no-op when the page is already cached or a fetch is in-flight,
  // so it is safe to call unconditionally on every startup.
  console.log('Prefetching home pages 1-5...');
  for (let p = 1; p <= 5; p++) prefetch(p);
  console.log('Prefetch started in background.');
});
