import { databaseCommandService } from './DatabaseCommandService.js'
import { logger } from '../utils/logger.js'
import { getClipboardContent } from '../utils/index.js'
import { sanitizeString } from '../utils/validation.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { color } from '../config/color.js'

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
    this.stats = {
      clipboardInsertions: 0
    }
  }

  async initialize() {
    if (this.initialized) return
    
    try {
      // DatabaseCommandService is already initialized as singleton
      this.initialized = true
      this.logger.debug('InputProcessingService initialized')
    } catch (error) {
      this.logger.error('Failed to initialize InputProcessingService:', error)
      throw error
    }
  }

  /**
   * Process clipboard markers in input - MAIN ENTRY POINT
   */
  async processInput(input) {
    try {
      // 1. Process clipboard markers first
      const processedInput = await this.processClipboardMarkers(input)
      
      // Return only the processed string - Router doesn't need metadata
      return processedInput
    } catch (error) {
      this.logger.error('Input processing failed:', error)
      throw error
    }
  }

  /**
   * Process clipboard markers in input
   */
  async processClipboardMarkers(input) {
    if (!input.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      return input
    }

    try {
      const clipboardContent = await getClipboardContent()
      const sanitizedContent = sanitizeString(clipboardContent)
      
      // Validate clipboard content length
      const maxLength = APP_CONSTANTS.MAX_INPUT_LENGTH || 10000
      if (sanitizedContent.length > maxLength) {
        throw new Error(`Clipboard content too large (${sanitizedContent.length} chars, max ${maxLength})`)
      }
      
      // Replace clipboard markers
      const processedInput = input.replace(
        new RegExp(APP_CONSTANTS.CLIPBOARD_MARKER.replace(/\$/g, '\\$'), 'g'),
        sanitizedContent
      )
      
      // Update stats
      this.stats.clipboardInsertions++
      
      this.logger.debug(`Clipboard content inserted: ${sanitizedContent.length} chars`)
      console.log(`${color.grey}[Clipboard content inserted (${sanitizedContent.length} chars)]${color.reset}`)
      
      return processedInput
    } catch (error) {
      throw new Error(`Clipboard processing failed: ${error.message}`)
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
    this.initialized = false
    this.stats = { clipboardInsertions: 0 }
    this.logger.debug('InputProcessingService disposed')
  }
}