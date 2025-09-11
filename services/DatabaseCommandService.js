import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { logger } from '../utils/logger.js'

const dbPath = path.join(import.meta.dirname, '../db/commands.db')

// Database schema - Single Source of Truth
const COMMANDS_SCHEMA = {
  tableName: 'commands',
  fields: {
    id: 'TEXT PRIMARY KEY',
    name: 'TEXT NOT NULL',
    key: 'TEXT NOT NULL',
    description: 'TEXT NOT NULL',
    instruction: 'TEXT NOT NULL',
    models: "TEXT DEFAULT '[]'",
    created_at: "INTEGER DEFAULT (strftime('%s', 'now'))",
    updated_at: "INTEGER DEFAULT NULL",
  },
}

function createDatabaseCommandService() {
  // Private state with closures
  let db = null
  let commandsCache = null
  const stats = {
    cacheHits: 0,
    cacheMisses: 0,
    totalQueries: 0,
    lastRefresh: null,
  }

  function initDatabase() {
    try {
      db = new DatabaseSync(dbPath)
      createTables()
      logger.debug('DatabaseCommandService: SQLite database initialized')
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error.message}`)
    }
  }

  function createTables() {
    const fieldDefinitions = Object.entries(COMMANDS_SCHEMA.fields)
      .map(([fieldName, fieldType]) => `${fieldName} ${fieldType}`)
      .join(',\n ')

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${COMMANDS_SCHEMA.tableName} (
        ${fieldDefinitions}
      )
    `

    db.exec(createTableSQL)
  }

  // Initialize immediately
  initDatabase()
  logger.debug('DatabaseCommandService: Initialized with SQLite database')

  function getCommands() {
    stats.totalQueries++

    if (commandsCache) {
      stats.cacheHits++
      logger.debug('DatabaseCommandService: Cache hit')
      return commandsCache
    }

    refreshCache()
    stats.cacheMisses++
    logger.debug('DatabaseCommandService: Cache miss, refreshed')

    return commandsCache
  }

  function findByKey(key) {
    const commands = getCommands()

    for (const [commandId, command] of Object.entries(commands)) {
      if (command.key && command.key.includes(key)) {
        logger.debug(
          `DatabaseCommandService: Found command for key "${key}" -> ${commandId}`,
        )
        return {
          id: commandId,
          ...command,
        }
      }
    }

    logger.debug(`DatabaseCommandService: No command found for key "${key}"`)
    return null
  }

  function findById(commandId) {
    const commands = getCommands()

    if (commands[commandId]) {
      return {
        id: commandId,
        ...commands[commandId],
      }
    }

    return null
  }

  function getAllKeys() {
    const commands = getCommands()
    const keys = []

    for (const command of Object.values(commands)) {
      if (command.key && Array.isArray(command.key)) {
        keys.push(...command.key)
      }
    }

    return [...new Set(keys)]
  }

  function hasCommand(key) {
    return findByKey(key) !== null
  }


  function getCommandsFromDB() {
    const selectQuery = db.prepare(
      `SELECT * FROM ${COMMANDS_SCHEMA.tableName} ORDER BY id`,
    )
    const rows = selectQuery.all()

    const commands = {}

    for (const row of rows) {
      commands[row.id] = {
        name: row.name,
        key: JSON.parse(row.key),
        description: row.description,
        instruction: row.instruction,
        models: JSON.parse(row.models),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }
    }

    return commands
  }

  function refreshCache() {
    try {
      commandsCache = getCommandsFromDB()
      stats.lastRefresh = new Date()

      const commandCount = Object.keys(commandsCache).length
      logger.debug(
        `DatabaseCommandService: Cache refreshed with ${commandCount} commands`,
      )
    } catch (error) {
      logger.error('DatabaseCommandService: Failed to refresh cache:', error)

      if (!commandsCache) {
        commandsCache = {}
      }
    }
  }

  function getStats() {
    return {
      ...stats,
      cacheSize: commandsCache ? Object.keys(commandsCache).length : 0,
      cacheValid: commandsCache !== null,
    }
  }

  function saveCommand(id, commandData) {
    const { name, key, description, instruction, models } = commandData

    const keyJson = JSON.stringify(key)
    const modelsJson = JSON.stringify(models)
    const currentTimestamp = Math.floor(Date.now() / 1000)

    // Generate ALL fields from schema - ZERO hardcode!
    const allFields = Object.keys(COMMANDS_SCHEMA.fields)
    const allPlaceholders = allFields.map(() => '?').join(', ')
    
    // For UPDATE: all fields except id and created_at
    const updateFields = allFields.filter(field => field !== 'id' && field !== 'created_at')
    const updateClause = updateFields.map(field => `${field} = excluded.${field}`).join(', ')

    // SQLite UPSERT - single query handles both INSERT and UPDATE
    const upsertQuery = db.prepare(`
      INSERT INTO ${COMMANDS_SCHEMA.tableName} (${allFields.join(', ')})
      VALUES (${allPlaceholders})
      ON CONFLICT(id) DO UPDATE SET 
        ${updateClause},
        updated_at = ?
    `)

    // Map values to schema fields - ZERO hardcode!
    const fieldValues = {
      id,
      name,
      key: keyJson,
      description,
      instruction,
      models: modelsJson,
      created_at: currentTimestamp,
      updated_at: null
    }

    // Generate parameters in schema field order
    const insertParams = allFields.map(field => fieldValues[field])
    
    // Additional parameter for UPDATE updated_at
    const updateTimestamp = currentTimestamp

    upsertQuery.run(...insertParams, updateTimestamp)

    commandsCache = null

    logger.debug(`DatabaseCommandService: Saved command ${id}`)
  }

  function deleteCommand(id) {
    const deleteQuery = db.prepare(
      `DELETE FROM ${COMMANDS_SCHEMA.tableName} WHERE id = ?`,
    )
    const changes = deleteQuery.run(id)

    if (changes.changes > 0) {
      logger.debug(`DatabaseCommandService: Deleted command ${id}`)
    } else {
      logger.warn(
        `DatabaseCommandService: Command ${id} not found for deletion`,
      )
    }
  }

  function close() {
    if (db) {
      db.close()
      db = null
      logger.debug('DatabaseCommandService: Database connection closed')
    }
  }


  // Return public interface
  return {
    getCommands,
    findByKey,
    findById,
    getAllKeys,
    hasCommand,
    getCommandsFromDB,
    refreshCache,
    getStats,
    saveCommand,
    deleteCommand,
    close,
  }
}

// Single Source of Truth - only singleton needed
export const databaseCommandService = createDatabaseCommandService()
