// Sessions table access — opaque, long-lived, server-revocable bearer tokens.
// Only sha256(token) is stored; the raw token is returned once at login and
// never persisted server-side. No rotation (unlike hsk's refresh chain): a
// stable token is safe under a multi-process CLI, and revocation is a row delete.

import { createHash, randomBytes } from 'node:crypto'

export const createSessionsRepo = (db, { ttlSeconds }) => {
  const insert = db.prepare(
    'INSERT INTO sessions(token_hash, user_id, created_at, expires_at, last_seen_at) VALUES(?,?,?,?,?)',
  )
  const findByHash = db.prepare(
    'SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?',
  )
  const touchStmt = db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
  const delOne = db.prepare('DELETE FROM sessions WHERE token_hash = ?')
  const delUser = db.prepare('DELETE FROM sessions WHERE user_id = ?')
  const delExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
  const countUser = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')

  const generate = () => randomBytes(32).toString('hex')
  const hash = (raw) => createHash('sha256').update(raw).digest('hex')

  return {
    generate,
    hash,
    // Mint a session: returns the RAW token (shown once) and its expiry.
    create: ({ userId, now }) => {
      const raw = generate()
      const expiresAt = now + ttlSeconds
      insert.run(hash(raw), userId, now, expiresAt, now)
      return { raw, expiresAt }
    },
    find: (tokenHash) => findByHash.get(tokenHash),
    touch: (tokenHash, now) => touchStmt.run(now, tokenHash),
    del: (tokenHash) => delOne.run(tokenHash),
    deleteAllForUser: (userId) => delUser.run(userId),
    deleteExpired: (now) => delExpired.run(now),
    countForUser: (userId) => countUser.get(userId).n,
  }
}
