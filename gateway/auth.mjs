// Auth routes for the gateway. Two-step login with an emailed one-time code (2FA):
//   POST /auth/login  { email, password }  → verify password, email a 6-digit code
//   POST /auth/verify { email, code }       → check code, issue the opaque session
//   POST /auth/logout  (Bearer)             → revoke the session
//   GET  /auth/whoami  (Bearer)             → account + session expiry
// Plain (req, res) handlers over node:http — no framework.

import { API_ERRORS, sendApiError } from './kit/errors.mjs'
import { normalizeEmail } from './kit/email.mjs'
import { readJsonBody } from './http.mjs'
import { renderOtpEmail } from './emails.mjs'

const EMAIL_MIN = 5
const EMAIL_MAX = 254
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const CODE_LENGTH = 6
const MAX_BODY = 4096
const LOGIN_PURPOSE = 'login'

const nowSeconds = () => Math.floor(Date.now() / 1000)

const validCredentialShape = (body) =>
  Boolean(body) &&
  typeof body.email === 'string' &&
  typeof body.password === 'string' &&
  body.email.length >= EMAIL_MIN &&
  body.email.length <= EMAIL_MAX &&
  body.password.length >= PASSWORD_MIN &&
  body.password.length <= PASSWORD_MAX

const validCodeShape = (body) =>
  Boolean(body) &&
  typeof body.email === 'string' &&
  typeof body.code === 'string' &&
  body.email.length >= EMAIL_MIN &&
  body.email.length <= EMAIL_MAX &&
  body.code.length === CODE_LENGTH

export const createAuthRoutes = ({
  users,
  sessions,
  hasher,
  actionCodes,
  emailSender,
  loginLimiter,
  verifyLimiter,
  clientIp,
  gatewayUrl = '',
  log = console,
}) => {
  // Step 1: verify the password, then email a one-time code. No session yet.
  const handleLogin = async (req, res) => {
    const ip = clientIp(req)
    if (loginLimiter.isLimited(ip) || loginLimiter.isLimited('global')) {
      return sendApiError(res, API_ERRORS.RATE_LIMITED)
    }
    const body = await readJsonBody(req, MAX_BODY)
    if (!validCredentialShape(body)) return sendApiError(res, API_ERRORS.INVALID_INPUT)

    const email = normalizeEmail(body.email)
    if (!email) return sendApiError(res, API_ERRORS.INVALID_CREDENTIALS)
    const user = users.findByEmail(email)
    if (!user) return sendApiError(res, API_ERRORS.INVALID_CREDENTIALS)
    const ok = await hasher.verifyPassword(body.password, user.pass_hash, user.pass_salt)
    if (!ok) return sendApiError(res, API_ERRORS.INVALID_CREDENTIALS)

    const code = actionCodes.issue({ userId: user.id, purpose: LOGIN_PURPOSE, now: nowSeconds() })
    const mail = renderOtpEmail(code, gatewayUrl)
    const sent = await emailSender.send({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text })
    if (!sent.ok) log.log(`[auth] login code email failed for ${user.email}: ${sent.error}`)

    // Do not leak send status: always ask for the code (the user can retry to resend).
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ otpRequired: true }))
  }

  // Step 2: check the code, issue the session.
  const handleVerify = async (req, res) => {
    const ip = clientIp(req)
    if (verifyLimiter.isLimited(ip) || verifyLimiter.isLimited('global')) {
      return sendApiError(res, API_ERRORS.RATE_LIMITED)
    }
    const body = await readJsonBody(req, MAX_BODY)
    if (!validCodeShape(body)) return sendApiError(res, API_ERRORS.INVALID_INPUT)

    const email = normalizeEmail(body.email)
    // Same INVALID_CODE for unknown email, no outstanding code, expired, or mismatch.
    if (!email) return sendApiError(res, API_ERRORS.INVALID_CODE)
    const user = users.findByEmail(email)
    if (!user) return sendApiError(res, API_ERRORS.INVALID_CODE)

    const now = nowSeconds()
    const result = actionCodes.consume({ userId: user.id, purpose: LOGIN_PURPOSE, code: body.code, now })
    if (!result.ok) return sendApiError(res, API_ERRORS.INVALID_CODE)

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

  return { handleLogin, handleVerify, handleLogout, handleWhoami }
}
