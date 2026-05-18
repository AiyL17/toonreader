const rateLimit = require('express-rate-limit');
const jwt       = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'toonreader-secret-change-in-production';
const JWT_EXPIRY = '30d';

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

// Returns consistent cookie options; secure flag is enabled in production
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

// Signs a JWT token with the configured secret and expiry
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// Verifies a JWT token and returns the decoded payload; throws on invalid/expired
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Middleware that protects routes requiring a valid session
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

module.exports = { limiter, authLimiter, requireAuth, cookieOptions, signToken, verifyToken };
