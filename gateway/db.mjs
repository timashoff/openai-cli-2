// Gateway auth store — node:sqlite (built-in; no external dependency). Single
// file, single writer, low QPS (one owner). The schema is inlined and applied
// idempotently on open, so there is no migration runner. Mirrors the node:sqlite
// usage in the CLI's services/commands/migrate.js.

import { DatabaseSync } from 'node:sqlite'

// users.email uses COLLATE NOCASE (replaces Postgres citext) for a case-insensitive
// unique login. Times are unix epoch seconds (integers) → expiry is an int compare.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
`

export const openDb = (path) => {
  const db = new DatabaseSync(path)
  // foreign_keys defaults OFF in SQLite → required for ON DELETE CASCADE.
  db.exec('PRAGMA foreign_keys = ON')
  // WAL lets admin.mjs read/write while the server holds the db open.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  return db
}
