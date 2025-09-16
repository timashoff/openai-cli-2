import { emitKeypressEvents } from 'node:readline'
import { logger } from '../../utils/logger.js'
import { outputHandler } from '../print/index.js'

export const createKeypressHandler = (state) => {
  const setupEscapeKeyHandling = () => {
    // Setup keypress events for escape handling (compatible with readline)
    emitKeypressEvents(process.stdin)
    process.stdin.on('keypress', (str, key) => {
      if (key && key.name === 'escape') {
        handleEscapeKey()
      }
    })
  }

  const handleEscapeKey = () => {
    // If there's a specific handler registered, use it
    if (state.currentEscHandler) {
      state.currentEscHandler()
      return
    }

    // Default ESC behavior for AI requests
    const controller = state.stateManager.getCurrentRequestController()

    // Cancel AbortController (signal to provider)
    if (controller) {
      controller.abort()
    }

    // INSTANT escape through Promise.race - don't wait for provider!
    if (state.currentEscapeResolve) {
      state.currentEscapeResolve('CANCELLED')
    }

    // Clean up streaming state
    if (state.stateManager.isTypingResponse()) {
      state.stateManager.setTypingResponse(false)
      state.stateManager.setShouldReturnToPrompt(true)
    }

    // Force terminate stream processor (FIX for streaming bug)
    const streamProcessor = state.stateManager.getCurrentStreamProcessor()
    if (streamProcessor) {
      streamProcessor.forceTerminate()
      logger.debug('ESC: StreamProcessor force terminated')
    }

    // Show cursor
    outputHandler.showCursor()
  }

  const enableKeypressEvents = () => {
    if (!state.keypressEnabled) {
      // Enable keypress events without raw mode to avoid readline conflicts
      // emitKeypressEvents already called in setupEscapeKeyHandling
      process.stdin.on('keypress', state.globalKeyPressHandler)
      state.keypressEnabled = true
    }
  }

  const registerEscHandler = (handlerFunction, description = '') => {
    const handlerId = ++state.handlerIdCounter
    state.escHandlers.set(handlerId, {
      handler: handlerFunction,
      description: description,
      registeredAt: Date.now(),
    })

    // Set as current handler
    state.currentEscHandler = handlerFunction

    logger.debug(`ESC handler registered: ${handlerId} - ${description}`)
    return handlerId
  }

  const unregisterEscHandler = (handlerId) => {
    const handlerData = state.escHandlers.get(handlerId)
    if (handlerData) {
      state.escHandlers.delete(handlerId)

      // If this was the current handler, clear it
      if (state.currentEscHandler === handlerData.handler) {
        state.currentEscHandler = null
      }

      logger.debug(
        `ESC handler unregistered: ${handlerId} - ${handlerData.description}`,
      )
      return true
    }
    return false
  }

  const clearAllEscHandlers = () => {
    const count = state.escHandlers.size
    state.escHandlers.clear()
    state.currentEscHandler = null
    logger.debug(`All ESC handlers cleared (${count} handlers)`)
  }

  const getEscHandlers = () => {
    const handlers = []
    for (const [id, data] of state.escHandlers) {
      handlers.push({
        id: id,
        description: data.description,
        registeredAt: data.registeredAt,
        isCurrent: state.currentEscHandler === data.handler,
      })
    }
    return handlers
  }

  return {
    setupEscapeKeyHandling,
    handleEscapeKey,
    enableKeypressEvents,
    registerEscHandler,
    unregisterEscHandler,
    clearAllEscHandlers,
    getEscHandlers,
  }
}