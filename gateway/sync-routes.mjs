// Delta-sync routes (mirrors hsk's /api/sync): both require a valid session, the
// caller passes the resolved user id.
//   GET  /sync?since=<cursor>  → rows with server_version > cursor + new cursor
//   POST /sync { changes: [...] } → LWW batch upsert, returns per-row results + cursor

import { API_ERRORS, sendApiError } from './kit/errors.mjs'
import { readJsonBody } from './http.mjs'

const MAX_PUSH_BYTES = 512 * 1024
const MAX_CHANGES = 2000

// Parse a non-negative integer cursor from the query without a regex.
const parseSince = (req) => {
  const url = new URL(req.url, 'http://x')
  const raw = url.searchParams.get('since') || '0'
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

export const createSyncRoutes = ({ repo }) => {
  const handlePull = async (req, res, userId) => {
    const { cursor, hasMore, rows } = repo.pullSince(userId, parseSince(req))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ cursor, hasMore, rows }))
  }

  const handlePush = async (req, res, userId) => {
    const body = await readJsonBody(req, MAX_PUSH_BYTES)
    const changes = body ? body.changes : null
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) {
      return sendApiError(res, API_ERRORS.INVALID_INPUT)
    }
    for (const change of changes) {
      if (
        !change ||
        typeof change.kind !== 'string' ||
        typeof change.rowKey !== 'string' ||
        change.payload === undefined ||
        change.payload === null
      ) {
        return sendApiError(res, API_ERRORS.INVALID_INPUT)
      }
    }
    const { cursor, results } = repo.push(userId, changes)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ cursor, results }))
  }

  return { handlePull, handlePush }
}
