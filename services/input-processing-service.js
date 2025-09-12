import { databaseCommandService } from './database-command-service.js'
import { logger } from '../utils/logger.js'
import { getClipboardContent } from '../utils/clipboard-content.js'
import { sanitizeString } from '../utils/validation.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { color } from '../config/color.js'

/**
 * Input Processing Service - handles ALL user input preprocessing
 */
function createInputProcessingService() {
  // Private state with closures
  let initialized = false
  const stats = {
    clipboardInsertions: 0,
  }

  async function initialize() {
    if (initialized) return

    try {
      // DatabaseCommandService is already initialized as singleton
      initialized = true
      logger.debug('InputProcessingService: Initialized')
    } catch (error) {
      logger.error('InputProcessingService: Failed to initialize:', error)
      throw error
    }
  }

  /**
   * Process clipboard markers in input - MAIN ENTRY POINT
   */
  async function processInput(input) {
    try {
      // Process clipboard markers and return clean input
      return await processClipboardMarkers(input)
    } catch (error) {
      logger.error('InputProcessingService: Input processing failed:', error)
      throw error
    }
  }

  /**
   * Process clipboard markers in input
   */
  async function processClipboardMarkers(input) {
    if (!input.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      return input
    }

    try {
      const clipboardContent = await getClipboardContent()
      const sanitizedContent = sanitizeString(clipboardContent)

      // Validate clipboard content length (no hardcode!)
      if (sanitizedContent.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
        throw new Error(
          `Clipboard content too large (${sanitizedContent.length} chars, max ${APP_CONSTANTS.MAX_INPUT_LENGTH})`,
        )
      }

      // Replace clipboard markers
      const processedInput = input.replaceAll(APP_CONSTANTS.CLIPBOARD_MARKER, sanitizedContent)

      // Update stats
      stats.clipboardInsertions++

      logger.debug(
        `InputProcessingService: Clipboard content inserted: ${sanitizedContent.length} chars`,
      )
      console.log(
        `${color.grey}[Clipboard content inserted (${sanitizedContent.length} chars)]${color.reset}`,
      )

      return processedInput
    } catch (error) {
      throw new Error(`Clipboard processing failed: ${error.message}`)
    }
  }

  /**
   * Find instruction command in database
   */
  async function findInstructionCommand(prompt) {
    const commands = databaseCommandService.getCommands()

    if (!commands) return null

    const trimmedInput = prompt.trim()

    // Check if input is just a command key without content (e.g., "gg" alone)
    if (databaseCommandService.hasCommand(trimmedInput)) {
      return {
        error: `Command "${trimmedInput}" requires additional input.`,
        isInvalid: true,
      }
    }

    // Search for matching command
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
              hasUrl: hasUrl(userInput),
              description: command.description,
            }
          }
        }
      }
    }

    return null
  }

  /**
   * Check if string contains URL
   */
  function hasUrl(str) {
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

  // Return public interface
  return {
    initialize,
    processInput,
    findInstructionCommand,
    hasUrl,
    get initialized() {
      return initialized
    },
  }
}

// Single Source of Truth - only singleton needed
export const inputProcessingService = createInputProcessingService()
