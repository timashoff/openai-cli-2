// In-memory sliding-window rate limiter per key (IP). Each endpoint
// group gets its own instance and budget. Injectable clock keeps the
// window math testable; the GC interval bounds the map under abuse.
// Lifted verbatim from hsk-vocabulary backend/src/kit/rate-limit.js.

const DEFAULT_GC_INTERVAL_MS = 5 * 60 * 1000

export const createRateLimiter = (
  { windowMs, max, gcIntervalMs = DEFAULT_GC_INTERVAL_MS },
  now = () => Date.now(),
) => {
  const state = new Map()

  const isLimited = (key) => {
    if (typeof key !== 'string' || key.length === 0) return false
    const since = now() - windowMs
    const window = state.get(key) || []
    const fresh = []
    for (const ts of window) {
      if (ts > since) fresh.push(ts)
    }
    if (fresh.length >= max) {
      state.set(key, fresh)
      return true
    }
    fresh.push(now())
    state.set(key, fresh)
    return false
  }

  const gc = () => {
    const since = now() - windowMs
    for (const [key, window] of state) {
      let hasFresh = false
      for (const ts of window) {
        if (ts > since) {
          hasFresh = true
          break
        }
      }
      if (!hasFresh) state.delete(key)
    }
  }

  setInterval(gc, gcIntervalMs).unref()

  return { isLimited }
}
