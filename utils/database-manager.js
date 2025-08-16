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
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        description TEXT NOT NULL,
        instruction TEXT NOT NULL,
        models TEXT DEFAULT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `
    
    this.db.exec(createTableSQL)
    
    // Add models column to existing table if it doesn't exist
    try {
      this.db.exec('ALTER TABLE commands ADD COLUMN models TEXT DEFAULT NULL')
    } catch (error) {
      // Column might already exist, ignore error
      if (!error.message.includes('duplicate column name')) {
        throw error
      }
    }
    
    // Add name column to existing table if it doesn't exist
    try {
      this.db.exec('ALTER TABLE commands ADD COLUMN name TEXT DEFAULT NULL')
    } catch (error) {
      // Column might already exist, ignore error
      if (!error.message.includes('duplicate column name')) {
        throw error
      }
    }
  }

  getCommandsFromDB() {
    const stmt = this.db.prepare('SELECT * FROM commands ORDER BY id')
    const rows = stmt.all()
    
    // Convert to object format with stable IDs as keys
    const commands = {}
    for (const row of rows) {
      commands[row.id] = {
        name: row.name || row.id,
        key: JSON.parse(row.key),
        description: row.description,
        instruction: row.instruction,
        models: row.models ? JSON.parse(row.models) : null
      }
    }
    
    return commands
  }

  getCommand(id) {
    const stmt = this.db.prepare('SELECT * FROM commands WHERE id = ?')
    const row = stmt.get(id)
    
    if (!row) return null
    
    return {
      name: row.name || row.id,
      key: JSON.parse(row.key),
      description: row.description,
      instruction: row.instruction,
      models: row.models ? JSON.parse(row.models) : null
    }
  }

  saveCommand(id, name, key, description, instruction, models = null) {
    const keyJson = JSON.stringify(key)
    const modelsJson = models ? JSON.stringify(models) : null
    const now = Math.floor(Date.now() / 1000)
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO commands (id, name, key, description, instruction, models, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(id, name, keyJson, description, instruction, modelsJson, now)
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
        const name = command.name || id
        this.saveCommand(id, name, command.key, command.description, command.instruction, command.models || null)
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

/**
 * Get all commands from database in object format
 * @returns {Object} Object with command IDs as keys
 */
export function getCommandsFromDB() {
  const db = getDatabase()
  return db.getCommandsFromDB()
}