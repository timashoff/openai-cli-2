import { color } from '../../config/color.js'
import { APP_CONSTANTS } from '../../config/constants.js'
import { sanitizeString, validateString } from '../../utils/validation.js'
import { errorHandler } from '../error-system/index.js'
import { outputHandler } from '../print/output.js'

export const createInputProcessor = (stateManager) => {
  const processUserInput = async (userInput) => {
    try {
      userInput = sanitizeString(userInput)

      if (userInput.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
        console.log(
          `${color.red}Error: Input too long (max ${APP_CONSTANTS.MAX_INPUT_LENGTH} characters)${color.reset}`,
        )
        return false
      }

      validateString(userInput, 'user input', true)
      return userInput
    } catch (error) {
      errorHandler.handleError(error, { context: 'input_validation' })
      return false
    }
  }

  const handleEmptyInput = async (state) => {
    const contextHistory = stateManager.getContextHistory()
    if (contextHistory.length) {
      stateManager.clearContext()
      outputHandler.writeWarning('Context history cleared')
    } else {
      await new Promise((resolve) => {
        setTimeout(() => {
          outputHandler.clearScreen()
          state.screenWasCleared = true
          resolve()
        }, APP_CONSTANTS.CLEAR_TIMEOUT)
      })
    }
  }

  const getUserPrompt = (screenWasCleared) => {
    const colorInput = color.green
    return screenWasCleared
      ? `${colorInput}> `
      : `
${colorInput}> `
  }

  return {
    processUserInput,
    handleEmptyInput,
    getUserPrompt,
  }
}