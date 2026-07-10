// Auth routes for the gateway. Two-step login with an emailed one-time code (2FA):
//   POST /auth/login  { email, password }  → verify password, email a 6-digit code
//   POST /auth/verify { email, code }       → check code, issue the opaque session
//   POST /auth/logout  (Bearer)             → revoke the session
//   GET  /auth/whoami  (Bearer)             → account + session expiry
// Self-service "forgot password" (pre-auth, enumeration-safe):
//   POST /auth/request-reset { email }               → always 202; emails a reset code if the account exists
//   POST /auth/reset { email, code, newPassword }    → set the new password, revoke every session
// Plain (req, res) handlers over node:http — no framework.

import { API_ERRORS, sendApiError } from './kit/errors.mjs'
import { normalizeEmail } from './kit/email.mjs'
import { readJsonBody } from './http.mjs'
import { renderOtpEmail, renderResetEmail } from './emails.mjs'

const EMAIL_MIN = 5
const EMAIL_MAX = 254
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const CODE_LENGTH = 6
const MAX_BODY = 4096
const LOGIN_PURPOSE = 'login'
const RESET_PURPOSE = 'reset'
const RESET_RESEND_COOLDOWN_SECONDS = 60

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

const validResetRequestShape = (body) =>
  Boolean(body) &&
  typeof body.email === 'string' &&
  body.email.length >= EMAIL_MIN &&
  body.email.length <= EMAIL_MAX

const validResetShape = (body) =>
  Boolean(body) &&
  typeof body.email === 'string' &&
  typeof body.code === 'string' &&
  typeof body.newPassword === 'string' &&
  body.email.length >= EMAIL_MIN &&
  body.email.length <= EMAIL_MAX &&
  body.code.length === CODE_LENGTH &&
  body.newPassword.length >= PASSWORD_MIN &&
  body.newPassword.length <= PASSWORD_MAX

export const createAuthRoutes = ({
  users,
  sessions,
  hasher,
  actionCodes,
  emailSender,
  loginLimiter,
  verifyLimiter,
  resetLimiter,
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

  // Fire-and-forget reset-email delivery. send() never throws by contract; the
  // guard keeps a detached rejection from ever killing the process.
  const deliverResetEmail = async (to, mail) => {
    try {
      const sent = await emailSender.send({ to, subject: mail.subject, html: mail.html, text: mail.text })
      if (!sent.ok) log.log(`[auth] reset code email failed for ${to}: ${sent.error}`)
    } catch (error) {
      log.log(`[auth] reset code email failed for ${to}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Forgot password, step 1: always reply 202 (enumeration-safe) — a code is
  // issued and emailed only when the account exists. The send is NOT awaited so
  // reply latency cannot reveal whether the account exists. A repeat request
  // within the cooldown sends nothing and keeps the pending code valid (this
  // endpoint is anonymous — the cooldown stops email spam at a victim's address).
  const handleRequestReset = async (req, res) => {
    const ip = clientIp(req)
    if (resetLimiter.isLimited(ip) || resetLimiter.isLimited('global')) {
      return sendApiError(res, API_ERRORS.RATE_LIMITED)
    }
    const body = await readJsonBody(req, MAX_BODY)
    if (!validResetRequestShape(body)) return sendApiError(res, API_ERRORS.INVALID_INPUT)

    const email = normalizeEmail(body.email)
    const user = email ? users.findByEmail(email) : null
    if (user) {
      const now = nowSeconds()
      const cooling = actionCodes.issuedWithin({
        userId: user.id,
        purpose: RESET_PURPOSE,
        now,
        seconds: RESET_RESEND_COOLDOWN_SECONDS,
      })
      if (!cooling) {
        const code = actionCodes.issue({ userId: user.id, purpose: RESET_PURPOSE, now })
        deliverResetEmail(user.email, renderResetEmail(code, gatewayUrl))
      }
    }

    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  }

  // Forgot password, step 2: code + new password. A reset implies possible
  // compromise, so every existing session is revoked; the user then logs in
  // with the new password (a fresh 2FA pass — deliberately no auto-login).
  const handleReset = async (req, res) => {
    const ip = clientIp(req)
    if (resetLimiter.isLimited(ip) || resetLimiter.isLimited('global')) {
      return sendApiError(res, API_ERRORS.RATE_LIMITED)
    }
    const body = await readJsonBody(req, MAX_BODY)
    if (!validResetShape(body)) return sendApiError(res, API_ERRORS.INVALID_INPUT)

    const email = normalizeEmail(body.email)
    // Same INVALID_CODE for unknown email, no outstanding code, expired, or mismatch.
    if (!email) return sendApiError(res, API_ERRORS.INVALID_CODE)
    const user = users.findByEmail(email)
    if (!user) return sendApiError(res, API_ERRORS.INVALID_CODE)

    const result = actionCodes.consume({
      userId: user.id,
      purpose: RESET_PURPOSE,
      code: body.code,
      now: nowSeconds(),
    })
    if (!result.ok) return sendApiError(res, API_ERRORS.INVALID_CODE)

    const { hash, salt } = await hasher.hashPassword(body.newPassword)
    users.updatePassword({ email: user.email, passHash: hash, passSalt: salt })
    sessions.deleteAllForUser(user.id)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
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

  return { handleLogin, handleVerify, handleRequestReset, handleReset, handleLogout, handleWhoami }
}
