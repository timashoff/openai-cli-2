import { storedGatewayUrl, stripTrailingSlash } from '../../services/config/gateway.js'
import { promptLine, promptHidden } from './terminal-input.js'

// Password bounds mirror the gateway's (client-side pre-check only — the
// gateway revalidates; kept local so the CLI never imports server code).
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

// `ai reset [gateway-url]` — self-service "forgot password": the gateway emails
// a one-time code; the code plus a new password reset the account. The gateway
// revokes every session, so each device logs in again with the new password.
// Context is optional so this runs both headless (`ai reset`) and in the REPL.
export const ResetCommand = {
  async execute(args = [], context = null) {
    const url = stripTrailingSlash((args[0] || '').trim() || storedGatewayUrl())
    if (!url) {
      return 'Usage: ai reset <gateway-url>   (the url is needed only if none is stored)'
    }
    if (!process.stdin.isTTY) {
      return 'Run "ai reset" in an interactive terminal (email + code prompt).'
    }

    const hasUi = Boolean(context && context.ui)
    if (hasUi) context.ui.pauseReadline()
    try {
      const email = await promptLine('Email: ')

      // Step 1: ask the gateway to email a reset code (always 202 — the reply
      // never reveals whether the account exists).
      let requestRes
      try {
        requestRes = await fetch(`${url}/auth/request-reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        })
      } catch (e) {
        return 'Reset failed: cannot reach the gateway.'
      }
      if (requestRes.status === 429) return 'Reset failed: too many attempts, try again later.'
      if (requestRes.status !== 202) return 'Reset failed: gateway error.'

      const code = await promptLine(
        `If an account exists for ${email}, a reset code was emailed. Enter it: `,
      )
      const newPassword = await promptHidden(`New password (${PASSWORD_MIN}-${PASSWORD_MAX} chars): `)
      if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
        return `Reset failed: the password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`
      }
      const repeat = await promptHidden('Repeat new password: ')
      if (newPassword !== repeat) return 'Reset failed: passwords do not match.'

      // Step 2: exchange the emailed code + new password for the reset.
      let resetRes
      try {
        resetRes = await fetch(`${url}/auth/reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, code: code.trim(), newPassword }),
        })
      } catch (e) {
        return 'Reset failed: cannot reach the gateway.'
      }
      if (resetRes.status === 400) return 'Reset failed: incorrect or expired code.'
      if (resetRes.status === 429) return 'Reset failed: too many attempts, try again later.'
      if (!resetRes.ok) return 'Reset failed: gateway error.'

      return 'Password reset — every session was revoked. Log in with the new password: ai login'
    } finally {
      if (hasUi) context.ui.resumeReadline()
    }
  },
}
