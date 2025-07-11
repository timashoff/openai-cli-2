import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { exec } from 'node:child_process'
import util from 'node:util'
import { platform } from 'node:os'

import { execModel } from './model/execModel.js'
import cache from './cache.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { color } from '../config/color.js'
import { getAllSystemCommands } from './autocomplete.js'
import { AppError } from './error-handler.js'
import { sanitizeString } from './validation.js'
import { APP_CONSTANTS } from '../config/constants.js'

const execution = util.promisify(exec)

const getClipboardContent = async () => {
  const os = platform()
  let command
  switch (os) {
    case 'darwin':
      command = 'pbpaste'
      break
    case 'linux':
      command = 'xclip -selection clipboard -o'
      break
    case 'win32':
      command = 'powershell.exe -command "Get-Clipboard"'
      break
    default:
      throw new Error(`Unsupported platform: ${os}`)
  }
  try {
    const { stdout } = await execution(command, { 
      timeout: 5000, // 5 second timeout for clipboard operations
      maxBuffer: APP_CONSTANTS.MAX_INPUT_LENGTH // Limit buffer size
    })
    
    const clipboardContent = stdout.trim()
    
    // Validate clipboard content size
    if (clipboardContent.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
      throw new AppError(`Clipboard content too large (${clipboardContent.length} > ${APP_CONSTANTS.MAX_INPUT_LENGTH} characters)`, true, 400)
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
      throw new AppError('Clipboard operation timed out', true, 408)
    }
    throw error
  }
}

// Create completer function for system commands autocomplete
function completer(line) {
  const commands = getAllSystemCommands()
  const hits = commands.filter((cmd) => cmd.startsWith(line))
  // Show matches or all commands if no matches
  return [hits.length ? hits : [], line]
}

const rl = readline.createInterface({ 
  input, 
  output,
  completer
})


export { rl, getClipboardContent, execModel, cache }