// Users table access — synchronous prepared statements (node:sqlite DatabaseSync).
// Prepared once at construction and reused. The email is the login identifier;
// the password is stored only as a scrypt hash + salt (see kit/passwords.mjs).

export const createUsersRepo = (db) => {
  const byEmail = db.prepare(
    'SELECT id, email, pass_hash, pass_salt FROM users WHERE email = ?',
  )
  const insert = db.prepare(
    'INSERT INTO users(email, pass_hash, pass_salt, created_at, last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO NOTHING',
  )
  const updatePass = db.prepare(
    'UPDATE users SET pass_hash = ?, pass_salt = ? WHERE email = ?',
  )
  const touch = db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
  const listAll = db.prepare(
    'SELECT id, email, created_at, last_seen_at FROM users ORDER BY id',
  )

  return {
    findByEmail: (email) => byEmail.get(email),
    create: ({ email, passHash, passSalt, now }) => {
      const info = insert.run(email, passHash, passSalt, now, now)
      return { created: info.changes === 1 }
    },
    updatePassword: ({ email, passHash, passSalt }) => {
      const info = updatePass.run(passHash, passSalt, email)
      return { updated: info.changes === 1 }
    },
    touchLastSeen: (id, now) => touch.run(now, id),
    list: () => listAll.all(),
  }
}
