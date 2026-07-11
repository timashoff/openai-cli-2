import fs from 'node:fs'
import path from 'node:path'
import { resolveGateway } from '../config/gateway.js'
import { logger } from '../../utils/logger.js'
import { SESSIONS } from '../../config/constants.js'
import {
  SYNC_STATE_FILE,
  sessionsDir,
  listSessions,
  readSession,
  writeSession,
  removeSession,
} from './store.js'

// Client half of the sessions sync — same delta-sync substrate as commands
// (LWW by last_edited_at + monotonic server_version cursor), but per-record:
// kind='sessions', rowKey=<session id>, payload=<the whole session object>.
// Deletions travel as tombstones (deleted:true rows); the sidecar remembers
// local tombstones until they are pushed. Own cursor: independent consumers
// of the shared /sync stream each filter their kind.

const KIND = 'sessions'

const statePath = () => path.join(sessionsDir(), SYNC_STATE_FILE)

const readState = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    return {
      cursor: Number(parsed.cursor) || 0,
      pushed: parsed.pushed && typeof parsed.pushed === 'object' ? parsed.pushed : {},
      deleted: parsed.deleted && typeof parsed.deleted === 'object' ? parsed.deleted : {},
    }
  } catch (e) {
    return { cursor: 0, pushed: {}, deleted: {} }
  }
}

const writeState = (state) => {
  try {
    fs.mkdirSync(sessionsDir(), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(state), { mode: 0o600 })
  } catch (e) {
    // sync state is a cache; failing to persist it only costs a redundant pull next time
  }
}

const gwFetch = async (gw, pathAndQuery, init) => {
  const response = await fetch(`${gw.url}${pathAndQuery}`, {
    ...init,
    headers: { authorization: `Bearer ${gw.token}`, ...(init ? init.headers : {}) },
  })
  return response
}

// Record a local deletion; the tombstone is pushed on the next sync.
export const markSessionDeleted = (id) => {
  const state = readState()
  state.deleted[id] = Date.now()
  writeState(state)
}

const collectChanges = (state) => {
  const changes = []
  const skipped = []
  for (const meta of listSessions()) {
    if ((state.pushed[meta.id] || 0) >= meta.updatedAt) continue
    const session = readSession(meta.id)
    if (!session) continue
    const payload = JSON.stringify(session)
    if (payload.length > SESSIONS.MAX_ROW_BYTES) {
      skipped.push(meta.title)
      logger.warn(
        `Sessions sync: "${meta.title}" exceeds the per-row size guard (${payload.length} bytes) — kept local only`,
      )
      continue
    }
    changes.push({
      kind: KIND,
      rowKey: meta.id,
      payload: session,
      lastEditedAt: meta.updatedAt,
    })
  }
  for (const [id, deletedAt] of Object.entries(state.deleted)) {
    if ((state.pushed[id] || 0) >= deletedAt) continue
    changes.push({
      kind: KIND,
      rowKey: id,
      payload: {},
      lastEditedAt: deletedAt,
      deleted: true,
    })
  }
  return { changes, skipped }
}

const pushChanges = async (gw, state, changes) => {
  const response = await gwFetch(gw, '/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes }),
  })
  if (!response.ok) return { ok: false, status: response.status }
  // Applied or beaten by a newer remote edit — either way this edit is settled;
  // a losing push will be corrected by the pull that follows.
  for (const change of changes) {
    state.pushed[change.rowKey] = change.lastEditedAt
  }
  return { ok: true, count: changes.length }
}

const pullDeltas = async (gw, state) => {
  let since = state.cursor
  let pulled = 0
  let guard = 0
  while (guard < 50) {
    guard++
    const response = await gwFetch(gw, `/sync?since=${since}`)
    if (!response.ok) return { ok: false, status: response.status }
    const data = await response.json()
    for (const row of data.rows || []) {
      if (row.kind !== KIND) continue
      const local = readSession(row.rowKey)
      const localEditedAt = local ? local.updatedAt : 0
      if (row.deleted) {
        if (local && localEditedAt <= row.lastEditedAt) {
          removeSession(row.rowKey)
          pulled++
        }
        state.deleted[row.rowKey] = row.lastEditedAt
        state.pushed[row.rowKey] = row.lastEditedAt
      } else if (row.payload && row.payload.id === row.rowKey) {
        if (localEditedAt < row.lastEditedAt) {
          writeSession(row.payload)
          pulled++
        }
        state.pushed[row.rowKey] = Math.max(state.pushed[row.rowKey] || 0, row.lastEditedAt)
        // A live remote row newer than our tombstone wins under LWW
        if ((state.deleted[row.rowKey] || 0) < row.lastEditedAt) {
          delete state.deleted[row.rowKey]
        }
      }
    }
    since = data.cursor
    if (!data.hasMore) break
  }
  state.cursor = since
  return { ok: true, pulled }
}

// Bidirectional sync used on login, REPL start, and after `save`: push local
// edits/tombstones (LWW), then pull newer rows from the account.
export const syncSessions = async () => {
  const gw = resolveGateway()
  if (!gw) return { ok: false, error: 'not logged in' }
  const state = readState()

  const { changes, skipped } = collectChanges(state)
  let pushed = 0
  if (changes.length > 0) {
    const push = await pushChanges(gw, state, changes)
    if (!push.ok) {
      return { ok: false, error: push.status === 401 ? 'session expired' : 'gateway error' }
    }
    pushed = push.count
  }

  const pull = await pullDeltas(gw, state)
  if (!pull.ok) {
    writeState(state)
    return { ok: false, error: pull.status === 401 ? 'session expired' : 'gateway error' }
  }

  writeState(state)
  return { ok: true, pushed, pulled: pull.pulled, skipped }
}
