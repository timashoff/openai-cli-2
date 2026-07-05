import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { serializeCommands } from './toml-writer.js'

// Build a readable lowercase slug from latin letters and digits only (no regex).
const slugify = (text) => {
  const lower = String(text).toLowerCase()
  let out = ''
  for (const ch of lower) {
    const isDigit = ch >= '0' && ch <= '9'
    const isLatin = ch >= 'a' && ch <= 'z'
    if (isDigit || isLatin) out += ch
  }
  return out
}

// Read legacy sqlite commands into { slug: command }, skipping excluded ids/names.
export const readLegacyCommands = (dbPath, exclude = []) => {
  const db = new DatabaseSync(dbPath)
  const rows = db.prepare('SELECT * FROM commands ORDER BY id').all()
  db.close()

  const excludeSet = new Set(exclude)
  const usedSlugs = new Set()
  const commands = {}

  for (const row of rows) {
    if (excludeSet.has(row.name) || excludeSet.has(row.id)) continue

    const base = slugify(row.name) || slugify(row.id) || 'command'
    let slug = base
    let n = 2
    while (usedSlugs.has(slug)) {
      slug = `${base}${n}`
      n += 1
    }
    usedSlugs.add(slug)

    commands[slug] = {
      key: JSON.parse(row.key),
      description: row.description || '',
      instruction: row.instruction || '',
      models: JSON.parse(row.models || '[]'),
      context: false,
    }
  }

  return commands
}

// One-time migration: legacy db -> commands.toml, then rename the db to *.bak.
// Never overwrites an existing commands.toml. Returns a report object.
export const migrateIfNeeded = ({ dbPath, tomlPath, backupPath, exclude = [] }) => {
  if (fs.existsSync(tomlPath)) {
    return { migrated: false, reason: 'commands.toml already exists' }
  }
  if (!fs.existsSync(dbPath)) {
    return { migrated: false, reason: 'no legacy database to migrate' }
  }

  const commands = readLegacyCommands(dbPath, exclude)
  const toml = serializeCommands(commands)

  fs.mkdirSync(path.dirname(tomlPath), { recursive: true })
  fs.writeFileSync(tomlPath, toml, 'utf8')

  const backup = backupPath || dbPath + '.bak'
  fs.renameSync(dbPath, backup)

  return {
    migrated: true,
    commandCount: Object.keys(commands).length,
    tomlPath,
    backup,
  }
}
