import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { exec } from 'node:child_process'
import util from 'node:util'
import { platform } from 'node:os'

import cache from './cache.js'
// import { API_PROVIDERS } from '../config/providers.js'
import { color } from '../config/color.js'
import { getAllAvailableCommands } from './autocomplete.js'
import { createBaseError } from '../core/error-system/index.js'
import { sanitizeString } from './validation.js'
import { APP_CONSTANTS, CLIPBOARD_COMMANDS, BROWSER_COMMANDS } from '../config/constants.js'

const execution = util.promisify(exec)

const getClipboardContent = async () => {
  const os = platform()
  const command = CLIPBOARD_COMMANDS[os]
  
  if (!command) {
    throw createBaseError(`Unsupported platform: ${os}`, true, 400)
  }
  try {
    const { stdout } = await execution(command, {
      timeout: 5000, // 5 second timeout for clipboard operations
      maxBuffer: APP_CONSTANTS.MAX_INPUT_LENGTH // Limit buffer size
    })

    const clipboardContent = stdout.trim()

    // Validate clipboard content size
    if (clipboardContent.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
      throw createBaseError(`Clipboard content too large (${clipboardContent.length} > ${APP_CONSTANTS.MAX_INPUT_LENGTH} characters)`, true, 400)
    }

    // Return sanitized content
    return sanitizeString(clipboardContent)
  } catch (error) {
    if (os === 'linux' && error.message.includes('command not found')) {
      console.error(
        'Error: "xclip" is not installed. Please install it to use clipboard functionality on Linux.',
      )
      return ''
    }
    if (error.code === 'ETIMEDOUT') {
      throw createBaseError('Clipboard operation timed out', true, 408)
    }
    throw error
  }
}

/**
 * Open URL in default browser using platform-specific commands
 */
const openInBrowser = async (url) => {
  const os = platform()

  // Validate URL format
  if (!url || typeof url !== 'string') {
    throw createBaseError('Invalid URL provided', true, 400)
  }

  // Add https:// if no protocol specified
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }

  // Platform-specific commands
  const browserCmd = BROWSER_COMMANDS[os]
  if (!browserCmd) {
    throw createBaseError(`Unsupported platform: ${os}`, true, 400)
  }
  
  const command = `${browserCmd} "${url}"`

  try {
    await execution(command, {
      timeout: 5000, // 5 second timeout for browser operations
      maxBuffer: 1024 * 1024 // 1MB buffer limit
    })
    return true
  } catch (error) {
    if (error.code === 'ETIMEDOUT') {
      throw createBaseError('Browser operation timed out', true, 408)
    }
    throw createBaseError(`Failed to open browser: ${error.message}`, true, 500)
  }
}

// Create completer function for system commands autocomplete
function completer(line) {
  const commands = getAllAvailableCommands()
  const hits = commands.filter((cmd) => cmd.startsWith(line))
  // Show matches or all commands if no matches
  return [hits.length ? hits : [], line]
}

/**
 * Calculate elapsed time in seconds from start time


 */
const getElapsedTime = (startTime) => {
  if (!startTime) return 'N/A'
  return ((Date.now() - startTime) / 1000).toFixed(1)
}

/**
 * Clear current terminal line and move cursor to beginning
 */
const clearTerminalLine = () => {
  process.stdout.write('\r\x1b[K')
}

/**
 * Show status message with icon and elapsed time



 */
const showStatus = (type, time, message = '') => {
  const icon = type === 'success' ? '✓' : '☓'
  const statusColor = type === 'success' ? color.green : color.red

  const statusText = `${statusColor}${icon}${color.reset} ${time}s`

  if (message) {
    process.stdout.write(statusText + '\n')
    process.stdout.write(message + '\n')
  } else {
    process.stdout.write(statusText + '\n')
  }
}

// Removed global readline interface - conflicts with CLIManager.rl
// Use CLIManager.rl as the single readline interface in the application

export { getClipboardContent, cache, openInBrowser, getElapsedTime, clearTerminalLine, showStatus }
