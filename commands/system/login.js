import {
  saveGateway,
  clearGateway,
  resolveGateway,
  storedGatewayUrl,
} from '../../services/config/gateway.js'
import { promptLine, promptHidden } from './terminal-input.js'
import { syncCommands } from '../../services/commands/sync.js'

// Drop trailing slashes without a regex (owner rule: avoid regex).
const stripTrailingSlash = (value) => {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
}

// `ai login [gateway-url]` — authenticate to the gateway with email + password
// and store the returned session. The url is needed only the first time; after
// that `ai login` reuses the stored url (re-auth / rotate). Context is optional
// so this runs both headless (`ai login`) and in the REPL.
export const LoginCommand = {
  async execute(args = [], context = null) {
    const url = stripTrailingSlash((args[0] || '').trim() || storedGatewayUrl())
    if (!url) {
      return 'Usage: ai login <gateway-url>   (the url is needed only the first time)'
    }
    if (!process.stdin.isTTY) {
      return 'Run "ai login" in an interactive terminal (email + password prompt).'
    }

    const hasUi = Boolean(context && context.ui)
    if (hasUi) context.ui.pauseReadline()
    try {
      const email = await promptLine('Email: ')
      const password = await promptHidden('Password: ')

      let response
      try {
        response = await fetch(`${url}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      } catch (e) {
        return 'Login failed: cannot reach the gateway.'
      }

      if (response.status === 401) return 'Login failed: incorrect email or password.'
      if (response.status === 429) return 'Login failed: too many attempts, try again later.'
      if (!response.ok) return 'Login failed: gateway error.'

      let data
      try {
        data = await response.json()
      } catch (e) {
        return 'Login failed: unexpected gateway response.'
      }
      if (!data || typeof data.session !== 'string') {
        return 'Login failed: unexpected gateway response.'
      }

      const saved = saveGateway({ token: data.session, url, email, expiresAt: data.expiresAt })
      if (saved.error) return `Login failed: ${saved.error}`

      // In the REPL, drop cached gateway clients so the next call uses the new session.
      if (context && context.providers && context.providers.evictGateway) {
        context.providers.evictGateway()
      }
      // Sync this account's commands to the device (or seed the account on the first device).
      const synced = await syncCommands()
      let syncNote = ''
      if (synced.ok && synced.pulled) syncNote = '\nSynced your commands from this account.'
      else if (synced.ok && synced.pushed) syncNote = '\nSeeded this account with your local commands.'
      return `Logged in — gateway ${saved.host}. openai and anthropic route through it; deepseek stays direct.${syncNote}`
    } finally {
      if (hasUi) context.ui.resumeReadline()
    }
  },
}

// `ai logout` — revoke the session on the gateway (best-effort) and remove it locally.
export const LogoutCommand = {
  async execute() {
    const gw = resolveGateway()
    if (gw) {
      try {
        await fetch(`${gw.url}/auth/logout`, {
          method: 'POST',
          headers: { authorization: `Bearer ${gw.token}` },
        })
      } catch (e) {
        // best-effort: local removal below is what matters
      }
    }
    const { removed } = clearGateway()
    return removed
      ? 'Logged out — gateway credentials removed; providers connect directly again.'
      : 'No stored gateway credentials to remove.'
  },
}
