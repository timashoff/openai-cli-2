/**
 * DatabaseCommandService - Single Source of Truth for database command access
 * 
 * ARCHITECTURAL RULE: This is the ONLY service allowed to import database-manager.js
 * All other classes must use this service through dependency injection
 * 
 * Uses event-based cache invalidation for hot-reload functionality
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { logger } from '../utils/logger.js'
import { emitStateEvent, STATE_EVENTS, stateObserver } from '../patterns/StateObserver.js'

const dbPath = path.join(import.meta.dirname, '../db/commands.db')

export class DatabaseCommandService {
  constructor() {
    // SQLite database
    this.db = null
    this.initDatabase()
    
    // Cache management (event-based, no timeouts needed)
    this.commandsCache = null
    
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      eventInvalidations: 0,
      totalQueries: 0,
      lastRefresh: null
    }
    
    // Subscribe to database change events for automatic cache invalidation
    this.setupEventListeners()
    
    logger.debug('DatabaseCommandService: Initialized with SQLite database and event-based hot-reload')
  }

  /**
   * Initialize SQLite database
   */
  initDatabase() {
    try {
      this.db = new DatabaseSync(dbPath)
      this.createTables()
      logger.debug('DatabaseCommandService: SQLite database initialized')
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error.message}`)
    }
  }

  /**
   * Create database tables with proper schema (no legacy bullshit)
   */
  createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        description TEXT NOT NULL,
        instruction TEXT NOT NULL,
        models TEXT DEFAULT '[]',
        is_cached BOOLEAN DEFAULT false,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `
    
    this.db.exec(createTableSQL)
    
    // Migrate models from string format to provider-model objects
    this.migrateModelsToProviderFormat()
  }
  
  /**
   * Migrate models from string format to provider-model objects
   */
  migrateModelsToProviderFormat() {
    try {
      logger.debug('DatabaseCommandService: Starting models migration to provider-model format')
      
      // Model-to-provider mapping based on config
      const MODEL_TO_PROVIDER_MAP = {
        'gpt-4': 'openai',
        'gpt-5-mini': 'openai', 
        'o4-mini': 'openai',
        'deepseek-chat': 'deepseek',
        'claude-3-5-sonnet-20241022': 'anthropic'
      }
      
      const commands = this.getCommandsFromDB()
      let migratedCount = 0
      
      for (const [commandId, command] of Object.entries(commands)) {
        let needsMigration = false
        let newModels = []
        
        // Handle null models - convert to empty array
        if (command.models === null) {
          newModels = []
          needsMigration = true
        }
        // Handle string array models - convert to provider-model objects
        else if (Array.isArray(command.models) && command.models.length > 0) {
          // Check if any models are strings (need migration)
          const hasStringModels = command.models.some(model => typeof model === 'string')
          
          if (hasStringModels) {
            newModels = command.models.map(model => {
              if (typeof model === 'string') {
                const provider = MODEL_TO_PROVIDER_MAP[model]
                if (provider) {
                  return { provider, model }
                } else {
                  logger.warn(`DatabaseCommandService: Unknown model "${model}" in command ${commandId}, skipping`)
                  return null
                }
              }
              // Already in correct format
              return model
            }).filter(model => model !== null)
            
            needsMigration = true
          }
        }
        
        // Apply migration if needed
        if (needsMigration) {
          this.saveCommand(commandId, {
            ...command,
            models: newModels
          })
          migratedCount++
          logger.debug(`DatabaseCommandService: Migrated command ${commandId}`)
        }
      }
      
      if (migratedCount > 0) {
        logger.info(`DatabaseCommandService: Migration completed - ${migratedCount} commands migrated to provider-model format`)
      } else {
        logger.debug('DatabaseCommandService: No commands needed migration')
      }
      
    } catch (error) {
      logger.error(`DatabaseCommandService: Migration failed: ${error.message}`)
    }
  }

  /**
   * Setup event listeners for automatic cache invalidation
   */
  setupEventListeners() {
    // Listen to all database command events using stateObserver directly
    stateObserver.eventBus.on(STATE_EVENTS.DATABASE_COMMAND_ADDED, () => {
      this.handleDatabaseEvent('command_added')
    })
    
    stateObserver.eventBus.on(STATE_EVENTS.DATABASE_COMMAND_UPDATED, () => {
      this.handleDatabaseEvent('command_updated') 
    })
    
    stateObserver.eventBus.on(STATE_EVENTS.DATABASE_COMMAND_DELETED, () => {
      this.handleDatabaseEvent('command_deleted')
    })
    
    stateObserver.eventBus.on(STATE_EVENTS.DATABASE_COMMANDS_CHANGED, () => {
      this.handleDatabaseEvent('commands_changed')
    })
    
    logger.debug('DatabaseCommandService: Event listeners registered')
  }

  /**
   * Handle database change events
   */
  handleDatabaseEvent(eventType) {
    logger.debug(`DatabaseCommandService: Database event received: ${eventType}`)
    this.invalidateCache()
    this.stats.eventInvalidations++
  }

  /**
   * Get all commands from database with event-based caching
   */
  getCommands() {
    this.stats.totalQueries++
    
    // Event-based cache: only refresh when null (invalidated by events)
    if (this.commandsCache) {
      this.stats.cacheHits++
      logger.debug('DatabaseCommandService: Cache hit')
      return this.commandsCache
    }
    
    // Refresh cache
    this.refreshCache()
    this.stats.cacheMisses++
    logger.debug('DatabaseCommandService: Cache miss, refreshed')
    
    return this.commandsCache
  }

  /**
   * Find command by key (e.g., "aa", "cc", "rr")
   */
  findByKey(key) {
    const commands = this.getCommands()
    
    for (const [commandId, command] of Object.entries(commands)) {
      if (command.key && command.key.includes(key)) {
        logger.debug(`DatabaseCommandService: Found command for key "${key}" -> ${commandId}`)
        return {
          id: commandId,
          ...command
        }
      }
    }
    
    logger.debug(`DatabaseCommandService: No command found for key "${key}"`)
    return null
  }

  /**
   * Find command by ID
   */
  findById(commandId) {
    const commands = this.getCommands()
    
    if (commands[commandId]) {
      return {
        id: commandId,
        ...commands[commandId]
      }
    }
    
    return null
  }

  /**
   * Get all command keys for autocomplete/suggestions
   */
  getAllKeys() {
    const commands = this.getCommands()
    const keys = []
    
    for (const command of Object.values(commands)) {
      if (command.key && Array.isArray(command.key)) {
        keys.push(...command.key)
      }
    }
    
    return [...new Set(keys)] // Remove duplicates
  }

  /**
   * Check if a command exists by key
   */
  hasCommand(key) {
    return this.findByKey(key) !== null
  }

  /**
   * Check if command has caching enabled
   */
  isCacheEnabled(key) {
    const command = this.findByKey(key)
    return command.isCached
  }

  /**
   * Get formatted help content for database commands
   */
  getHelpContent() {
    const commands = this.getCommands()
    
    if (!commands || Object.keys(commands).length === 0) {
      return 'No database commands available.'
    }
    
    let helpText = ''
    
    for (const [commandId, command] of Object.entries(commands)) {
      if (command.key && command.key.length > 0) {
        const keyText = Array.isArray(command.key) ? command.key.join(', ') : command.key
        const description = command.description || command.instruction || 'No description'
        const truncatedDesc = description.length > 60 ? 
          description.substring(0, 60) + '...' : description
        
        helpText += `  ${keyText.padEnd(12)} - ${truncatedDesc}\n`
      }
    }
    
    return helpText
  }

  /**
   * Get commands directly from SQLite database
   */
  getCommandsFromDB() {
    const stmt = this.db.prepare('SELECT * FROM commands ORDER BY id')
    const rows = stmt.all()
    
    const commands = {}
    
    for (const row of rows) {
      commands[row.id] = {
        name: row.name,
        key: JSON.parse(row.key), // NOT NULL, always exists
        description: row.description,
        instruction: row.instruction,
        models: JSON.parse(row.models), // DEFAULT '[]', always array
        isCached: Boolean(row.is_cached), // BOOLEAN from SQLite
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    }
    
    return commands
  }

  /**
   * Refresh commands cache from database
   */
  refreshCache() {
    try {
      // Read from SQLite and cache in memory for fast access
      this.commandsCache = this.getCommandsFromDB()
      this.stats.lastRefresh = new Date()
      
      const commandCount = Object.keys(this.commandsCache).length
      logger.debug(`DatabaseCommandService: Cache refreshed with ${commandCount} commands`)
      
    } catch (error) {
      logger.error('DatabaseCommandService: Failed to refresh cache:', error)
      
      // Fallback to empty object to prevent crashes
      if (!this.commandsCache) {
        this.commandsCache = {}
      }
    }
  }

  /**
   * Force cache refresh (manual invalidation)
   */
  invalidateCache() {
    logger.debug('DatabaseCommandService: Cache invalidated')
    this.commandsCache = null
  }

  /**
   * Emit database change event (used by database-manager)
   */
  static emitDatabaseEvent(eventType, metadata = {}) {
    const eventMap = {
      'added': STATE_EVENTS.DATABASE_COMMAND_ADDED,
      'updated': STATE_EVENTS.DATABASE_COMMAND_UPDATED,
      'deleted': STATE_EVENTS.DATABASE_COMMAND_DELETED,
      'changed': STATE_EVENTS.DATABASE_COMMANDS_CHANGED
    }
    
    const stateEvent = eventMap[eventType]
    if (stateEvent) {
      logger.debug(`DatabaseCommandService: Emitting database event: ${eventType}`, metadata)
      emitStateEvent(stateEvent, metadata)
    } else {
      logger.warn(`DatabaseCommandService: Unknown event type: ${eventType}`)
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.commandsCache ? Object.keys(this.commandsCache).length : 0,
      cacheValid: this.commandsCache !== null
    }
  }

  saveCommand(id, commandData) {
    const {
      name,
      key,
      description,
      instruction,
      models,
      isCached
    } = commandData
    
    const keyJson = JSON.stringify(key)
    const modelsJson = JSON.stringify(models)
    const now = Math.floor(Date.now() / 1000)
    
    // SQLite parameter binding requires integer for boolean fields
    const isCachedInt = isCached ? 1 : 0
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO commands (id, name, key, description, instruction, models, is_cached, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(id, name, keyJson, description, instruction, modelsJson, isCachedInt, now, now)
    
    // Invalidate cache after save
    this.commandsCache = null
    
    DatabaseCommandService.emitDatabaseEvent('changed', { commandId: id })
    logger.debug(`DatabaseCommandService: Saved command ${id}`)
  }

  /**
   * Delete command from database
   */
  deleteCommand(id) {
    const stmt = this.db.prepare('DELETE FROM commands WHERE id = ?')
    const changes = stmt.run(id)
    
    if (changes.changes > 0) {
      // Emit database change event
      DatabaseCommandService.emitDatabaseEvent('deleted', { commandId: id })
      logger.debug(`DatabaseCommandService: Deleted command ${id}`)
    } else {
      logger.warn(`DatabaseCommandService: Command ${id} not found for deletion`)
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close()
      this.db = null
      logger.debug('DatabaseCommandService: Database connection closed')
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    const stats = this.getStats()
    
    return {
      healthy: stats.cacheSize > 0,
      cacheSize: stats.cacheSize,
      cacheValid: stats.cacheValid,
      totalQueries: stats.totalQueries,
      eventInvalidations: stats.eventInvalidations,
      cacheHitRate: stats.totalQueries > 0 ? 
        (stats.cacheHits / stats.totalQueries * 100).toFixed(2) + '%' : '0%',
      lastRefresh: stats.lastRefresh,
      eventsActive: true
    }
  }
}

/**
 * Create and export singleton instance
 */
export const databaseCommandService = new DatabaseCommandService()

/**
 * Factory function for dependency injection
 */
export function createDatabaseCommandService() {
  return new DatabaseCommandService()
}

/**
 * Convenience function to emit database events
 * Used by database-manager and CommandEditor
 */
export function emitDatabaseCommandEvent(eventType, metadata = {}) {
  DatabaseCommandService.emitDatabaseEvent(eventType, metadata)
}