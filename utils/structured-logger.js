import { logger as baseLogger } from './logger.js'
import { getConfig } from '../config/app-config.js'
import { color } from '../config/color.js'

/**
 * Structured logger with levels, formatting, and console replacement
 * Provides consistent logging across the application
 */
export class StructuredLogger {
  constructor(options = {}) {
    this.options = {
      level: options.level || getConfig('LOGGING.DEFAULT_LEVEL'),
      enableConsole: options.enableConsole ?? true,
      enableFile: options.enableFile ?? false,
      component: options.component || 'App',
      formatters: options.formatters || {},
      ...options
    }
    
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      fatal: 4
    }
    
    this.currentLevel = this.levels[this.options.level] || 1
    this.baseLogger = baseLogger
    this.logBuffer = []
    this.maxBufferSize = getConfig('LOGGING.BUFFER_SIZE')
    
    // Statistics
    this.stats = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
      total: 0,
      startTime: Date.now()
    }
    
    this.setupFormatters()
  }

  setupFormatters() {
    this.formatters = {
      simple: this.simpleFormatter.bind(this),
      json: this.jsonFormatter.bind(this),
      detailed: this.detailedFormatter.bind(this),
      console: this.consoleFormatter.bind(this),
      ...this.options.formatters
    }
  }

  /**
   * Log a debug message
   */
  debug(message, meta = {}) {
    this.log('debug', message, meta)
  }

  /**
   * Log an info message
   */
  info(message, meta = {}) {
    this.log('info', message, meta)
  }

  /**
   * Log a warning message
   */
  warn(message, meta = {}) {
    this.log('warn', message, meta)
  }

  /**
   * Log an error message
   */
  error(message, meta = {}) {
    this.log('error', message, meta)
  }

  /**
   * Log a fatal error message
   */
  fatal(message, meta = {}) {
    this.log('fatal', message, meta)
  }

  /**
   * Core logging method
   */
  log(level, message, meta = {}) {
    const levelNum = this.levels[level]
    if (levelNum === undefined || levelNum < this.currentLevel) {
      return // Skip logging if level is below threshold
    }

    this.stats[level]++
    this.stats.total++

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      component: this.options.component,
      message: this.formatMessage(message),
      meta: this.sanitizeMeta(meta),
      pid: process.pid
    }

    // Add to buffer
    this.logBuffer.push(logEntry)
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift()
    }

    // Output to console if enabled
    if (this.options.enableConsole) {
      this.outputToConsole(logEntry)
    }

    // Output to file via base logger if enabled
    if (this.options.enableFile && this.baseLogger) {
      this.baseLogger.log(level, logEntry.message, logEntry.meta)
    }
  }

  /**
   * Format message consistently
   */
  formatMessage(message) {
    if (typeof message === 'string') {
      return message
    }
    
    if (message instanceof Error) {
      return `${message.name}: ${message.message}`
    }
    
    if (typeof message === 'object') {
      try {
        return JSON.stringify(message, null, 2)
      } catch (error) {
        return '[Complex Object]'
      }
    }
    
    return String(message)
  }

  /**
   * Sanitize metadata
   */
  sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object') {
      return meta
    }

    const sanitized = {}
    for (const [key, value] of Object.entries(meta)) {
      // Skip sensitive keys
      if (this.isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]'
        continue
      }

      // Handle different value types
      if (value instanceof Error) {
        sanitized[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack
        }
      } else if (typeof value === 'function') {
        sanitized[key] = '[Function]'
      } else {
        sanitized[key] = value
      }
    }

    return sanitized
  }

  /**
   * Check if a key contains sensitive information
   */
  isSensitiveKey(key) {
    const sensitiveKeys = [
      'password', 'token', 'key', 'secret', 'auth', 'credential',
      'apikey', 'api_key', 'authorization', 'passwd', 'pwd'
    ]
    
    const lowercaseKey = key.toLowerCase()
    return sensitiveKeys.some(sensitive => lowercaseKey.includes(sensitive))
  }

  /**
   * Output log entry to console with formatting
   */
  outputToConsole(entry) {
    const formatter = this.formatters.console
    const formatted = formatter(entry)
    
    // Use original console methods to avoid recursion
    const originalConsole = this.getOriginalConsole()
    
    // Use appropriate console method based on level
    switch (entry.level.toLowerCase()) {
      case 'debug':
        originalConsole.debug(formatted)
        break
      case 'info':
        originalConsole.info(formatted)
        break
      case 'warn':
        originalConsole.warn(formatted)
        break
      case 'error':
      case 'fatal':
        originalConsole.error(formatted)
        break
      default:
        originalConsole.log(formatted)
    }
  }

  /**
   * Get original console methods
   */
  getOriginalConsole() {
    // Store original console methods on first access
    if (!this._originalConsole) {
      this._originalConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console)
      }
    }
    return this._originalConsole
  }

  /**
   * Console formatter with colors
   */
  consoleFormatter(entry) {
    const levelColors = {
      DEBUG: color.grey,
      INFO: color.cyan,
      WARN: color.yellow,
      ERROR: color.red,
      FATAL: color.red
    }

    const levelColor = levelColors[entry.level] || color.reset
    const timestamp = new Date(entry.timestamp).toLocaleTimeString()
    
    let formatted = `${levelColor}[${entry.level}]${color.reset} `
    formatted += `${color.grey}${timestamp}${color.reset} `
    formatted += `${color.blue}[${entry.component}]${color.reset} `
    formatted += entry.message

    // Add metadata if present
    if (entry.meta && Object.keys(entry.meta).length > 0) {
      formatted += `\n  ${color.grey}Meta:${color.reset} ${JSON.stringify(entry.meta, null, 2)}`
    }

    return formatted
  }

  /**
   * Simple formatter
   */
  simpleFormatter(entry) {
    return `[${entry.level}] ${entry.message}`
  }

  /**
   * JSON formatter
   */
  jsonFormatter(entry) {
    return JSON.stringify(entry)
  }

  /**
   * Detailed formatter
   */
  detailedFormatter(entry) {
    return `${entry.timestamp} [${entry.level}] [${entry.component}] ${entry.message} ${JSON.stringify(entry.meta)}`
  }

  /**
   * Create a child logger with additional context
   */
  child(options = {}) {
    return new StructuredLogger({
      ...this.options,
      ...options,
      component: options.component || `${this.options.component}:${options.name || 'Child'}`
    })
  }

  /**
   * Set log level
   */
  setLevel(level) {
    if (this.levels[level] !== undefined) {
      this.currentLevel = this.levels[level]
      this.options.level = level
    }
  }

  /**
   * Get current log level
   */
  getLevel() {
    return this.options.level
  }

  /**
   * Get logging statistics
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime
    return {
      ...this.stats,
      uptime,
      rate: this.stats.total / (uptime / 1000), // logs per second
      bufferSize: this.logBuffer.length,
      level: this.options.level
    }
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count = 50, level = null) {
    let logs = [...this.logBuffer]
    
    if (level) {
      logs = logs.filter(entry => entry.level.toLowerCase() === level.toLowerCase())
    }
    
    return logs.slice(-count)
  }

  /**
   * Clear log buffer
   */
  clearBuffer() {
    const cleared = this.logBuffer.length
    this.logBuffer = []
    this.debug(`Log buffer cleared: ${cleared} entries`)
  }

  /**
   * Enable/disable console output
   */
  setConsoleOutput(enabled) {
    this.options.enableConsole = enabled
  }

  /**
   * Enable/disable file output
   */
  setFileOutput(enabled) {
    this.options.enableFile = enabled
  }

  /**
   * Flush any pending logs
   */
  async flush() {
    // Implementation would depend on file logging setup
    this.debug('Log flush requested')
  }

  /**
   * Dispose logger resources
   */
  dispose() {
    this.logBuffer = []
    this.stats = {
      debug: 0, info: 0, warn: 0, error: 0, fatal: 0,
      total: 0, startTime: Date.now()
    }
  }
}

/**
 * Console replacement utility
 * Replaces console methods with structured logger
 */
export class ConsoleReplacement {
  constructor(logger) {
    this.logger = logger
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console)
    }
    this.isReplaced = false
  }

  /**
   * Replace console methods with logger
   */
  replace() {
    if (this.isReplaced) return

    // Store original methods for logger to use
    this.logger._originalConsole = this.originalConsole

    console.log = (...args) => this.logger.info(this.formatArgs(args))
    console.info = (...args) => this.logger.info(this.formatArgs(args))
    console.warn = (...args) => this.logger.warn(this.formatArgs(args))
    console.error = (...args) => this.logger.error(this.formatArgs(args))
    console.debug = (...args) => this.logger.debug(this.formatArgs(args))

    this.isReplaced = true
    // Use original console for this message to avoid recursion
    this.originalConsole.debug('Console methods replaced with structured logger')
  }

  /**
   * Restore original console methods
   */
  restore() {
    if (!this.isReplaced) return

    Object.assign(console, this.originalConsole)
    this.isReplaced = false
    this.originalConsole.debug('Console methods restored to original')
  }

  /**
   * Format console arguments into a single message
   */
  formatArgs(args) {
    return args.map(arg => {
      if (typeof arg === 'string') return arg
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2)
        } catch {
          return '[Complex Object]'
        }
      }
      return String(arg)
    }).join(' ')
  }
}

// Create default logger instance
export const structuredLogger = new StructuredLogger({
  component: 'App',
  level: getConfig('LOGGING.DEFAULT_LEVEL')
})

// Create console replacement instance
export const consoleReplacement = new ConsoleReplacement(structuredLogger)

// Convenience function to get a child logger
export function getLogger(component, options = {}) {
  return structuredLogger.child({ component, ...options })
}