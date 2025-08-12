import { BaseRequestHandler } from './base-handler.js'
import { AppError } from '../utils/error-handler.js'
import { getClipboardContent } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { color } from '../config/color.js'
import { APP_CONSTANTS } from '../config/constants.js'

/**
 * Handler for processing clipboard markers ($$ tokens) in user input
 * Replaces $$ with actual clipboard content and validates size limits
 */
export class ClipboardHandler extends BaseRequestHandler {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Object} */
    this.config = dependencies.config
    
    // Safe access to constants with fallbacks
    const clipboardMarker = APP_CONSTANTS?.CLIPBOARD_MARKER || '$$'
    const maxInputLength = APP_CONSTANTS?.MAX_INPUT_LENGTH || 10000
    const clipboardTimeout = APP_CONSTANTS?.CLIPBOARD_TIMEOUT || 5000
    
    /** @type {string} */
    this.clipboardMarker = clipboardMarker
    /** @type {number} */
    this.maxClipboardLength = this.config?.get('maxInputLength') || maxInputLength
    /** @type {number} */
    this.clipboardTimeout = clipboardTimeout
  }

  /**
   * @override
   */
  async canHandle(context) {
    return context.processedInput.includes(this.clipboardMarker)
  }

  /**
   * @override
   */
  async process(context) {
    const input = context.processedInput
    const markerCount = this.countClipboardMarkers(input)
    
    this.log('info', `Processing ${markerCount} clipboard marker(s)`)
    
    try {
      // Get clipboard content with timeout
      const clipboardContent = await this.getClipboardWithTimeout()
      
      // Sanitize and validate clipboard content
      const sanitizedContent = this.sanitizeClipboardContent(clipboardContent)
      this.validateClipboardContent(sanitizedContent)
      
      // Replace all clipboard markers with content
      const processedInput = this.replaceClipboardMarkers(input, sanitizedContent)
      
      // Log successful replacement
      this.log('info', `Clipboard content inserted: ${sanitizedContent.length} characters`)
      console.log(`${color.grey}[Clipboard content inserted (${sanitizedContent.length} chars)]${color.reset}`)
      
      // Emit clipboard processed event
      this.emitEvent('clipboard:processed', {
        markerCount,
        contentLength: sanitizedContent.length,
        originalLength: clipboardContent.length
      })
      
      return this.createPassThrough(processedInput, {
        clipboardProcessed: true,
        contentLength: sanitizedContent.length,
        markerCount
      })
      
    } catch (error) {
      this.log('error', `Clipboard processing failed: ${error.message}`)
      
      // Emit error event
      this.emitEvent('clipboard:error', {
        error: error.message,
        markerCount
      })
      
      // Show user-friendly error
      console.log(`${color.red}Error: ${this.getUserFriendlyError(error)}${color.reset}`)
      
      // Stop chain on clipboard errors - user needs to fix input
      return this.createResult(null, { stopChain: true })
    }
  }

  /**
   * Get clipboard content with timeout protection
   * @private
   * @returns {Promise<string>} Clipboard content
   */
  async getClipboardWithTimeout() {
    return Promise.race([
      getClipboardContent(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new AppError('Clipboard access timeout', true, 408))
        }, this.clipboardTimeout)
      })
    ])
  }

  /**
   * Count clipboard markers in input
   * @private
   * @param {string} input - Input text
   * @returns {number} Number of markers
   */
  countClipboardMarkers(input) {
    const regex = new RegExp(this.clipboardMarker.replace(/\$/g, '\\$'), 'g')
    const matches = input.match(regex)
    return matches ? matches.length : 0
  }

  /**
   * Sanitize clipboard content
   * @private
   * @param {string} content - Raw clipboard content
   * @returns {string} Sanitized content
   */
  sanitizeClipboardContent(content) {
    if (typeof content !== 'string') {
      throw new AppError('Clipboard content must be text', true, 400)
    }
    
    return sanitizeString(content)
  }

  /**
   * Validate clipboard content
   * @private
   * @param {string} content - Sanitized clipboard content
   */
  validateClipboardContent(content) {
    // Validate basic string requirements
    validateString(content, 'clipboard content', false) // Allow empty clipboard
    
    // Check length limits
    if (content.length > this.maxClipboardLength) {
      throw new AppError(
        `Clipboard content too large (${content.length} chars, max ${this.maxClipboardLength})`,
        true,
        413
      )
    }
    
    // Check for suspicious content patterns
    if (this.hasSuspiciousContent(content)) {
      throw new AppError('Clipboard content contains potentially unsafe data', true, 400)
    }
  }

  /**
   * Check for suspicious content in clipboard
   * @private
   * @param {string} content - Content to check
   * @returns {boolean} True if suspicious
   */
  hasSuspiciousContent(content) {
    // Check for potential security risks
    const suspiciousPatterns = [
      /javascript:/i,
      /data:.*base64/i,
      /<script/i,
      /eval\s*\(/i,
      /document\.cookie/i,
      /localStorage/i,
      /sessionStorage/i
    ]
    
    return suspiciousPatterns.some(pattern => pattern.test(content))
  }

  /**
   * Replace clipboard markers with actual content
   * @private
   * @param {string} input - Original input
   * @param {string} clipboardContent - Content to insert
   * @returns {string} Input with markers replaced
   */
  replaceClipboardMarkers(input, clipboardContent) {
    // Escape special regex characters in marker
    const escapedMarker = this.clipboardMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedMarker, 'g')
    
    return input.replace(regex, clipboardContent)
  }

  /**
   * Convert technical errors to user-friendly messages
   * @private
   * @param {Error} error - Technical error
   * @returns {string} User-friendly error message
   */
  getUserFriendlyError(error) {
    if (error.message.includes('timeout')) {
      return 'Clipboard access timed out. Please try again.'
    }
    
    if (error.message.includes('too large')) {
      return `Clipboard content is too large (max ${Math.floor(this.maxClipboardLength / 1000)}K characters)`
    }
    
    if (error.message.includes('unsafe')) {
      return 'Clipboard content appears to contain unsafe data'
    }
    
    if (error.message.includes('access')) {
      return 'Cannot access clipboard. Please check permissions.'
    }
    
    // Default fallback
    return 'Unable to process clipboard content'
  }

  /**
   * @override
   */
  getStats() {
    const baseStats = super.getStats()
    
    const clipboardStats = this.processingStats.get('processed')
    const errorStats = this.processingStats.get('processed:error')
    
    return {
      ...baseStats,
      clipboardOperations: {
        total: clipboardStats ? clipboardStats.count : 0,
        errors: errorStats ? errorStats.count : 0,
        averageContentLength: this.getAverageContentLength(),
        maxClipboardLength: this.maxClipboardLength,
        timeoutMs: this.clipboardTimeout
      }
    }
  }

  /**
   * Get average clipboard content length from metadata
   * @private
   * @returns {number} Average content length
   */
  getAverageContentLength() {
    // This would need to be tracked if we want precise averages
    // For now, return 0 as placeholder
    return 0
  }

  /**
   * @override
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus()
    
    // Add clipboard-specific health indicators
    const clipboardHealth = {
      canAccessClipboard: this.checkClipboardAccess(),
      configuredMaxLength: this.maxClipboardLength,
      timeoutConfigured: this.clipboardTimeout
    }
    
    return {
      ...baseHealth,
      clipboardHealth
    }
  }

  /**
   * Quick check if clipboard access is available
   * @private
   * @returns {boolean} True if clipboard access appears available
   */
  checkClipboardAccess() {
    // This is a simplified check - actual implementation would test clipboard access
    return typeof getClipboardContent === 'function'
  }
}