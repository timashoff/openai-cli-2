import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveGateway } from '../config/gateway.js'
import { commandsDir, commandsFilePath } from './paths.js'
import { commandService } from './index.js'

// Client half of the account commands sync — the delta-sync model ported from
// hsk-vocabulary's src/features/sync (LWW by last_edited_at + a monotonic
// server_version cursor). One synced document: kind='commands', rowKey='default',
// payload={ toml }. Local sync state (cursor + last-synced edit-time + content hash)
// lives in a sidecar so a re-pull never fights the file's mtime.

const KIND = 'commands'
const ROW_KEY = 'default'

const statePath = () => path.join(commandsDir(), 'sync-state.json')

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

const countSections = (toml) => {
  const needle = '[commands.'
  let count = 0
  let index = toml.indexOf(needle)
  while (index !== -1) {
    count++
    index = toml.indexOf(needle, index + needle.length)
  }
  return count
}

const readState = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    return {
      cursor: Number(parsed.cursor) || 0,
      editedAt: Number(parsed.editedAt) || 0,
      hash: typeof parsed.hash === 'string' ? parsed.hash : '',
    }
  } catch (e) {
    return { cursor: 0, editedAt: 0, hash: '' }
  }
}

const writeState = (state) => {
  try {
    fs.mkdirSync(commandsDir(), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(state), { mode: 0o600 })
  } catch (e) {
    // sync state is a cache; failing to persist it only costs a redundant pull next time
  }
}

// Local commands.toml text + its mtime (ms), or nulls if absent.
const readLocal = () => {
  const file = commandsFilePath()
  try {
    const text = fs.readFileSync(file, 'utf8')
    const mtime = fs.statSync(file).mtimeMs
    return { text, mtime }
  } catch (e) {
    return { text: null, mtime: 0 }
  }
}

const writeLocal = (text) => {
  const file = commandsFilePath()
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak')
  fs.writeFileSync(file, text, { mode: 0o644 })
}

const gwFetch = async (gw, pathAndQuery, init) => {
  const response = await fetch(`${gw.url}${pathAndQuery}`, {
    ...init,
    headers: { authorization: `Bearer ${gw.token}`, ...(init ? init.headers : {}) },
  })
  return response
}

const pushRow = async (gw, toml, editedAt) => {
  const response = await gwFetch(gw, '/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      changes: [{ kind: KIND, rowKey: ROW_KEY, payload: { toml }, lastEditedAt: editedAt }],
    }),
  })
  if (!response.ok) return { ok: false, status: response.status }
  const data = await response.json()
  const result = data.results && data.results[0] ? data.results[0] : {}
  return { ok: true, applied: result.applied === true }
}

// Pull deltas from the cursor, apply the commands row under LWW. Returns the found
// state so the caller can decide whether to seed.
const pullDeltas = async (gw, state) => {
  let since = state.cursor
  let pulled = false
  let accountHasCommands = false
  let guard = 0
  while (guard < 50) {
    guard++
    const response = await gwFetch(gw, `/sync?since=${since}`)
    if (response.status === 401) return { ok: false, status: 401 }
    if (!response.ok) return { ok: false, status: response.status }
    const data = await response.json()
    for (const row of data.rows || []) {
      if (row.kind !== KIND || row.rowKey !== ROW_KEY) continue
      accountHasCommands = true
      if (!row.deleted && row.payload && typeof row.payload.toml === 'string' && row.lastEditedAt > state.editedAt) {
        writeLocal(row.payload.toml)
        state.editedAt = row.lastEditedAt
        state.hash = sha256(row.payload.toml)
        pulled = true
      }
    }
    since = data.cursor
    if (!data.hasMore) break
  }
  state.cursor = since
  return { ok: true, pulled, accountHasCommands }
}

// Bidirectional sync used on login, REPL start, and after a cmd edit: pull newer,
// push local edits (LWW), seed the account from the first device.
export const syncCommands = async () => {
  const gw = resolveGateway()
  if (!gw) return { ok: false, error: 'not logged in' }
  const state = readState()
  const fresh = state.hash === ''
  const local = readLocal()

  // Established device with local edits → push first so LWW is fair; fresh device
  // pulls first so a default file never clobbers the account.
  let pushed = false
  const localHash = local.text !== null ? sha256(local.text) : ''
  const locallyEdited = !fresh && local.text !== null && localHash !== state.hash
  if (locallyEdited) {
    const r = await pushRow(gw, local.text, local.mtime)
    if (!r.ok) return { ok: false, error: r.status === 401 ? 'session expired' : 'gateway error' }
    if (r.applied) {
      state.editedAt = local.mtime
      state.hash = localHash
      pushed = true
    }
  }

  const pull = await pullDeltas(gw, state)
  if (!pull.ok) return { ok: false, error: pull.status === 401 ? 'session expired' : 'gateway error' }

  // First device ever: nothing on the account → seed it from local.
  if (fresh && !pull.accountHasCommands && local.text !== null) {
    const r = await pushRow(gw, local.text, local.mtime || Date.now())
    if (r.ok && r.applied) {
      state.editedAt = local.mtime || Date.now()
      state.hash = localHash
      pushed = true
    }
  }

  writeState(state)
  if (pull.pulled) commandService.reload()
  return { ok: true, pushed, pulled: pull.pulled }
}

// `cmd pull` — take the account's version, overwrite local (backed up).
export const forcePull = async () => {
  const gw = resolveGateway()
  if (!gw) return { ok: false, error: 'not logged in' }
  const state = { cursor: 0, editedAt: 0, hash: '' } // full re-read
  const pull = await pullDeltas(gw, state)
  if (!pull.ok) return { ok: false, error: pull.status === 401 ? 'session expired' : 'gateway error' }
  writeState(state)
  if (pull.pulled) commandService.reload()
  return { ok: true, pulled: pull.pulled, empty: !pull.accountHasCommands }
}

// `cmd push` — send local up as the winner.
export const forcePush = async () => {
  const gw = resolveGateway()
  if (!gw) return { ok: false, error: 'not logged in' }
  const local = readLocal()
  if (local.text === null) return { ok: false, error: 'no local commands file' }
  const editedAt = Date.now()
  const r = await pushRow(gw, local.text, editedAt)
  if (!r.ok) return { ok: false, error: r.status === 401 ? 'session expired' : 'gateway error' }
  const state = readState()
  // advance our cursor/baseline via a pull so we do not re-pull our own row as "new"
  state.editedAt = editedAt
  state.hash = sha256(local.text)
  await pullDeltas(gw, state)
  writeState(state)
  return { ok: true, applied: r.applied, count: countSections(local.text) }
}
