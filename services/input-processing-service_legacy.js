import { getClipboardContent } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'

/**
 * Service for processing and sanitizing user input
 * Handles clipboard integration, flag parsing, and input validation
 */
export class InputProcessingService {
  constructor(dependencies = {}) {
    this.logger = dependencies.logger || logger
    this.initialized = false
    this.stats = {
      inputsProcessed: 0,
      clipboardInsertions: 0,
      flagsExtracted: 0,
      validationErrors: 0
    }
  }

  async initialize() {
    if (this.initialized) return
    
    this.initialized = true
    this.logger.debug('InputProcessingService initialized')
  }

  /**
   * Process user input with clipboard, flags, and validation


   */
  async processInput(rawInput) {
    this.stats.inputsProcessed++
    
    const result = {
      originalInput: rawInput,
      processedInput: rawInput,
      flags: {
        force: false,
        verbose: false,
        quiet: false
      },
      metadata: {
        hasClipboard: false,
        clipboardLength: 0,
        extractedFlags: []
      },
      errors: []
    }

    try {
      // Step 1: Process clipboard markers
      result.processedInput = await this.processClipboardMarkers(result.processedInput, result)
      
      // Step 2: Extract flags
      result.processedInput = this.extractFlags(result.processedInput, result)
      
      // Step 3: Validate processed input
      this.validateProcessedInput(result.processedInput, result)
      
      // Step 4: Sanitize input
      result.processedInput = this.sanitizeInput(result.processedInput)
      
      return result
    } catch (error) {
      result.errors.push(error.message)
      this.stats.validationErrors++
      this.logger.error('Input processing failed:', error)
      return result
    }
  }

  /**
   * Process clipboard markers in input
   */
  async processClipboardMarkers(input, result) {
    if (!input.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      return input
    }

    try {
      const clipboardContent = await getClipboardContent()
      const sanitizedContent = sanitizeString(clipboardContent)
      
      // Validate clipboard content length
      const maxLength = configManager.get('maxInputLength')
      if (sanitizedContent.length > maxLength) {
        throw new Error(`Clipboard content too large (${sanitizedContent.length} chars, max ${maxLength})`)
      }
      
      // Replace clipboard markers
      const processedInput = input.replace(
        new RegExp(APP_CONSTANTS.CLIPBOARD_MARKER.replace(/\$/g, '\\$'), 'g'),
        sanitizedContent
      )
      
      // Update metadata
      result.metadata.hasClipboard = true
      result.metadata.clipboardLength = sanitizedContent.length
      this.stats.clipboardInsertions++
      
      this.logger.debug(`Clipboard content inserted: ${sanitizedContent.length} chars`)
      console.log(`${color.grey}[Clipboard content inserted (${sanitizedContent.length} chars)]${color.reset}`)
      
      return processedInput
    } catch (error) {
      throw new Error(`Clipboard processing failed: ${error.message}`)
    }
  }

  /**
   * Extract flags from input
   */
  extractFlags(input, result) {
    let processedInput = input
    
    // Check for force flags (SIMPLE STRING VERSION)
    const forceFlags = ['-f', '--force']
    for (const baseFlag of forceFlags) {
      if (input.endsWith(' ' + baseFlag) || input.endsWith(baseFlag)) {
        result.flags.force = true
        result.metadata.extractedFlags.push(baseFlag)
        processedInput = processedInput.replace(' ' + baseFlag, '').replace(baseFlag, '').trim()
        this.stats.flagsExtracted++
        break
      }
    }
    
    // Check for other common flags
    const flagPatterns = [
      { pattern: /\s+--verbose\b/g, flag: 'verbose' },
      { pattern: /\s+-v\b/g, flag: 'verbose' },
      { pattern: /\s+--quiet\b/g, flag: 'quiet' },
      { pattern: /\s+-q\b/g, flag: 'quiet' },
      { pattern: /\s+--debug\b/g, flag: 'debug' }
    ]
    
    for (const { pattern, flag } of flagPatterns) {
      if (pattern.test(processedInput)) {
        result.flags[flag] = true
        result.metadata.extractedFlags.push(`--${flag}`)
        processedInput = processedInput.replace(pattern, '')
        this.stats.flagsExtracted++
      }
    }
    
    return processedInput.trim()
  }

  /**
   * Validate processed input
   */
  validateProcessedInput(input, result) {
    try {
      validateString(input, 'processed input', false)
      
      const maxLength = configManager.get('maxInputLength')
      if (input.length > maxLength) {
        throw new Error(`Input too long: ${input.length} chars (max ${maxLength})`)
      }
      
      if (input.trim().length === 0) {
        throw new Error('Input is empty after processing')
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Sanitize input for safe processing
   */
  sanitizeInput(input) {
    try {
      return sanitizeString(input)
    } catch (error) {
      this.logger.warn('Input sanitization failed:', error)
      return input // Return original if sanitization fails
    }
  }

  /**
   * Check if input contains URLs


   */
  extractUrls(input) {
    const urlRegex = /https?:\/\/[^\s]+/gi
    return input.match(urlRegex) || []
  }

  /**
   * Check if input looks like a file path


   */
  looksLikeFilePath(input) {
    // Simple heuristics for file path detection
    const filePatterns = [
      /^[\.\/~]/,  // Starts with ., /, or ~
      /\.[a-zA-Z0-9]{1,4}$/,  // Ends with file extension
      /^[a-zA-Z]:[\\\/]/  // Windows path
    ]
    
    return filePatterns.some(pattern => pattern.test(input.trim()))
  }

  /**
   * Detect input language (simple heuristics)


   */
  detectInputLanguage(input) {
    const text = input.toLowerCase()
    
    // Cyrillic characters (Russian)
    if (/[а-я]/.test(text)) {
      return 'ru'
    }
    
    // Chinese characters
    if (/[\u4e00-\u9fff]/.test(text)) {
      return 'zh'
    }
    
    // Default to English
    return 'en'
  }

  /**
   * Get input processing statistics

   */
  getProcessingStats() {
    return {
      ...this.stats,
      averageClipboardSize: this.stats.clipboardInsertions > 0 ? 
        Math.round(this.stats.clipboardLength / this.stats.clipboardInsertions) : 0,
      successRate: this.stats.inputsProcessed > 0 ? 
        ((this.stats.inputsProcessed - this.stats.validationErrors) / this.stats.inputsProcessed) * 100 : 100
    }
  }

  /**
   * Get service health status

   */
  getHealthStatus() {
    const stats = this.getProcessingStats()
    
    return {
      initialized: this.initialized,
      inputsProcessed: stats.inputsProcessed,
      successRate: stats.successRate,
      recentErrors: stats.validationErrors,
      isHealthy: this.initialized && stats.successRate > 90
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      inputsProcessed: 0,
      clipboardInsertions: 0,
      flagsExtracted: 0,
      validationErrors: 0
    }
    this.logger.debug('Input processing stats reset')
  }

  /**
   * Dispose of service resources
   */
  dispose() {
    this.resetStats()
    this.initialized = false
    this.logger.debug('InputProcessingService disposed')
  }
}