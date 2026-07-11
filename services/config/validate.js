import { PROVIDERS, PROVIDER_API } from '../../config/providers.js'

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim() !== ''

// Accept only http(s) URLs for baseURL (a gateway or a custom endpoint).
const isHttpUrl = (value) => {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch (e) {
    return false
  }
}

// Per-field validators for a [providers.<id>] overlay section. Each returns
// { value } (accepted) or { error } (rejected, collected as a warning).
// baseURL repoints a provider at a gateway; token is the credential the gateway
// checks (the real API key then lives on the gateway, not the client).
// api picks the completion endpoint (escape hatch: api = 'chat' reverts a
// Responses-routed provider to chat/completions).
const fieldValidators = {
  baseURL: (value) =>
    isNonEmptyString(value) && isHttpUrl(value)
      ? { value }
      : { error: '"baseURL" must be an http(s) URL' },
  token: (value) =>
    isNonEmptyString(value)
      ? { value }
      : { error: '"token" must be a non-empty string' },
  api: (value) =>
    Object.values(PROVIDER_API).includes(value)
      ? { value }
      : { error: `"api" must be one of: ${Object.values(PROVIDER_API).join(', ')}` },
}

const knownFields = new Set(Object.keys(fieldValidators))

// Validate a parsed config table. Returns { overlay, errors }.
// overlay: { providerId: { baseURL?, token?, api? } } — only recognized, valid fields survive.
// errors: array of human-readable messages (all problems collected, not just the first).
export const validateUserConfig = (parsed) => {
  const errors = []
  const overlay = {}

  const table = parsed && parsed.providers ? parsed.providers : {}

  for (const [id, raw] of Object.entries(table)) {
    const where = `[providers.${id}]`

    if (!PROVIDERS[id]) {
      errors.push(
        `${where}: unknown provider (known: ${Object.keys(PROVIDERS).join(', ')})`,
      )
      continue
    }
    if (!raw || typeof raw !== 'object') {
      errors.push(`${where}: expected a table of settings`)
      continue
    }

    const clean = {}
    for (const [field, validate] of Object.entries(fieldValidators)) {
      if (raw[field] === undefined) continue
      const { value, error } = validate(raw[field])
      if (error) {
        errors.push(`${where}: ${error}`)
        continue
      }
      clean[field] = value
    }

    // Flag typos (e.g. "baseUrl") instead of silently ignoring them.
    for (const field of Object.keys(raw)) {
      if (!knownFields.has(field)) {
        errors.push(`${where}: unknown setting "${field}" (ignored)`)
      }
    }

    if (Object.keys(clean).length > 0) overlay[id] = clean
  }

  return { overlay, errors }
}
