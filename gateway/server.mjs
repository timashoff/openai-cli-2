// API gateway — pure Node standard library, ZERO external packages. Runs on the
// US VPS. A client (openai-cli, a Shortcut, ...) authenticates with email+password
// via /auth/login and receives an opaque session token; it then sends that token
// as "Authorization: Bearer <session>" on every request. The gateway validates the
// session, swaps in the REAL provider key, and streams the answer straight back.
// No VPN needed on the client side.
//
// Run (keys come from the environment, never hard-coded):
//   GW_PORT=8443 GW_DB=~/gateway/auth.db GW_SESSION_TTL_DAYS=90 \
//   OPENAI_API_KEY="sk-..." ANTHROPIC_API_KEY="sk-ant-..." \
//   GW_TLS_CERT=~/gateway/cert.pem GW_TLS_KEY=~/gateway/key.pem \
//   [GW_TOKENS="legacy,static,tokens"]   # migration-only fallback; remove after cutover
//   node gateway/server.mjs
import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { homedir } from 'node:os'
import { openDb } from './db.mjs'
import { createUsersRepo } from './users-repo.mjs'
import { createSessionsRepo } from './sessions-repo.mjs'
import { createPasswordHasher } from './kit/passwords.mjs'
import { createRateLimiter } from './kit/rate-limit.mjs'
import { API_ERRORS, sendApiError } from './kit/errors.mjs'
import { createAuthRoutes } from './auth.mjs'
import { createActionCodesRepo } from './action-codes-repo.mjs'
import { createEmailSender, createNoopEmailSender } from './kit/email-sender.mjs'
import { createSyncRepo } from './sync-repo.mjs'
import { createSyncRoutes } from './sync-routes.mjs'

const PORT = Number(process.env.GW_PORT) || 8443
const DB_PATH = process.env.GW_DB || `${homedir()}/gateway/auth.db`
const TTL_DAYS = Number(process.env.GW_SESSION_TTL_DAYS) || 90

// Migration-window fallback: a static shared token still authenticates while
// clients move to sessions. Remove GW_TOKENS from the env after cutover.
const STATIC_TOKENS = new Set(
  (process.env.GW_TOKENS || '').split(',').map((t) => t.trim()).filter(Boolean),
)

// Per-provider upstream + how the REAL key is presented to that provider.
const UPSTREAMS = {
  openai: {
    base: 'https://api.openai.com',
    auth: () => ({ authorization: `Bearer ${process.env.OPENAI_API_KEY}` }),
  },
  anthropic: {
    base: 'https://api.anthropic.com',
    auth: () => ({
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    }),
  },
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

const db = openDb(DB_PATH)
const users = createUsersRepo(db)
const sessions = createSessionsRepo(db, { ttlSeconds: TTL_DAYS * 86400 })
const hasher = createPasswordHasher()
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 })
const verifyLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 })
// One budget for both reset endpoints, separate from login so reset spam
// cannot starve login attempts (and vice versa).
const resetLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 })
// Directly exposed on :8443 (no reverse proxy) → the socket IP is the real client.
const clientIp = (req) => req.socket.remoteAddress || 'unknown'
const actionCodes = createActionCodesRepo(db, { ttlSeconds: 10 * 60, maxAttempts: 5 })
// Real Resend sender when a key is set; else a no-op that only logs the code when
// GW_EMAIL_DEV=true (local testing). A missing key never crashes boot.
const emailSender = process.env.RESEND_API_KEY
  ? createEmailSender({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM || 'openai-cli <onboarding@resend.dev>',
    })
  : createNoopEmailSender({ logCode: process.env.GW_EMAIL_DEV === 'true' })
const auth = createAuthRoutes({
  users, sessions, hasher, actionCodes, emailSender, loginLimiter, verifyLimiter, resetLimiter,
  clientIp, gatewayUrl: process.env.GW_PUBLIC_URL || '',
})
const sync = createSyncRoutes({ repo: createSyncRepo(db) })

// Reap expired sessions + login codes on boot and daily.
sessions.deleteExpired(nowSeconds())
actionCodes.deleteExpired(nowSeconds())
setInterval(() => {
  sessions.deleteExpired(nowSeconds())
  actionCodes.deleteExpired(nowSeconds())
}, 24 * 3600 * 1000).unref()

// The bare token from "Authorization: Bearer <token>", or '' if absent.
const bearer = (req) => {
  const h = req.headers['authorization'] || ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

// Authorized if the token is a live session OR (migration only) a static token.
const authorized = (presented) => {
  if (!presented) return false
  const row = sessions.find(sessions.hash(presented))
  if (row && row.expires_at > nowSeconds()) {
    sessions.touch(row.token_hash, nowSeconds())
    return true
  }
  return STATIC_TOKENS.has(presented)
}

// The account id behind a live session, or null. Used by /sync (a static token has
// no account, so it cannot sync).
const sessionUserId = (presented) => {
  if (!presented) return null
  const row = sessions.find(sessions.hash(presented))
  if (row && row.expires_at > nowSeconds()) {
    sessions.touch(row.token_hash, nowSeconds())
    return row.user_id
  }
  return null
}

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// Forward to the real provider with the REAL key swapped in (session dropped),
// and stream the answer straight back (SSE included, no buffering).
const handleProxy = async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const [, provider, ...rest] = url.pathname.split('/')
  const up = UPSTREAMS[provider]
  if (!up) return sendApiError(res, API_ERRORS.NOT_FOUND)

  const target = `${up.base}/${rest.join('/')}${url.search}`
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const contentType = req.headers['content-type']
  let upstream
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {
        ...(contentType ? { 'content-type': contentType } : {}),
        accept: req.headers['accept'] || '*/*',
        ...up.auth(),
      },
      body: hasBody ? await readBody(req) : undefined,
    })
  } catch (e) {
    return sendApiError(res, API_ERRORS.BAD_GATEWAY)
  }

  const out = {}
  const ct = upstream.headers.get('content-type')
  if (ct) out['content-type'] = ct
  res.writeHead(upstream.status, out)
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
  else res.end()
}

const handle = async (req, res) => {
  const url = new URL(req.url, 'http://x')

  // 1. Auth routes are exempt from the session guard (login carries no session yet;
  //    password reset is pre-auth by nature).
  if (req.method === 'POST' && url.pathname === '/auth/login') return auth.handleLogin(req, res)
  if (req.method === 'POST' && url.pathname === '/auth/verify') return auth.handleVerify(req, res)
  if (req.method === 'POST' && url.pathname === '/auth/request-reset') {
    return auth.handleRequestReset(req, res)
  }
  if (req.method === 'POST' && url.pathname === '/auth/reset') return auth.handleReset(req, res)
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    return auth.handleLogout(req, res, bearer(req))
  }
  if (req.method === 'GET' && url.pathname === '/auth/whoami') {
    return auth.handleWhoami(req, res, bearer(req))
  }

  // 2. Account data sync (delta): requires a real session (a static token has no account).
  if (url.pathname === '/sync') {
    const userId = sessionUserId(bearer(req))
    if (userId === null) return sendApiError(res, API_ERRORS.UNAUTHORIZED)
    if (req.method === 'GET') return sync.handlePull(req, res, userId)
    if (req.method === 'POST') return sync.handlePush(req, res, userId)
    return sendApiError(res, API_ERRORS.NOT_FOUND)
  }

  // 3. Everything else requires a live session (or the migration static token). This
  //    401 carries the distinct GATEWAY_SESSION_INVALID code — the ONLY 401 the client
  //    maps to "Run: ai login"; an upstream provider 401 is passed through verbatim so
  //    the client shows the real cause instead of a misleading re-login prompt.
  if (!authorized(bearer(req))) return sendApiError(res, API_ERRORS.GATEWAY_SESSION)

  // 3. Route by the first path segment: /openai/... or /anthropic/...
  return handleProxy(req, res)
}

const tls = {
  cert: readFileSync(process.env.GW_TLS_CERT),
  key: readFileSync(process.env.GW_TLS_KEY),
}

createServer(tls, (req, res) => {
  handle(req, res).catch(() => sendApiError(res, API_ERRORS.SERVER_ERROR))
}).listen(PORT, () => {
  const mode = STATIC_TOKENS.size > 0 ? 'sessions+static' : 'sessions'
  const email = process.env.RESEND_API_KEY ? 'resend' : (process.env.GW_EMAIL_DEV === 'true' ? 'dev-log' : 'off')
  console.log(`gateway on :${PORT} — auth: ${mode} (2FA), email: ${email}, providers: ${Object.keys(UPSTREAMS).join(', ')}`)
})
