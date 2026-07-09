// Auth routes for the gateway: POST /auth/login and POST /auth/logout.
// Plain (req, res) handlers over node:http — no framework. Login verifies
// email + password and issues an opaque session; logout revokes one.

import { API_ERRORS, sendApiError } from './kit/errors.mjs'
import { normalizeEmail } from './kit/email.mjs'

const EMAIL_MIN = 5
const EMAIL_MAX = 254
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const MAX_LOGIN_BODY = 4096

const nowSeconds = () => Math.floor(Date.now() / 1000)

// Read a small JSON body with a hard size cap. Returns null on overflow or
// invalid JSON (the caller maps that to INVALID_INPUT).
const readJsonBody = async (req, maxBytes) => {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) return null
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (e) {
    return null
  }
}

const validCredentialShape = (body) =>
  Boolean(body) &&
  typeof body.email === 'string' &&
  typeof body.password === 'string' &&
  body.email.length >= EMAIL_MIN &&
  body.email.length <= EMAIL_MAX &&
  body.password.length >= PASSWORD_MIN &&
  body.password.length <= PASSWORD_MAX

export const createAuthRoutes = ({ users, sessions, hasher, loginLimiter, clientIp }) => {
  const handleLogin = async (req, res) => {
    const ip = clientIp(req)
    // Per-IP AND a global budget: a distributed attack still hits a ceiling.
    if (loginLimiter.isLimited(ip) || loginLimiter.isLimited('global')) {
      return sendApiError(res, API_ERRORS.RATE_LIMITED)
    }

    const body = await readJsonBody(req, MAX_LOGIN_BODY)
    if (!validCredentialShape(body)) return sendApiError(res, API_ERRORS.INVALID_INPUT)

    const email = normalizeEmail(body.email)
    // Same error for unknown-email and wrong-password → no user enumeration.
    if (!email) return sendApiError(res, API_ERRORS.INVALID_CREDENTIALS)
    const user = users.findByEmail(email)
    if (!user) return sendApiError(res, API_ERRORS.INVALID_CREDENTIALS)

    const ok = await hasher.verifyPassword(body.password, user.pass_hash, user.pass_salt)
    if (!ok) return sendApiError(res, API_ERRORS.INVALID_CREDENTIALS)

    const now = nowSeconds()
    const session = sessions.create({ userId: user.id, now })
    users.touchLastSeen(user.id, now)

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ session: session.raw, expiresAt: session.expiresAt }))
  }

  // Presenting a session revokes it. Absent/unknown token still returns 204.
  const handleLogout = async (req, res, presented) => {
    if (presented) sessions.del(sessions.hash(presented))
    res.writeHead(204)
    res.end()
  }

  // Whoami: confirm the session is live and report the account + expiry.
  const handleWhoami = async (req, res, presented) => {
    if (!presented) return sendApiError(res, API_ERRORS.UNAUTHORIZED)
    const row = sessions.find(sessions.hash(presented))
    if (!row || row.expires_at <= nowSeconds()) return sendApiError(res, API_ERRORS.UNAUTHORIZED)
    const user = users.findById(row.user_id)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ email: user ? user.email : null, expiresAt: row.expires_at }))
  }

  return { handleLogin, handleLogout, handleWhoami }
}
