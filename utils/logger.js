import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { color } from '../config/color.js'
import { LOG_LEVELS } from '../config/constants.js'

const createLogger = (options = {}) => {
  const state = {
    level: options.level || LOG_LEVELS.INFO,
    enableConsole: options.enableConsole ?? true,
    enableFile: options.enableFile ?? false,
    logDir: options.logDir || path.join(os.homedir(), '.ai-cli', 'logs'),
    maxFileSize: options.maxFileSize || 10 * 1024 * 1024,
    maxFiles: options.maxFiles || 5,
    logFile: null,
    initialized: false
  }
  
  const levelPriorities = {
    [LOG_LEVELS.DEBUG]: 0,
    [LOG_LEVELS.INFO]: 1,
    [LOG_LEVELS.WARN]: 2,
    [LOG_LEVELS.ERROR]: 3
  }
  
  const colors = {
    [LOG_LEVELS.DEBUG]: color.grey,
    [LOG_LEVELS.INFO]: color.cyan,
    [LOG_LEVELS.WARN]: color.yellow,
    [LOG_LEVELS.ERROR]: color.red
  }

  const initialize = async () => {
    if (state.initialized) return
    
    if (state.enableFile) {
      try {
        await fs.mkdir(state.logDir, { recursive: true })
        await fs.chmod(state.logDir, 0o700)
        
        const timestamp = new Date().toISOString().split('T')[0]
        state.logFile = path.join(state.logDir, `ai-cli-${timestamp}.log`)
        
        await rotateLogs()
      } catch (error) {
        console.error('Failed to initialize file logging:', error.message)
        state.enableFile = false
      }
    }
    
    state.initialized = true
  }

  const shouldLog = (level) => {
    return levelPriorities[level] >= levelPriorities[state.level]
  }

  const formatMessage = (level, message, meta = {}) => {
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

  const logToConsole = (logData) => {
    if (!state.enableConsole) return
    
    const levelColor = colors[logData.level] || color.reset
    const resetColor = color.reset
    
    console.log(`${levelColor}[${logData.level.toUpperCase()}]${resetColor} ${logData.message}${logData.meta ? ' ' + logData.meta : ''}`)
  }

  const logToFile = async (logData) => {
    if (!state.enableFile || !state.logFile) return
    
    try {
      await fs.appendFile(state.logFile, logData.formatted + '\n')
      
      const stats = await fs.stat(state.logFile)
      if (stats.size > state.maxFileSize) {
        await rotateLogs()
      }
    } catch (error) {
      console.error('Failed to write to log file:', error.message)
    }
  }

  const rotateLogs = async () => {
    if (!state.logFile) return
    
    try {
      const logFiles = await fs.readdir(state.logDir)
      const aiCliLogs = logFiles
        .filter(file => file.startsWith('ai-cli-') && file.endsWith('.log'))
        .sort()
        .reverse()
      
      if (aiCliLogs.length >= state.maxFiles) {
        for (let i = state.maxFiles - 1; i < aiCliLogs.length; i++) {
          await fs.unlink(path.join(state.logDir, aiCliLogs[i]))
        }
      }
      
      const timestamp = new Date().toISOString().split('T')[0]
      state.logFile = path.join(state.logDir, `ai-cli-${timestamp}.log`)
    } catch (error) {
      console.error('Failed to rotate logs:', error.message)
    }
  }

  const log = async (level, message, meta = {}) => {
    if (!shouldLog(level)) return
    
    await initialize()
    
    const logData = formatMessage(level, message, meta)
    
    logToConsole(logData)
    await logToFile(logData)
  }

  return {
    debug: async (message, meta = {}) => await log(LOG_LEVELS.DEBUG, message, meta),
    info: async (message, meta = {}) => await log(LOG_LEVELS.INFO, message, meta),
    warn: async (message, meta = {}) => await log(LOG_LEVELS.WARN, message, meta),
    error: async (message, meta = {}) => await log(LOG_LEVELS.ERROR, message, meta),
    
    setLevel: (level) => {
      if (levelPriorities[level] !== undefined) {
        state.level = level
      }
    },
    
    setConsoleLogging: (enabled) => {
      state.enableConsole = enabled
    },
    
    setFileLogging: (enabled) => {
      state.enableFile = enabled
    },
    
    getConfig: () => ({
      level: state.level,
      enableConsole: state.enableConsole,
      enableFile: state.enableFile,
      logDir: state.logDir,
      logFile: state.logFile
    })
  }
}

export const logger = createLogger({
  level: process.env.AI_CLI_LOG_LEVEL || LOG_LEVELS.INFO,
  enableFile: process.env.AI_CLI_ENABLE_FILE_LOG === 'true'
})