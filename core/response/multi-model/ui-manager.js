import { outputHandler } from '../../print/index.js'
import { createSpinner } from '../../../utils/spinner.js'
import { UI_SYMBOLS } from '../../../config/constants.js'
import { logger } from '../../../utils/logger.js'

export const createUIManager = () => {
  let currentSpinner = null
  let winnerActive = false
  let winnerStreaming = false
  let lastWaitingCount = null
  let pendingWaitingMessage = null
  let activeController = null

  const ensureSpinnerStopped = (status = 'success') => {
    if (!currentSpinner) {
      return
    }
    currentSpinner.stop(status)
    currentSpinner = null
  }

  const ensureSpinnerDisposed = () => {
    if (!currentSpinner) {
      return
    }
    currentSpinner.dispose()
    currentSpinner = null
  }

  const startSpinner = (controller, message = '', { force = false } = {}) => {
    if (!force && currentSpinner) {
      return
    }

    ensureSpinnerDisposed()
    currentSpinner = createSpinner(message)
    currentSpinner.start(controller)
  }

  const startInitialSpinner = (controller) => {
    activeController = controller
    if (winnerActive) {
      return
    }
    lastWaitingCount = null
    pendingWaitingMessage = null
    startSpinner(controller, '', { force: true })
    logger.debug('UIManager: Initial spinner started')
  }

  const showRemainingSpinner = (controller, remainingCount) => {
    activeController = controller
    const waitingStr = `Waiting for ${remainingCount} more model${remainingCount > 1 ? 's' : ''}...`
    pendingWaitingMessage = waitingStr

    if (winnerStreaming) {
      if (lastWaitingCount !== remainingCount) {
        outputHandler.writeNewline()
        outputHandler.write(waitingStr)
        lastWaitingCount = remainingCount
        logger.debug(
          `UIManager: Remaining count updated (winner streaming) - ${remainingCount}`,
        )
      }
      return
    }

    if (!currentSpinner) {
      outputHandler.writeNewline()
      startSpinner(controller, waitingStr, { force: true })
      lastWaitingCount = remainingCount
      logger.debug(
        `UIManager: Waiting spinner started for ${remainingCount} models`,
      )
      return
    }

    if (lastWaitingCount !== remainingCount) {
      outputHandler.writeNewline()
      startSpinner(controller, waitingStr, { force: true })
      lastWaitingCount = remainingCount
      logger.debug(
        `UIManager: Waiting spinner updated for ${remainingCount} models`,
      )
    }
  }

  const displayWinnerHeader = (model) => {
    ensureSpinnerStopped('success')
    winnerActive = true
    winnerStreaming = true
    lastWaitingCount = null
    pendingWaitingMessage = null
    outputHandler.writeNewline()
    outputHandler.writeModel(model)
    logger.debug(
      `UIManager: Winner header displayed for ${model.provider}:${model.model}`,
    )
  }

  const displayWinnerTiming = (timing) => {
    outputHandler.writeNewline()
    outputHandler.write(`finished: ${timing.toFixed(1)}s`)
    winnerStreaming = false

    if (
      pendingWaitingMessage &&
      activeController &&
      lastWaitingCount &&
      lastWaitingCount > 0
    ) {
      outputHandler.writeNewline()
      startSpinner(activeController, pendingWaitingMessage, { force: true })
      logger.debug(
        `UIManager: Waiting spinner resumed after winner completion - ${lastWaitingCount}`,
      )
    }

    logger.debug(`UIManager: Winner timing displayed - ${timing}s`)
  }

  const displayModelResult = (result) => {
    const { model, response, timing, success, error } = result

    if (success) {
      ensureSpinnerStopped('success')
      outputHandler.writeModel(model)
      if (response) {
        outputHandler.write(response)
      }
      outputHandler.write(`finished: ${timing.toFixed(1)}s`)
    } else {
      ensureSpinnerStopped('error')
      outputHandler.writeModel(model)
      if (error !== 'Request cancelled') {
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
      ensureSpinnerDisposed()
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
    winnerActive = false
    winnerStreaming = false
    lastWaitingCount = null
    pendingWaitingMessage = null
    activeController = null
  }

  const cleanup = () => {
    ensureSpinnerDisposed()
    winnerActive = false
    winnerStreaming = false
    lastWaitingCount = null
    pendingWaitingMessage = null
    activeController = null
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
