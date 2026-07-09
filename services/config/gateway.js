import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'smol-toml'
import { configDir } from './paths.js'

// Gateway credentials: the ONE per-machine secret needed to reach the US gateway
// (endpoint URL + bearer token). Resolved from the environment first, then from a
// local credentials file written by `ai login`. This is the single source of truth
// for "is a gateway configured and how" — configService derives provider routing
// from it, so no machine ever hand-edits a routing file just to reach the gateway.
const ENV_URL = 'OPENAI_CLI_GATEWAY_URL'
const ENV_TOKEN = 'OPENAI_CLI_GATEWAY_TOKEN'

const credentialsPath = () => path.join(configDir(), 'credentials.toml')

// Drop trailing slashes without a regex (owner rule: avoid regex).
const stripTrailingSlash = (value) => {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
}

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch (e) {
    return url
  }
}

// Read the credentials file. A missing/unreadable/broken file is not an error —
// it just means "no stored gateway" (the machine may use env vars, or go direct).
const readStored = () => {
  try {
    const parsed = parse(fs.readFileSync(credentialsPath(), 'utf8'))
    const gw = parsed && parsed.gateway ? parsed.gateway : {}
    return { url: gw.url || '', token: gw.token || '' }
  } catch (e) {
    return { url: '', token: '' }
  }
}

// Effective gateway = env overrides stored file. Both url AND token are required
// to activate; otherwise returns null (providers then connect directly).
export const resolveGateway = () => {
  const stored = readStored()
  const url = (process.env[ENV_URL] || stored.url || '').trim()
  const token = (process.env[ENV_TOKEN] || stored.token || '').trim()
  if (url && token) return { url: stripTrailingSlash(url), token }
  return null
}

// The stored (or env) gateway URL alone — lets `ai login` reuse it without
// re-typing, so after first setup you re-authenticate with just `ai login`.
export const storedGatewayUrl = () => {
  const stored = readStored()
  return stripTrailingSlash((process.env[ENV_URL] || stored.url || '').trim())
}

// Persist gateway credentials (from `ai login`). The url is required the first
// time; afterwards a token-only call reuses the stored url (token rotation).
export const saveGateway = ({ token, url }) => {
  const cleanToken = (token || '').trim()
  if (!cleanToken) return { error: 'a gateway token is required' }

  const stored = readStored()
  const finalUrl = stripTrailingSlash((url || stored.url || '').trim())
  if (!finalUrl) {
    return { error: 'provide the gateway url the first time: ai login <url>' }
  }

  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })
  const header = '# openai-cli gateway credentials — written by "ai login". Secret; do not commit.\n'
  const body = header + stringify({ gateway: { url: finalUrl, token: cleanToken } }) + '\n'
  const file = credentialsPath()
  fs.writeFileSync(file, body, { mode: 0o600 })
  fs.chmodSync(file, 0o600) // enforce perms even if the file pre-existed
  return { host: hostOf(finalUrl) }
}

// Remove stored credentials (`ai logout`). Env vars, if any, still apply.
export const clearGateway = () => {
  try {
    fs.unlinkSync(credentialsPath())
    return { removed: true }
  } catch (e) {
    return { removed: false }
  }
}

// Human-readable state for the `config` command.
export const gatewayStatus = () => {
  const resolved = resolveGateway()
  if (!resolved) return { active: false, host: null, source: 'none' }
  const fromEnv = Boolean(process.env[ENV_URL] || process.env[ENV_TOKEN])
  return { active: true, host: hostOf(resolved.url), source: fromEnv ? 'env' : 'login' }
}
