import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { color } from '../config/color.js'
import { LOG_LEVELS } from '../config/constants.js'

/**
 * Advanced logging utility with multiple levels and output targets
 */
export class Logger {
  constructor(options = {}) {
    this.level = options.level || LOG_LEVELS.INFO
    this.enableConsole = options.enableConsole ?? true
    this.enableFile = options.enableFile ?? false
    this.logDir = options.logDir || path.join(os.homedir(), '.ai-cli', 'logs')
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024 // 10MB
    this.maxFiles = options.maxFiles || 5
    this.logFile = null
    this.initialized = false
    
    this.levelPriorities = {
      [LOG_LEVELS.DEBUG]: 0,
      [LOG_LEVELS.INFO]: 1,
      [LOG_LEVELS.WARN]: 2,
      [LOG_LEVELS.ERROR]: 3
    }
    
    this.colors = {
      [LOG_LEVELS.DEBUG]: color.grey,
      [LOG_LEVELS.INFO]: color.cyan,
      [LOG_LEVELS.WARN]: color.yellow,
      [LOG_LEVELS.ERROR]: color.red
    }
  }

  /**
   * Initialize logger (create log directory, setup file logging)
   */
  async initialize() {
    if (this.initialized) return
    
    if (this.enableFile) {
      try {
        await fs.mkdir(this.logDir, { recursive: true })
        await fs.chmod(this.logDir, 0o700)
        
        const timestamp = new Date().toISOString().split('T')[0]
        this.logFile = path.join(this.logDir, `ai-cli-${timestamp}.log`)
        
        // Rotate logs if needed
        await this.rotateLogs()
      } catch (error) {
        console.error('Failed to initialize file logging:', error.message)
        this.enableFile = false
      }
    }
    
    this.initialized = true
  }

  /**
   * Check if level should be logged
   */
  shouldLog(level) {
    return this.levelPriorities[level] >= this.levelPriorities[this.level]
  }

  /**
   * Format log message
   */
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString()
    const metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta) : ''
    
    return {
      timestamp,
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      meta: metaString,
      formatted: `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString ? ' ' + metaString : ''}`
    }
  }

  /**
   * Log to console
   */
  logToConsole(logData) {
    if (!this.enableConsole) return
    
    const levelColor = this.colors[logData.level] || color.reset
    const resetColor = color.reset
    
    console.log(`${levelColor}[${logData.level.toUpperCase()}]${resetColor} ${logData.message}${logData.meta ? ' ' + logData.meta : ''}`)
  }

  /**
   * Log to file
   */
  async logToFile(logData) {
    if (!this.enableFile || !this.logFile) return
    
    try {
      await fs.appendFile(this.logFile, logData.formatted + '\n')
      
      // Check file size and rotate if needed
      const stats = await fs.stat(this.logFile)
      if (stats.size > this.maxFileSize) {
        await this.rotateLogs()
      }
    } catch (error) {
      console.error('Failed to write to log file:', error.message)
    }
  }

  /**
   * Rotate log files
   */
  async rotateLogs() {
    if (!this.logFile) return
    
    try {
      const logFiles = await fs.readdir(this.logDir)
      const aiCliLogs = logFiles
        .filter(file => file.startsWith('ai-cli-') && file.endsWith('.log'))
        .sort()
        .reverse()
      
      // Remove old log files
      if (aiCliLogs.length >= this.maxFiles) {
        for (let i = this.maxFiles - 1; i < aiCliLogs.length; i++) {
          await fs.unlink(path.join(this.logDir, aiCliLogs[i]))
        }
      }
      
      // Create new log file
      const timestamp = new Date().toISOString().split('T')[0]
      this.logFile = path.join(this.logDir, `ai-cli-${timestamp}.log`)
    } catch (error) {
      console.error('Failed to rotate logs:', error.message)
    }
  }

  /**
   * Generic log method
   */
  async log(level, message, meta = {}) {
    if (!this.shouldLog(level)) return
    
    await this.initialize()
    
    const logData = this.formatMessage(level, message, meta)
    
    this.logToConsole(logData)
    await this.logToFile(logData)
  }

  /**
   * Debug level logging
   */
  async debug(message, meta = {}) {
    await this.log(LOG_LEVELS.DEBUG, message, meta)
  }

  /**
   * Info level logging
   */
  async info(message, meta = {}) {
    await this.log(LOG_LEVELS.INFO, message, meta)
  }

  /**
   * Warning level logging
   */
  async warn(message, meta = {}) {
    await this.log(LOG_LEVELS.WARN, message, meta)
  }

  /**
   * Error level logging
   */
  async error(message, meta = {}) {
    await this.log(LOG_LEVELS.ERROR, message, meta)
  }

  /**
   * Set log level
   */
  setLevel(level) {
    if (this.levelPriorities[level] !== undefined) {
      this.level = level
    }
  }

  /**
   * Enable/disable console logging
   */
  setConsoleLogging(enabled) {
    this.enableConsole = enabled
  }

  /**
   * Enable/disable file logging
   */
  setFileLogging(enabled) {
    this.enableFile = enabled
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      level: this.level,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      logDir: this.logDir,
      logFile: this.logFile
    }
  }
}

// Export singleton instance
export const logger = new Logger({
  level: process.env.AI_CLI_LOG_LEVEL || LOG_LEVELS.INFO,
  enableFile: process.env.AI_CLI_ENABLE_FILE_LOG === 'true'
})