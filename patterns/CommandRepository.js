/**
 * CommandRepository - Repository Pattern for command data access
 * Provides a clean abstraction layer over database operations for commands
 * Follows Repository Pattern with domain-specific interface
 */
import { getDatabase } from '../utils/database-manager.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../utils/error-handler.js'

/**
 * Command entity structure
 * @typedef {Object} Command
 * @property {string} id - Unique command identifier
 * @property {string} name - Human-readable command name
 * @property {string[]} key - Array of command keywords/aliases
 * @property {string} description - Command description
 * @property {string} instruction - AI instruction template
 * @property {string[]|null} models - Array of model names for multi-model commands
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */

/**
 * Search criteria for command queries
 * @typedef {Object} CommandSearchCriteria
 * @property {string} keyword - Search by keyword/alias
 * @property {string} type - Filter by command type
 * @property {boolean} isTranslation - Filter translation commands
 * @property {boolean} hasMultipleModels - Filter multi-model commands
 * @property {number} limit - Maximum results to return
 */

export class CommandRepository {
  constructor() {
    this.db = getDatabase()
    this.cache = new Map()
    this.cacheEnabled = true
    this.cacheExpiry = 30 * 1000 // 30 seconds for better development workflow
    this.stats = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0
    }
  }

  /**
   * Get all commands with optional filtering and caching
   * @param {Object} options - Query options
   * @param {boolean} options.useCache - Whether to use cache
   * @param {boolean} options.includeStats - Include usage statistics
   * @returns {Promise<Object>} Commands object with IDs as keys
   */
  async getAllCommands(options = {}) {
    const { useCache = this.cacheEnabled, includeStats = false } = options
    const cacheKey = 'all_commands'
    
    this.stats.totalQueries++
    
    try {
      // Check cache first
      if (useCache && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          this.stats.cacheHits++
          logger.debug('CommandRepository: Cache hit for getAllCommands')
          return includeStats ? { commands: cached.data, stats: this.getStats() } : cached.data
        } else {
          this.cache.delete(cacheKey)
        }
      }
      
      this.stats.cacheMisses++
      
      // Fetch from database
      const commands = this.db.getCommandsFromDB()
      
      // Transform and validate
      const transformedCommands = this.transformCommands(commands)
      
      // Cache the result
      if (useCache) {
        this.cache.set(cacheKey, {
          data: transformedCommands,
          timestamp: Date.now()
        })
        logger.debug(`CommandRepository: Cached ${Object.keys(transformedCommands).length} commands`)
      }
      
      logger.debug(`CommandRepository: Retrieved ${Object.keys(transformedCommands).length} commands`)
      
      return includeStats ? { commands: transformedCommands, stats: this.getStats() } : transformedCommands
      
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Failed to get all commands: ${error.message}`)
      throw new AppError(`Failed to retrieve commands: ${error.message}`, false, 500)
    }
  }

  /**
   * Find command by ID
   * @param {string} id - Command ID
   * @param {Object} options - Query options
   * @returns {Promise<Command|null>} Command or null if not found
   */
  async findById(id, options = {}) {
    const { useCache = this.cacheEnabled } = options
    
    if (!id || typeof id !== 'string') {
      throw new AppError('Command ID must be a non-empty string', true, 400)
    }
    
    this.stats.totalQueries++
    
    try {
      const command = this.db.getCommand(id)
      
      if (!command) {
        logger.debug(`CommandRepository: Command not found: ${id}`)
        return null
      }
      
      const transformed = this.transformCommand(command, id)
      logger.debug(`CommandRepository: Found command: ${id}`)
      
      return transformed
      
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Failed to find command ${id}: ${error.message}`)
      throw new AppError(`Failed to find command: ${error.message}`, false, 500)
    }
  }

  /**
   * Find command by keyword/alias
   * @param {string} keyword - Keyword to search for
   * @param {Object} options - Search options
   * @returns {Promise<Command|null>} First matching command or null
   */
  async findByKeyword(keyword, options = {}) {
    const { exactMatch = false, useCache = this.cacheEnabled } = options
    
    if (!keyword || typeof keyword !== 'string') {
      throw new AppError('Keyword must be a non-empty string', true, 400)
    }
    
    this.stats.totalQueries++
    
    try {
      const commands = await this.getAllCommands({ useCache })
      
      for (const [id, command] of Object.entries(commands)) {
        if (this.matchesKeyword(command.key, keyword, exactMatch)) {
          logger.debug(`CommandRepository: Found command by keyword '${keyword}': ${id}`)
          return { id, ...command }
        }
      }
      
      logger.debug(`CommandRepository: No command found for keyword: ${keyword}`)
      return null
      
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Failed to find command by keyword '${keyword}': ${error.message}`)
      throw new AppError(`Failed to search commands: ${error.message}`, false, 500)
    }
  }

  /**
   * Search commands with advanced criteria
   * @param {CommandSearchCriteria} criteria - Search criteria
   * @returns {Promise<Command[]>} Array of matching commands
   */
  async search(criteria = {}) {
    const { keyword, type, isTranslation, hasMultipleModels, limit = 50 } = criteria
    
    this.stats.totalQueries++
    
    try {
      const commands = await this.getAllCommands()
      const results = []
      
      for (const [id, command] of Object.entries(commands)) {
        let matches = true
        
        // Filter by keyword
        if (keyword && !this.matchesKeyword(command.key, keyword, false)) {
          matches = false
        }
        
        // Filter by type (based on command ID patterns)
        if (type && !this.matchesType(id, type)) {
          matches = false
        }
        
        // Filter by translation commands
        if (isTranslation !== undefined) {
          const isTransCmd = this.isTranslationCommand(id)
          if (isTranslation !== isTransCmd) {
            matches = false
          }
        }
        
        // Filter by multi-model commands
        if (hasMultipleModels !== undefined) {
          const hasMulti = command.models && Array.isArray(command.models) && command.models.length > 1
          if (hasMultipleModels !== hasMulti) {
            matches = false
          }
        }
        
        if (matches) {
          results.push({ id, ...command })
          
          // Limit results
          if (results.length >= limit) {
            break
          }
        }
      }
      
      logger.debug(`CommandRepository: Search returned ${results.length} results`)
      return results
      
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Search failed: ${error.message}`)
      throw new AppError(`Failed to search commands: ${error.message}`, false, 500)
    }
  }

  /**
   * Get translation commands only
   * @returns {Promise<Command[]>} Array of translation commands
   */
  async getTranslationCommands() {
    return await this.search({ isTranslation: true })
  }

  /**
   * Get multi-model commands only
   * @returns {Promise<Command[]>} Array of multi-model commands
   */
  async getMultiModelCommands() {
    return await this.search({ hasMultipleModels: true })
  }

  /**
   * Save or update a command
   * @param {string} id - Command ID
   * @param {Object} commandData - Command data
   * @returns {Promise<boolean>} Success status
   */
  async save(id, commandData) {
    const { name, key, description, instruction, models = null } = commandData
    
    // Validate required fields
    if (!id || !name || !key || !description || !instruction) {
      throw new AppError('Missing required command fields', true, 400)
    }
    
    if (!Array.isArray(key) || key.length === 0) {
      throw new AppError('Command key must be a non-empty array', true, 400)
    }
    
    try {
      this.db.saveCommand(id, name, key, description, instruction, models)
      
      // Invalidate cache for hot-reload
      this.clearCache()
      
      logger.info(`CommandRepository: Saved command: ${id} - cache invalidated for hot-reload`)
      return true
      
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Failed to save command ${id}: ${error.message}`)
      throw new AppError(`Failed to save command: ${error.message}`, false, 500)
    }
  }

  /**
   * Delete a command
   * @param {string} id - Command ID
   * @returns {Promise<boolean>} Success status
   */
  async delete(id) {
    if (!id || typeof id !== 'string') {
      throw new AppError('Command ID must be a non-empty string', true, 400)
    }
    
    try {
      this.db.deleteCommand(id)
      
      // Invalidate cache for hot-reload
      this.clearCache()
      
      logger.info(`CommandRepository: Deleted command: ${id} - cache invalidated for hot-reload`)
      return true
      
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Failed to delete command ${id}: ${error.message}`)
      throw new AppError(`Failed to delete command: ${error.message}`, false, 500)
    }
  }

  /**
   * Bulk migrate commands from instructions format
   * @param {Object} instructions - Instructions object
   * @returns {Promise<number>} Number of migrated commands
   */
  async migrateFromInstructions(instructions) {
    if (!instructions || typeof instructions !== 'object') {
      throw new AppError('Instructions must be an object', true, 400)
    }
    
    try {
      this.db.migrateFromInstructions(instructions)
      
      // Clear cache after migration
      this.clearCache()
      
      const count = Object.keys(instructions).length
      logger.info(`CommandRepository: Migrated ${count} commands`)
      
      return count
      
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Migration failed: ${error.message}`)
      throw new AppError(`Failed to migrate commands: ${error.message}`, false, 500)
    }
  }

  /**
   * Get repository statistics
   * @returns {Object} Repository statistics
   */
  getStats() {
    const cacheHitRate = this.stats.totalQueries > 0 ? 
      (this.stats.cacheHits / this.stats.totalQueries) * 100 : 0
    
    return {
      totalQueries: this.stats.totalQueries,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      errors: this.stats.errors,
      cacheSize: this.cache.size,
      cacheEnabled: this.cacheEnabled
    }
  }

  /**
   * Clear repository cache
   */
  clearCache() {
    const cacheSize = this.cache.size
    this.cache.clear()
    logger.info(`CommandRepository: Cache cleared (${cacheSize} entries removed) - ensuring hot-reload`)
  }

  /**
   * Force refresh all commands from database (bypass cache)
   * @returns {Promise<Object>} Fresh commands from database
   */
  async forceRefresh() {
    logger.info('CommandRepository: Force refresh - bypassing cache completely')
    return await this.getAllCommands({ useCache: false })
  }

  /**
   * Enable or disable caching
   * @param {boolean} enabled - Cache enabled status
   */
  setCacheEnabled(enabled) {
    this.cacheEnabled = enabled
    if (!enabled) {
      this.clearCache()
    }
    logger.debug(`CommandRepository: Cache ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Transform database commands to domain objects
   * @private
   */
  transformCommands(commands) {
    const transformed = {}
    
    for (const [id, command] of Object.entries(commands)) {
      transformed[id] = this.transformCommand(command, id)
    }
    
    return transformed
  }

  /**
   * Transform single command to domain object
   * @private
   */
  transformCommand(command, id) {
    return {
      name: command.name || id,
      key: Array.isArray(command.key) ? command.key : [command.key],
      description: command.description || '',
      instruction: command.instruction || '',
      models: command.models || null
    }
  }

  /**
   * Check if keyword matches command keys
   * @private
   */
  matchesKeyword(keys, keyword, exactMatch = false) {
    if (!Array.isArray(keys)) {
      return false
    }
    
    return keys.some(key => {
      return exactMatch ? 
        key.toLowerCase() === keyword.toLowerCase() :
        key.toLowerCase().includes(keyword.toLowerCase())
    })
  }

  /**
   * Check if command matches type pattern
   * @private
   */
  matchesType(commandId, type) {
    const typePatterns = {
      translation: /^(RUSSIAN|ENGLISH|CHINESE|PINYIN|TRANSCRIPTION|HSK)/i,
      system: /^(HELP|PROVIDER|MODEL|EXIT|CMD)/i,
      document: /^(DOC)/i
    }
    
    const pattern = typePatterns[type.toLowerCase()]
    return pattern ? pattern.test(commandId) : false
  }

  /**
   * Check if command is a translation command
   * @private
   */
  isTranslationCommand(commandId) {
    const translationKeys = ['RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS']
    return translationKeys.includes(commandId)
  }

  /**
   * Close repository and cleanup resources
   */
  dispose() {
    this.clearCache()
    this.stats = { totalQueries: 0, cacheHits: 0, cacheMisses: 0, errors: 0 }
    logger.debug('CommandRepository: Disposed')
  }
}

// Singleton instance
let repositoryInstance = null

/**
 * Get singleton CommandRepository instance
 * @returns {CommandRepository} Repository instance
 */
export function getCommandRepository() {
  if (!repositoryInstance) {
    repositoryInstance = new CommandRepository()
  }
  return repositoryInstance
}

// Convenience functions for backward compatibility
export async function getAllCommands() {
  const repo = getCommandRepository()
  return await repo.getAllCommands()
}

export async function findCommandByKeyword(keyword) {
  const repo = getCommandRepository()
  return await repo.findByKeyword(keyword)
}

export async function findCommandById(id) {
  const repo = getCommandRepository()
  return await repo.findById(id)
}