// One-time 6-digit action codes (login OTP; extensible to reset/email-change via
// `purpose`). node:sqlite port of hsk-vocabulary's account-action-codes-repo.js.
// Only sha256 hashes are stored — the raw code lives only in the sent email. One
// outstanding code per (user, purpose); a re-issue UPSERTs and resets attempts;
// consume() is atomic (single-writer SQLite transaction) so a burst can't race
// past the attempt cap. The 6-digit space is small for UX and is NOT the security
// boundary — safety is the attempt cap + short TTL + single-outstanding invariant.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

const CODE_MODULUS = 1000000
const CODE_DIGITS = 6

const hashCode = (code) => createHash('sha256').update(code).digest('hex')

// Constant-time compare of two equal-length hex digests.
const hashesEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export const createActionCodesRepo = (db, { ttlSeconds, maxAttempts }) => {
  const upsert = db.prepare(
    `INSERT INTO action_codes(user_id, purpose, code_hash, attempts, expires_at, created_at)
     VALUES(?,?,?,0,?,?)
     ON CONFLICT(user_id, purpose) DO UPDATE SET
       code_hash = excluded.code_hash, attempts = 0,
       expires_at = excluded.expires_at, created_at = excluded.created_at`,
  )
  const find = db.prepare(
    'SELECT code_hash, attempts, expires_at FROM action_codes WHERE user_id = ? AND purpose = ?',
  )
  const findCreated = db.prepare(
    'SELECT created_at FROM action_codes WHERE user_id = ? AND purpose = ?',
  )
  const del = db.prepare('DELETE FROM action_codes WHERE user_id = ? AND purpose = ?')
  const bump = db.prepare(
    'UPDATE action_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ?',
  )
  const delExpired = db.prepare('DELETE FROM action_codes WHERE expires_at <= ?')

  // Uniform 6-digit code, zero-padded so every value (incl. "000123") is equally likely.
  const generate = () => String(randomInt(0, CODE_MODULUS)).padStart(CODE_DIGITS, '0')

  // Mint (or replace) the outstanding code for (user, purpose); returns the RAW code.
  const issue = ({ userId, purpose, now }) => {
    const code = generate()
    upsert.run(userId, purpose, hashCode(code), now + ttlSeconds, now)
    return code
  }

  // Atomic single-use check. ok=true ONLY on an exact, unexpired, under-cap match —
  // and the row is deleted. Every terminal failure is indistinguishable (ok=false).
  // A mismatch increments attempts; reaching the cap burns the code.
  const consume = ({ userId, purpose, code, now }) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = find.get(userId, purpose)
      if (!row) {
        db.exec('COMMIT')
        return { ok: false }
      }
      if (row.expires_at <= now || row.attempts >= maxAttempts) {
        del.run(userId, purpose)
        db.exec('COMMIT')
        return { ok: false }
      }
      if (!hashesEqual(hashCode(code), row.code_hash)) {
        bump.run(userId, purpose)
        db.exec('COMMIT')
        return { ok: false }
      }
      del.run(userId, purpose)
      db.exec('COMMIT')
      return { ok: true }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  // True when the outstanding code for (user, purpose) was issued less than
  // `seconds` ago — the resend cooldown for anonymous endpoints (anti email
  // spam at a victim's address). The pending code itself stays valid.
  const issuedWithin = ({ userId, purpose, now, seconds }) => {
    const row = findCreated.get(userId, purpose)
    return Boolean(row) && now - row.created_at < seconds
  }

  const deleteExpired = (now) => delExpired.run(now)

  return { generate, issue, consume, issuedWithin, deleteExpired }
}
