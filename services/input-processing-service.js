import { databaseCommandService } from './DatabaseCommandService.js'
import { logger } from '../utils/logger.js'

/**
 * Service for input processing - handles ALL user input processing
 * Single Source of Truth for: clipboard, flags, command detection, content creation
 */
export class InputProcessingService {
  constructor(dependencies = {}) {
    this.logger = dependencies.logger || logger
    this.app = dependencies.app
    this.initialized = false
    this.databaseCommandService = databaseCommandService
  }

  async initialize() {
    if (this.initialized) return
    
    try {
      // DatabaseCommandService is already initialized as singleton
      this.initialized = true
      this.logger.debug('CommandProcessingService initialized')
    } catch (error) {
      this.logger.error('Failed to initialize CommandProcessingService:', error)
      throw error
    }
  }

  async findInstructionCommand(prompt) {
    const commands = this.databaseCommandService.getCommands()

    if (!commands) return null

    const trimmedInput = prompt.trim()
    
    // Check if input is just a command key without content (e.g., "aa" alone)
    if (this.databaseCommandService.hasCommand(trimmedInput)) {
      return {
        error: `Command "${trimmedInput}" requires additional input.`,
        isInvalid: true
      }
    }

    for (const [id, command] of Object.entries(commands)) {
      for (const key of command.key) {
        if (prompt.startsWith(key + ' ')) {
          const userInput = prompt.substring(key.length + 1).trim()
          if (userInput) {
            return {
              id,
              commandKey: key,
              instruction: command.instruction,
              content: `${command.instruction}: ${userInput}`,
              userInput,
              models: command.models,
              hasUrl: this.hasUrl(userInput),
              description: command.description,
              isCached: command.isCached // CRITICAL FIX - was missing!
            }
          }
        }
      }
    }

    return null
  }

  /**
   * Find system command from input
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
   * Check if string contains URL
   */
  hasUrl(str) {
    return str
      .split(' ')
      .filter(Boolean)
      .some((word) => {
        try {
          new URL(word)
          return true
        } catch {
          return false
        }
      })
  }

  /**
   * Get all available instruction commands
   */
  async getAllInstructionCommands() {
    if (Date.now() - this.lastCacheUpdate > this.cacheTimeout) {
      await this.refreshInstructionsCache()
    }
    return this.instructionsCache || {}
  }

  /**
   * Get all available system commands
   */
  getAllSystemCommands() {
    return SYS_INSTRUCTIONS
  }

  /**
   * Get statistics about commands
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