import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '../config/commands.db')

export class DatabaseManager {
  constructor() {
    this.db = null
    this.init()
  }

  init() {
    try {
      this.db = new DatabaseSync(dbPath)
      this.createTables()
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error.message}`)
    }
  }

  createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        description TEXT NOT NULL,
        instruction TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `
    
    this.db.exec(createTableSQL)
  }

  getAllCommands() {
    const stmt = this.db.prepare('SELECT * FROM commands ORDER BY id')
    const rows = stmt.all()
    
    // Convert to INSTRUCTIONS format
    const commands = {}
    for (const row of rows) {
      commands[row.id] = {
        key: JSON.parse(row.key),
        description: row.description,
        instruction: row.instruction
      }
    }
    
    return commands
  }

  getCommand(id) {
    const stmt = this.db.prepare('SELECT * FROM commands WHERE id = ?')
    const row = stmt.get(id)
    
    if (!row) return null
    
    return {
      key: JSON.parse(row.key),
      description: row.description,
      instruction: row.instruction
    }
  }

  saveCommand(id, key, description, instruction) {
    const keyJson = JSON.stringify(key)
    const now = Math.floor(Date.now() / 1000)
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO commands (id, key, description, instruction, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    
    stmt.run(id, keyJson, description, instruction, now)
  }

  deleteCommand(id) {
    const stmt = this.db.prepare('DELETE FROM commands WHERE id = ?')
    stmt.run(id)
  }

  migrateFromInstructions(instructions) {
    // Begin transaction
    this.db.exec('BEGIN TRANSACTION')
    
    try {
      // Clear existing commands
      this.db.exec('DELETE FROM commands')
      
      // Insert all instructions
      for (const [id, command] of Object.entries(instructions)) {
        this.saveCommand(id, command.key, command.description, command.instruction)
      }
      
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// Singleton instance
let dbInstance = null

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseManager()
  }
  return dbInstance
}