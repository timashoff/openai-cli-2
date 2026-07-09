// Minimal structural email check, no regex. The email is purely a login
// identifier — exactly one '@', non-empty local part, dotted domain, no
// spaces. Length bounds are enforced by the caller.
// Lifted verbatim from hsk-vocabulary backend/src/kit/email.js.

export const normalizeEmail = (raw) => {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (email.includes(' ')) return null

  const at = email.indexOf('@')
  if (at <= 0) return null
  if (email.indexOf('@', at + 1) !== -1) return null

  const domain = email.substring(at + 1)
  const dot = domain.indexOf('.')
  if (dot <= 0 || dot === domain.length - 1) return null

  return email
}
