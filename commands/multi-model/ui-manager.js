import { outputHandler } from '../../core/print/index.js'
import { createSpinner } from '../../utils/spinner.js'
import { UI_SYMBOLS } from '../../config/constants.js'
import { logger } from '../../utils/logger.js'

export const createUIManager = () => {
  let currentSpinner = null

  const startInitialSpinner = (controller) => {
    if (currentSpinner) {
      currentSpinner.dispose()
    }
    currentSpinner = createSpinner()
    currentSpinner.start(controller)
    logger.debug('UIManager: Initial spinner started')
  }

  const showRemainingSpinner = (controller, remainingCount) => {
    startInitialSpinner(controller)
    const waitingStr = `Waiting for ${remainingCount} more model${remainingCount > 1 ? 's' : ''}...`
    outputHandler.writeNewline()
    outputHandler.write(waitingStr)
    logger.debug(
      `UIManager: Remaining spinner shown for ${remainingCount} models`,
    )
  }

  const displayWinnerHeader = (model) => {
    currentSpinner.dispose()
    // outputHandler.clearLine()
    outputHandler.writeNewline()
    outputHandler.writeModel(model)
    logger.debug(
      `UIManager: Winner header displayed for ${model.provider}:${model.model}`,
    )
  }

  const displayWinnerTiming = (timing) => {
    outputHandler.writeNewline()
    outputHandler.write(`finished: ${timing.toFixed(1)}s`)
    logger.debug(`UIManager: Winner timing displayed - ${timing}s`)
  }

  const displayModelResult = (result) => {
    const { model, response, timing, success, error } = result
    if (success) {
      currentSpinner.dispose()
      outputHandler.write(`\x1B[2A\x1B[2K\x1B[1A\x1B[2K`) // clear 2 lines (waiting N-models and spiner)
      outputHandler.writeModel(model)
      outputHandler.write(response)
      outputHandler.write(`finished: ${timing.toFixed(1)}s`)
    } else {
      if (error !== 'Request cancelled') {
        currentSpinner.dispose()
        outputHandler.write('\x1B[1A\x1B[2K') // clear 1 line
        outputHandler.writeModel(model)
        outputHandler.writeError(error)
      }
      outputHandler.write(`${UI_SYMBOLS.CROSS} failed: ${timing.toFixed(1)}s`)
    }
    const status = success ? 'success' : 'error'
    logger.debug(
      `UIManager: Model result displayed - ${model.provider}:${model.model} (${status})`,
    )
  }

  const displaySummary = (successfulCount, totalCount, stateManager) => {
    if (totalCount > 1) {
      currentSpinner.dispose()
      outputHandler.writeNewline()
      outputHandler.writeNewline()
      const total = `${successfulCount}/${totalCount} models`
      if (successfulCount === totalCount) {
        outputHandler.writeSuccess(total)
      } else {
        outputHandler.writeWarning(total)
      }
      outputHandler.writeContextDots(stateManager)
      logger.debug(
        `UIManager: Summary displayed - ${successfulCount}/${totalCount} models`,
      )
    }
  }

  const cleanup = () => {
    currentSpinner.dispose()
    outputHandler.clearLine()
  }

  return {
    // Spinner management
    startInitialSpinner,
    showRemainingSpinner,
    cleanup,
    // Display methods
    displayWinnerHeader,
    displayWinnerTiming,
    displayModelResult,
    displaySummary,
  }
}
