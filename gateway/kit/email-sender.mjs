// Transactional email via Resend's HTTPS API (POST /emails) over Node's built-in
// fetch — NO SMTP and NO SDK (no extra deps). Lifted verbatim from hsk-vocabulary
// backend/src/kit/email-sender.js. apiKey, from, and the User-Agent arrive via
// options. send() NEVER throws — it returns { ok, error } so a failed send
// degrades the flow (logged by the caller) without taking down the request.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_TIMEOUT_MS = 10 * 1000
const DEFAULT_USER_AGENT = 'email-sender'

export const createEmailSender = ({
  apiKey,
  from,
  endpoint = RESEND_ENDPOINT,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) => {
  const send = async ({ to, subject, html, text }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
        },
        body: JSON.stringify({ from, to, subject, html, text }),
        signal: controller.signal,
      })
      if (response.ok) return { ok: true, error: null }
      const detail = await response.text().catch(() => '')
      return { ok: false, error: `HTTP ${response.status}: ${detail.slice(0, 200)}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }
  return { send }
}

// Fallback when no API key is configured (local dev or a misconfigured deploy).
// In dev (logCode=true) it prints the rendered mail so the flow works offline; in
// production it logs ONLY that a send was suppressed — never the code. Boot never
// depends on a key: a missing key degrades email only, it does not crash the server.
export const createNoopEmailSender = ({ logCode = false, log = console } = {}) => {
  const send = async ({ to, subject, text }) => {
    if (logCode) {
      log.log(`[email-sender] no API key — dev log. to=${to} subject=${JSON.stringify(subject)}`)
      if (text) log.log(text)
    } else {
      log.log(`[email-sender] no API key — email to ${to} suppressed (set RESEND_API_KEY).`)
    }
    return { ok: true, error: null }
  }
  return { send }
}
