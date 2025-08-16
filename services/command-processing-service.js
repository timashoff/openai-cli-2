import { getCommandsFromDB } from '../utils/database-manager.js'
import { logger } from '../utils/logger.js'

/**
 * Service for command processing and routing
 * Handles both instruction commands and system commands
 */
export class CommandProcessingService {
  constructor(dependencies = {}) {
    this.logger = dependencies.logger || logger
    this.app = dependencies.app
    this.initialized = false
    this.instructionsCache = null
    this.lastCacheUpdate = 0
    this.cacheTimeout = 30000 // 30 seconds
  }

  async initialize() {
    if (this.initialized) return
    
    try {
      await this.refreshInstructionsCache()
      this.initialized = true
      this.logger.debug('CommandProcessingService initialized')
    } catch (error) {
      this.logger.error('Failed to initialize CommandProcessingService:', error)
      throw error
    }
  }

  async refreshInstructionsCache() {
    try {
      this.instructionsCache = getCommandsFromDB()
      this.lastCacheUpdate = Date.now()
      this.logger.debug(`Loaded ${Object.keys(this.instructionsCache).length} instructions from database`)
    } catch (error) {
      this.logger.error('Failed to load instructions from database:', error)
      this.instructionsCache = {}
    }
  }

  /**
   * Find instruction command from input
   * @param {string} input - User input
   * @returns {Object|null} Command information or null
   */
  async findInstructionCommand(input) {
    // Refresh cache if needed
    if (Date.now() - this.lastCacheUpdate > this.cacheTimeout) {
      await this.refreshInstructionsCache()
    }

    if (!this.instructionsCache) return null

    for (const [id, command] of Object.entries(this.instructionsCache)) {
      for (const key of command.key) {
        if (input.startsWith(key + ' ')) {
          const targetContent = input.substring(key.length + 1).trim()
          if (targetContent) {
            return {
              id,
              commandKey: key,
              instruction: command.instruction,
              fullInstruction: `${command.instruction}: ${targetContent}`,
              targetContent,
              originalInput: input,
              isTranslation: this.isTranslationCommand(key),
              isMultiProvider: this.isMultiProviderCommand(command),
              isMultiCommand: this.isMultiModelCommand(command),
              models: command.models || null,
              hasUrl: /https?:\/\//.test(targetContent),
              description: command.description || ''
            }
          }
        }
      }
    }

    return null
  }

  /**
   * Find system command from input
   * @param {string} input - User input
   * @returns {Object|null} System command information or null
   */
  findSystemCommand(input) {
    const words = input.trim().split(' ')
    const firstWord = words[0].toLowerCase()

    for (const [id, sysCommand] of Object.entries(SYS_INSTRUCTIONS)) {
      if (sysCommand.key.includes(firstWord)) {
        return {
          id,
          name: firstWord,
          args: words.slice(1),
          description: sysCommand.description,
          type: 'system'
        }
      }
    }

    return null
  }

  /**
   * Universal command finder that checks both instruction and system commands
   * @param {string} input - User input
   * @returns {Object|null} Command information or null
   */
  async findCommand(input) {
    // First check for instruction commands
    const instructionCommand = await this.findInstructionCommand(input)
    if (instructionCommand) {
      return { ...instructionCommand, type: 'instruction' }
    }

    // Then check for system commands
    const systemCommand = this.findSystemCommand(input)
    if (systemCommand) {
      return systemCommand
    }

    return null
  }

  /**
   * Check if command is translation-related
   * @private
   */
  isTranslationCommand(key) {
    const translationKeys = ['aa', 'аа', 'rr', 'cc', 'сс', 'kg', 'bb']
    return translationKeys.includes(key)
  }

  /**
   * Check if command should use multiple providers
   * @private
   */
  isMultiProviderCommand(command) {
    // Legacy multi-provider logic - can be enhanced
    return command.multiProvider === true
  }

  /**
   * Check if command should use multiple models
   * @private
   */
  isMultiModelCommand(command) {
    return command.models && Array.isArray(command.models) && command.models.length > 1
  }

  /**
   * Get all available instruction commands
   * @returns {Object} All instruction commands
   */
  async getAllInstructionCommands() {
    if (Date.now() - this.lastCacheUpdate > this.cacheTimeout) {
      await this.refreshInstructionsCache()
    }
    return this.instructionsCache || {}
  }

  /**
   * Get all available system commands
   * @returns {Object} All system commands
   */
  getAllSystemCommands() {
    return SYS_INSTRUCTIONS
  }

  /**
   * Get statistics about commands
   * @returns {Object} Command statistics
   */
  getCommandStats() {
    const instructionCommands = Object.keys(this.instructionsCache || {}).length
    const systemCommands = Object.keys(SYS_INSTRUCTIONS).length
    
    return {
      instructionCommands,
      systemCommands,
      totalCommands: instructionCommands + systemCommands,
      cacheLastUpdated: new Date(this.lastCacheUpdate),
      cacheAge: Date.now() - this.lastCacheUpdate
    }
  }

  /**
   * Get service health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      initialized: this.initialized,
      hasInstructionsCache: !!this.instructionsCache,
      cacheAge: Date.now() - this.lastCacheUpdate,
      cacheValid: (Date.now() - this.lastCacheUpdate) < this.cacheTimeout,
      isHealthy: this.initialized && !!this.instructionsCache
    }
  }

  /**
   * Dispose of service resources
   */
  dispose() {
    this.instructionsCache = null
    this.initialized = false
    this.logger.debug('CommandProcessingService disposed')
  }
}