const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'toonreader.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    cover      TEXT    NOT NULL DEFAULT '',
    link       TEXT    NOT NULL DEFAULT '',
    badge      TEXT    NOT NULL DEFAULT '',
    rating     TEXT    NOT NULL DEFAULT '',
    added_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    UNIQUE(user_id, slug)
  );

  CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    cover      TEXT    NOT NULL DEFAULT '',
    link       TEXT    NOT NULL DEFAULT '',
    last_read  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    UNIQUE(user_id, slug)
  );

  CREATE TABLE IF NOT EXISTS read_chapters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,
    chapter_url TEXT   NOT NULL,
    UNIQUE(user_id, slug, chapter_url)
  );

  CREATE TABLE IF NOT EXISTS last_read_chapter (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,
    chapter_url TEXT   NOT NULL,
    chapter_title TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(user_id, slug)
  );
`);

module.exports = db;
