import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { USER_CONFIG } from '../../config/constants.js'

// Local half of saved sessions: one JSON file per session under
// ~/.openai-cli/sessions/. Files are machine-managed records (updatedAt is the
// LWW arbiter for sync) — never meant for hand-editing. The synced payload IS
// the file content, so local and remote representations stay identical.

export const SYNC_STATE_FILE = 'sync-state.json'

export const sessionsDir = () =>
  path.join(os.homedir(), USER_CONFIG.DIR_NAME, USER_CONFIG.SESSIONS_DIR)

const sessionPath = (id) => path.join(sessionsDir(), `${id}.json`)

export const createSessionRecord = ({
  title,
  provider,
  model,
  kind,
  lastResponseId,
  messages,
}) => {
  const now = Date.now()
  return {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    provider,
    model,
    kind,
    lastResponseId: lastResponseId || null,
    messages,
  }
}

export const writeSession = (session) => {
  fs.mkdirSync(sessionsDir(), { recursive: true })
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), {
    mode: 0o600,
  })
  return session
}

export const readSession = (id) => {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(id), 'utf8'))
  } catch (e) {
    return null
  }
}

// Session metas (no messages), newest first.
export const listSessions = () => {
  let files = []
  try {
    files = fs.readdirSync(sessionsDir())
  } catch (e) {
    return []
  }
  const sessions = []
  for (const file of files) {
    if (!file.endsWith('.json') || file === SYNC_STATE_FILE) continue
    const session = readSession(file.slice(0, -'.json'.length))
    if (!session || !session.id) continue
    sessions.push({
      id: session.id,
      title: session.title,
      kind: session.kind,
      provider: session.provider,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const removeSession = (id) => {
  try {
    fs.unlinkSync(sessionPath(id))
    return true
  } catch (e) {
    return false
  }
}
