import { resolveGateway, storedGatewayMeta, storedGatewayUrl } from '../../services/config/gateway.js'

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

// `ai whoami` — login status AND the gateway address, as a ready-to-paste
// `ai login <url>` line to set up another device. The address stays visible even
// after logout (it is kept), so this is how you "recall" the gateway URL.
export const WhoamiCommand = {
  async execute() {
    const gw = resolveGateway()
    if (!gw) {
      const url = storedGatewayUrl()
      return url
        ? `Not logged in — but the gateway address is remembered:\n  ai login ${url}`
        : 'Not logged in. Run: ai login <gateway-url>'
    }

    const host = hostOf(gw.url)
    const meta = storedGatewayMeta()
    const transfer = `\nOn another device: ai login ${gw.url}`

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
      return `Configured for ${host}${who}${until ? `, session until ${until}` : ''} (offline — could not verify).${transfer}`
    }

    const email = (live && live.email) || meta.email || 'unknown'
    const until = asDate((live && live.expiresAt) || meta.expiresAt)
    return `Logged in as ${email} — gateway ${host}${until ? `, session valid until ${until}` : ''}.${transfer}`
  },
}
