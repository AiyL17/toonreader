const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authLimiter, signToken, verifyToken, cookieOptions } = require('../middleware/auth');

const router   = express.Router();

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
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
    const stmt   = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const result = stmt.run(username, hashed);
    const token  = signToken({ id: result.lastInsertRowid, username });
    res.cookie('token', token, cookieOptions());
    res.json({ ok: true, user: { id: result.lastInsertRowid, username } });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken({ id: user.id, username: user.username });
    res.cookie('token', token, cookieOptions());
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ─── Me (check session) ───────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ user: null });
  try {
    const user = verifyToken(token);
    res.json({ user: { id: user.id, username: user.username } });
  } catch {
    res.json({ user: null });
  }
});

module.exports = router;
