// Gateway admin CLI — run on the VPS by the owner over SSH. Provisions and
// manages the single (or few) accounts. Passwords are read via a hidden TTY
// prompt, NEVER via argv (argv is visible in `ps`).
//
//   node admin.mjs adduser <email>
//   node admin.mjs passwd  <email>
//   node admin.mjs revoke  <email>
//   node admin.mjs list

import { homedir } from 'node:os'
import { openDb } from './db.mjs'
import { createUsersRepo } from './users-repo.mjs'
import { createSessionsRepo } from './sessions-repo.mjs'
import { createPasswordHasher } from './kit/passwords.mjs'
import { normalizeEmail } from './kit/email.mjs'
import { promptLine, promptHidden } from './prompt-hidden.mjs'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

const DB_PATH = process.env.GW_DB || `${homedir()}/gateway/auth.db`
const TTL_DAYS = Number(process.env.GW_SESSION_TTL_DAYS) || 90

const db = openDb(DB_PATH)
const users = createUsersRepo(db)
const sessions = createSessionsRepo(db, { ttlSeconds: TTL_DAYS * 86400 })
const hasher = createPasswordHasher()
const now = () => Math.floor(Date.now() / 1000)

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const requireEmail = (raw) => {
  const email = normalizeEmail(raw || '')
  if (!email) fail('invalid email')
  return email
}

const readNewPassword = async () => {
  const first = await promptHidden(`New password (${PASSWORD_MIN}-${PASSWORD_MAX} chars): `)
  if (first.length < PASSWORD_MIN || first.length > PASSWORD_MAX) {
    fail(`password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`)
  }
  const second = await promptHidden('Repeat password: ')
  if (first !== second) fail('passwords do not match')
  return first
}

const commands = {
  adduser: async (arg) => {
    const email = arg ? requireEmail(arg) : requireEmail(await promptLine('Email: '))
    if (users.findByEmail(email)) fail(`user already exists: ${email} (use passwd)`)
    const password = await readNewPassword()
    const { hash, salt } = await hasher.hashPassword(password)
    const { created } = users.create({ email, passHash: hash, passSalt: salt, now: now() })
    console.log(created ? `created ${email}` : `could not create ${email}`)
  },

  passwd: async (arg) => {
    const email = arg ? requireEmail(arg) : requireEmail(await promptLine('Email: '))
    const user = users.findByEmail(email)
    if (!user) fail(`no such user: ${email}`)
    const password = await readNewPassword()
    const { hash, salt } = await hasher.hashPassword(password)
    users.updatePassword({ email, passHash: hash, passSalt: salt })
    // A password change revokes every existing session for that user.
    sessions.deleteAllForUser(user.id)
    console.log(`password updated for ${email}; all sessions revoked`)
  },

  revoke: async (arg) => {
    const email = arg ? requireEmail(arg) : requireEmail(await promptLine('Email: '))
    const user = users.findByEmail(email)
    if (!user) fail(`no such user: ${email}`)
    const info = sessions.deleteAllForUser(user.id)
    console.log(`revoked ${info.changes} session(s) for ${email}`)
  },

  list: async () => {
    const rows = users.list()
    if (rows.length === 0) {
      console.log('no users')
      return
    }
    for (const user of rows) {
      const created = new Date(user.created_at * 1000).toISOString().slice(0, 10)
      console.log(`${user.email}  sessions=${sessions.countForUser(user.id)}  created=${created}`)
    }
  },
}

const run = async () => {
  const [command, arg] = process.argv.slice(2)
  const handler = commands[command]
  if (!handler) fail('usage: node admin.mjs <adduser|passwd|revoke|list> [email]')
  await handler(arg)
}

run()
  .then(() => {
    db.close()
    process.exit(0)
  })
  .catch((error) => {
    console.error('error:', error && error.message ? error.message : String(error))
    process.exit(1)
  })
