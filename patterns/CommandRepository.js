/**
 * CommandRepository - Repository Pattern for command data access
 * Provides a clean abstraction layer over database operations for commands
 * Follows Repository Pattern with domain-specific interface
 */
import { databaseCommandService } from '../services/DatabaseCommandService.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../utils/error-handler.js'

/**
 * Command entity structure
 */

/**
 * Search criteria for command queries
 */

export class CommandRepository {
  constructor() {
    this.db = databaseCommandService
    this.cache = new Map()
    this.cacheEnabled = true
    this.cacheExpiry = 30 * 1000 // 30 seconds for better development workflow
    this.stats = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    }
  }

  /**
   * Get all commands with optional filtering and caching




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
          return includeStats
            ? { commands: cached.data, stats: this.getStats() }
            : cached.data
        } else {
          this.cache.delete(cacheKey)
        }
      }

      this.stats.cacheMisses++

      // Fetch from database
      const commands = this.db.getCommands()

      // Transform and validate
      const transformedCommands = this.transformCommands(commands)

      // Cache the result
      if (useCache) {
        this.cache.set(cacheKey, {
          data: transformedCommands,
          timestamp: Date.now(),
        })
        logger.debug(
          `CommandRepository: Cached ${Object.keys(transformedCommands).length} commands`,
        )
      }

      logger.debug(
        `CommandRepository: Retrieved ${Object.keys(transformedCommands).length} commands`,
      )

      return includeStats
        ? { commands: transformedCommands, stats: this.getStats() }
        : transformedCommands
    } catch (error) {
      this.stats.errors++
      logger.error(
        `CommandRepository: Failed to get all commands: ${error.message}`,
      )
      throw new AppError(
        `Failed to retrieve commands: ${error.message}`,
        false,
        500,
      )
    }
  }

  /**
   * Find command by ID



   */
  async findById(id, options = {}) {
    const { useCache = this.cacheEnabled } = options

    if (!id || typeof id !== 'string') {
      throw new AppError('Command ID must be a non-empty string', true, 400)
    }

    this.stats.totalQueries++

    try {
      const command = this.db.findById(id)

      if (!command) {
        logger.debug(`CommandRepository: Command not found: ${id}`)
        return null
      }

      const transformed = this.transformCommand(command, id)
      logger.debug(`CommandRepository: Found command: ${id}`)

      return transformed
    } catch (error) {
      this.stats.errors++
      logger.error(
        `CommandRepository: Failed to find command ${id}: ${error.message}`,
      )
      throw new AppError(`Failed to find command: ${error.message}`, false, 500)
    }
  }

  /**
   * Find command by keyword/alias



   */
  async findByKeyword(keyword, options = {}) {
    const { exactMatch = true, useCache = this.cacheEnabled } = options

    if (!keyword || typeof keyword !== 'string') {
      throw new AppError('Keyword must be a non-empty string', true, 400)
    }

    this.stats.totalQueries++

    try {
      const commands = await this.getAllCommands({ useCache })

      for (const [id, command] of Object.entries(commands)) {
        if (this.matchesKeyword(command.key, keyword, exactMatch)) {
          logger.debug(
            `CommandRepository: Found command by keyword '${keyword}': ${id}`,
          )
          return { id, ...command }
        }
      }

      logger.debug(
        `CommandRepository: No command found for keyword: ${keyword}`,
      )
      return null
    } catch (error) {
      this.stats.errors++
      logger.error(
        `CommandRepository: Failed to find command by keyword '${keyword}': ${error.message}`,
      )
      throw new AppError(
        `Failed to search commands: ${error.message}`,
        false,
        500,
      )
    }
  }

  /**
   * Search commands with advanced criteria


   */
  async search(criteria = {}) {
    const {
      keyword,
      type,
      isTranslation,
      hasMultipleModels,
      limit = 50,
    } = criteria

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
          const hasMulti =
            command.models &&
            Array.isArray(command.models) &&
            command.models.length > 1
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

      logger.debug(
        `CommandRepository: Search returned ${results.length} results`,
      )
      return results
    } catch (error) {
      this.stats.errors++
      logger.error(`CommandRepository: Search failed: ${error.message}`)
      throw new AppError(
        `Failed to search commands: ${error.message}`,
        false,
        500,
      )
    }
  }

  /**
   * Get translation commands only

   */
  // async getTranslationCommands() {
  //   return await this.search({ isTranslation: true })
  // }

  /**
   * Get multi-model commands only

   */
  async getMultiModelCommands() {
    return await this.search({ hasMultipleModels: true })
  }

  /**
   * Save or update a command



   */
  async save(id, commandData) {
    try {
      this.db.saveCommand(id, commandData)

      // Invalidate cache for hot-reload
      this.clearCache()

      logger.info(
        `CommandRepository: Saved command: ${id} - cache invalidated for hot-reload`,
      )
      return true
    } catch (error) {
      this.stats.errors++
      logger.error(
        `CommandRepository: Failed to save command ${id}: ${error.message}`,
      )
      throw new AppError(`Failed to save command: ${error.message}`, false, 500)
    }
  }

  /**
   * Delete a command


   */
  async delete(id) {
    if (!id || typeof id !== 'string') {
      throw new AppError('Command ID must be a non-empty string', true, 400)
    }

    try {
      this.db.deleteCommand(id)

      // Invalidate cache for hot-reload
      this.clearCache()

      logger.info(
        `CommandRepository: Deleted command: ${id} - cache invalidated for hot-reload`,
      )
      return true
    } catch (error) {
      this.stats.errors++
      logger.error(
        `CommandRepository: Failed to delete command ${id}: ${error.message}`,
      )
      throw new AppError(
        `Failed to delete command: ${error.message}`,
        false,
        500,
      )
    }
  }

  /**
   * Bulk migrate commands from instructions format


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
      throw new AppError(
        `Failed to migrate commands: ${error.message}`,
        false,
        500,
      )
    }
  }

  /**
   * Get repository statistics

   */
  getStats() {
    const cacheHitRate =
      this.stats.totalQueries > 0
        ? (this.stats.cacheHits / this.stats.totalQueries) * 100
        : 0

    return {
      totalQueries: this.stats.totalQueries,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      errors: this.stats.errors,
      cacheSize: this.cache.size,
      cacheEnabled: this.cacheEnabled,
    }
  }

  /**
   * Clear repository cache
   */
  clearCache() {
    const cacheSize = this.cache.size
    this.cache.clear()
    logger.info(
      `CommandRepository: Cache cleared (${cacheSize} entries removed) - ensuring hot-reload`,
    )
  }

  /**
   * Force refresh all commands from database (bypass cache)

   */
  async forceRefresh() {
    logger.info('CommandRepository: Force refresh - bypassing cache completely')
    return await this.getAllCommands({ useCache: false })
  }

  /**
   * Enable or disable caching

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
   */
  transformCommand(command, id) {
    return {
      name: command.name,
      key: command.key,
      description: command.description,
      instruction: command.instruction,
      models: command.models,
      isCached: command.isCached,
    }
  }

  /**
   * Check if keyword matches command keys
   */
  matchesKeyword(keys, keyword, exactMatch = false) {
    if (!Array.isArray(keys)) {
      return false
    }

    return keys.some((key) => {
      return exactMatch
        ? key.toLowerCase() === keyword.toLowerCase()
        : key.toLowerCase().includes(keyword.toLowerCase())
    })
  }

  /**
   * Check if command matches type pattern
   */
  matchesType(commandId, type) {
    const typePatterns = {
      // translation: /^(RUSSIAN|ENGLISH|CHINESE|PINYIN|TRANSCRIPTION|HSK)/i,
      system: /^(HELP|PROVIDER|MODEL|EXIT|CMD)/i,
      document: /^(DOC)/i,
    }

    const pattern = typePatterns[type.toLowerCase()]
    return pattern ? pattern.test(commandId) : false
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
