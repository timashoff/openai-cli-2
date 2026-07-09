import { resolveGateway, storedGatewayMeta } from '../../services/config/gateway.js'

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch (e) {
    return url
  }
}

// Unix seconds -> YYYY-MM-DD, or null if absent/invalid.
const asDate = (unix) => {
  if (!unix) return null
  try {
    return new Date(unix * 1000).toISOString().slice(0, 10)
  } catch (e) {
    return null
  }
}

// `ai whoami` — is a gateway configured, am I logged in, and is the session still
// valid? Does a live check against the gateway; falls back to stored info offline.
export const WhoamiCommand = {
  async execute() {
    const gw = resolveGateway()
    if (!gw) return 'Not logged in. Run: ai login <gateway-url>'

    const host = hostOf(gw.url)
    const meta = storedGatewayMeta()

    let live
    try {
      const response = await fetch(`${gw.url}/auth/whoami`, {
        headers: { authorization: `Bearer ${gw.token}` },
      })
      if (response.status === 401) return `Session expired for ${host}. Run: ai login`
      if (!response.ok) return `Gateway ${host}: unexpected response (${response.status}).`
      live = await response.json()
    } catch (e) {
      const who = meta.email ? ` as ${meta.email}` : ''
      const until = asDate(meta.expiresAt)
      return `Configured for ${host}${who}${until ? `, session until ${until}` : ''} (offline — could not verify).`
    }

    const email = (live && live.email) || meta.email || 'unknown'
    const until = asDate((live && live.expiresAt) || meta.expiresAt)
    return `Logged in as ${email} — gateway ${host}${until ? `, session valid until ${until}` : ''}.`
  },
}
