// Minimal API gateway — pure Node standard library, ZERO external packages.
// Runs on the US VPS. A client (openai-cli, a Shortcut, the WoW addon, ...) sends
// its request here with a gateway TOKEN; the gateway swaps in the REAL provider
// key and forwards to the provider, streaming the answer straight back. No VPN
// needed on the client side — it just talks HTTPS to this box.
//
// Run (keys/token come from the environment, never hard-coded):
//   GW_TOKENS="app1token,app2token" \
//   OPENAI_API_KEY="sk-..." ANTHROPIC_API_KEY="sk-ant-..." \
//   GW_TLS_CERT=/etc/gw/fullchain.pem GW_TLS_KEY=/etc/gw/key.pem \
//   node gateway/server.mjs
import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'

const PORT = Number(process.env.GW_PORT) || 8443

// Allowed client tokens (comma-separated). One per app → each revocable alone.
// Keep them long and random; membership check is enough for high-entropy tokens.
const TOKENS = new Set(
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

const send = (res, code, text) => {
  res.writeHead(code, { 'content-type': 'text/plain' })
  res.end(text)
}

// The bare token from "Authorization: Bearer <token>", or '' if absent.
const bearer = (req) => {
  const h = req.headers['authorization'] || ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const handle = async (req, res) => {
  // 1. Auth first — without a known token this is an open relay (credit theft).
  if (!TOKENS.has(bearer(req))) return send(res, 401, 'unauthorized')

  // 2. Route by the first path segment: /openai/... or /anthropic/...
  const url = new URL(req.url, 'http://x')
  const [, provider, ...rest] = url.pathname.split('/')
  const up = UPSTREAMS[provider]
  if (!up) return send(res, 404, 'unknown provider')

  // 3. Forward to the real provider with the REAL key swapped in (token dropped).
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
    return send(res, 502, 'upstream unreachable')
  }

  // 4. Stream the answer straight back (SSE included, no buffering).
  const out = {}
  const ct = upstream.headers.get('content-type')
  if (ct) out['content-type'] = ct
  res.writeHead(upstream.status, out)
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
  else res.end()
}

const tls = {
  cert: readFileSync(process.env.GW_TLS_CERT),
  key: readFileSync(process.env.GW_TLS_KEY),
}

createServer(tls, (req, res) => {
  handle(req, res).catch(() => send(res, 500, 'gateway error'))
}).listen(PORT, () => {
  console.log(`gateway on :${PORT} — providers: ${Object.keys(UPSTREAMS).join(', ')}`)
})
