import { exec } from 'node:child_process'
import util from 'node:util'
import { platform } from 'node:os'
import { createBaseError } from '../../core/error-system/index.js'
import { sanitizeString } from '../../utils/validation.js'
import { APP_CONSTANTS, CLIPBOARD_COMMANDS } from '../../config/constants.js'

const execution = util.promisify(exec)

export const getClipboardContent = async () => {
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