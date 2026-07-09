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

      // Step 1: password → the gateway emails a one-time code (no session yet).
      let loginRes
      try {
        loginRes = await fetch(`${url}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      } catch (e) {
        return 'Login failed: cannot reach the gateway.'
      }
      if (loginRes.status === 401) return 'Login failed: incorrect email or password.'
      if (loginRes.status === 429) return 'Login failed: too many attempts, try again later.'
      if (!loginRes.ok) return 'Login failed: gateway error.'

      // A 2FA gateway replies { otpRequired: true } and emails a code; an older
      // gateway returns the session directly. Handle both (no version coupling).
      let step1
      try {
        step1 = await loginRes.json()
      } catch (e) {
        step1 = {}
      }

      let data = step1
      if (!step1 || typeof step1.session !== 'string') {
        // Step 2: exchange the emailed code for a session.
        const code = await promptLine(`We emailed a code to ${email}. Enter it: `)
        let verifyRes
        try {
          verifyRes = await fetch(`${url}/auth/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, code: code.trim() }),
          })
        } catch (e) {
          return 'Login failed: cannot reach the gateway.'
        }
        if (verifyRes.status === 400 || verifyRes.status === 401) {
          return 'Login failed: incorrect or expired code.'
        }
        if (verifyRes.status === 429) return 'Login failed: too many attempts, try again later.'
        if (!verifyRes.ok) return 'Login failed: gateway error.'
        try {
          data = await verifyRes.json()
        } catch (e) {
          return 'Login failed: unexpected gateway response.'
        }
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
    const { removed, urlKept } = clearGateway()
    if (!removed) return 'You were not logged in.'
    return urlKept
      ? 'Logged out — session revoked. The gateway address is kept, so next time just run: ai login'
      : 'Logged out — session revoked; providers connect directly again.'
  },
}
