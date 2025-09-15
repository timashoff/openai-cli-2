import { outputHandler } from '../core/print/output.js'
import { createStreamProcessor } from '../utils/stream-processor.js'
import { logger } from '../utils/logger.js'
import { createSpinner } from '../utils/spinner.js'
import { logError, processError, createBaseError } from '../core/error-system/index.js'
import { UI_SYMBOLS } from '../config/constants.js'
import { prepareStreamingMessages } from '../utils/message-utils.js'
import { updateMultiContext } from '../utils/context-utils.js'

export const multiModelCommand = {

  /**
   * Execute multiple models with REACTIVE algorithm
   */
  async execute(commandData, app) {
    try {
      logger.debug(
        `MultiModelCommand: Executing ${commandData.models.length} models`,
      )

      // Cache is disabled - all models are live
      const liveModels = commandData.models

      // Execute live models with reactive algorithm
      let successfulLiveModels = 0
      if (liveModels.length > 0) {
        successfulLiveModels = await this.executeReactiveModels(
          liveModels,
          commandData,
          app,
        )
      }

      // Display final summary
      this.displaySummary(
        0, // cachedCount always 0 (cache disabled)
        successfulLiveModels,
        commandData.models.length,
        app.stateManager,
      )
    } catch (error) {
      const processedError = await processError(error, { context: 'MultiModelCommand' })
      await logError(processedError)
      outputHandler.writeError(`Multi-model execution failed: ${processedError.userMessage}`)
      throw processedError.originalError
    }
  },




  /**
   * Execute models with REACTIVE algorithm - the correct way
   */
  async executeReactiveModels(liveModels, commandData, app) {
    const stateManager = app.stateManager
    const controller = stateManager.getCurrentRequestController()

    if (!controller) {
      throw new Error('AbortController not available')
    }

    // AbortSignal automatically managed via Event-Driven StateManager
    // (No manual outputHandler.setAbortSignal needed)

    // Prepare messages
    const messages = prepareStreamingMessages(stateManager, commandData.content)

    // REACTIVE ALGORITHM: Dynamic pending array [A,B,C] → [A,C] → [C] → []
    const pendingModels = [...liveModels] // This is our dynamic queue
    const modelPromises = new Map()
    const modelResults = new Map()

    // Global winner state
    let globalWinnerFound = false
    let winnerModel = null

    // Start initial spinner
    const initialSpinner = createSpinner()
    initialSpinner.start(controller)

    try {
      // Phase 1: Start all models in parallel with winner detection
      for (const model of liveModels) {
        const promise = this.startModelWithWinnerDetection(
          model,
          messages,
          stateManager,
          commandData,
          () => globalWinnerFound,
          (winModel) => {
            if (!globalWinnerFound) {
              globalWinnerFound = true
              winnerModel = winModel

              // Stop initial spinner immediately
              if (initialSpinner.isActive()) {
                initialSpinner.stop('success')
                initialSpinner.dispose()
              }

              // Clear spinner artifacts
              outputHandler.clearLine()

              // Display winner header
              outputHandler.writeNewline()
              outputHandler.writeModel(winModel)
            }
          },
        )

        modelPromises.set(this.getModelKey(model), promise)
      }

      // Phase 2: EVENT-DRIVEN processing - NO MORE CPU WASTE!
      let successfulCount = 0
      let currentSpinner = null
      let winnerCompleted = false

      // Process models as they complete using async iterator - NO TIGHT LOOPS!
      for await (const completion of this.processModelsEventDriven(
        modelPromises,
        controller,
      )) {
        const { modelKey, result, success, error } = completion

        // Find model from key
        const model = liveModels.find((m) => this.getModelKey(m) === modelKey)
        if (!model) continue

        // Stop current spinner if active
        if (currentSpinner) {
          currentSpinner.stop('success')
          currentSpinner.dispose()
          outputHandler.clearLine() // Clear "Waiting..." message
          currentSpinner = null
        }

        // Store result
        const modelResult = success
          ? result
          : { model, error, success: false, timing: 0 }
        modelResults.set(modelKey, modelResult)

        // Display result (skip winner - already streamed)
        if (model !== winnerModel) {
          this.displayModelResult(modelResult)
        }

        // Count successful
        if (success) {
          successfulCount++
        }

        // Track winner completion for proper spinner synchronization
        if (result.isWinner) {
          winnerCompleted = true
        }

        // Calculate remaining models - same logic as before!
        const totalProcessed = modelResults.size
        const remainingCount = liveModels.length - totalProcessed

        // Show spinner for remaining models (only after winner completes)
        if (
          remainingCount > 0 &&
          winnerCompleted &&
          !controller.signal.aborted
        ) {
          currentSpinner = createSpinner()
          currentSpinner.start(controller)
          outputHandler.write(
            `Waiting for ${remainingCount} more model${remainingCount > 1 ? 's' : ''}...`,
          )
        }
      }

      // Clean up final spinner
      if (currentSpinner) {
        currentSpinner.stop('success')
        currentSpinner.dispose()
        outputHandler.clearLine()
      }

      // Add context management for multi-model responses
      const successfulResults = Array.from(modelResults.values()).filter(r => r.success && r.response)
      if (successfulResults.length > 0 && !controller.signal.aborted) {
        const allResponses = successfulResults.map(r => r.response)
        updateMultiContext(stateManager, commandData.content, allResponses)
      }

      return successfulCount
    } catch (error) {
      // Cleanup spinners
      if (initialSpinner && initialSpinner.isActive()) {
        initialSpinner.stop('error')
        initialSpinner.dispose()
      }
      throw error
    }
  },

  /**
   * EVENT-DRIVEN async generator - NO MORE CPU WASTE!
   * Processes models as they complete, removing them from pending Map
   */
  async *processModelsEventDriven(modelPromises, controller) {
    // Use Map for proper tracking and removal
    const pendingPromises = new Map(modelPromises)

    // Process until all models complete or user aborts
    while (pendingPromises.size > 0 && !controller.signal.aborted) {
      // Create completion promises for all pending models
      const completionPromises = Array.from(pendingPromises.entries()).map(
        async ([modelKey, promise]) => {
          try {
            const result = await promise
            return {
              modelKey,
              result,
              success: true,
              error: null,
            }
          } catch (error) {
            return {
              modelKey,
              result: null,
              success: false,
              error: error.message || 'Unknown error',
            }
          }
        },
      )

      // Wait for NEXT completion (event-driven, not polling!)
      const completion = await Promise.race(completionPromises)

      // CRITICAL: Remove completed model from pending Map
      pendingPromises.delete(completion.modelKey)

      // Yield completion event - this is where the magic happens!
      yield completion
    }

    // Handle abort case
    if (controller.signal.aborted) {
      logger.debug('MultiModelCommand: Processing aborted by user')
    }
  },

  /**
   * Start model request with winner detection in chunkHandler
   */
  async startModelWithWinnerDetection(
    model,
    messages,
    stateManager,
    commandData,
    isWinnerFound,
    onWinner,
  ) {
    const startTime = Date.now()
    const controller = stateManager.getCurrentRequestController()

    try {
      // Create streaming request
      const stream = await stateManager.createChatCompletion(
        messages,
        {
          stream: true,
          signal: controller.signal,
        },
        model,
      )

      const streamProcessor = createStreamProcessor()
      const responseBuffer = []
      let isThisModelWinner = false

      // Winner detection happens HERE in chunkHandler
      const chunkHandler = async (content) => {
        if (controller.signal.aborted) return
        responseBuffer.push(content)

        // First meaningful chunk makes this model the winner
        if (!isWinnerFound() && content && content.trim()) {
          isThisModelWinner = true
          onWinner(model) // Triggers global winner logic
        }

        // Real-time streaming ONLY for winner
        if (isThisModelWinner && content) {
          outputHandler.writeStream(content)
        }
      }

      // Process stream
      await streamProcessor.processStream(
        stream,
        controller.signal,
        chunkHandler,
      )

      const timing = (Date.now() - startTime) / 1000
      const fullResponse = responseBuffer.join('')

      // Display timing for winner
      if (isThisModelWinner) {
        outputHandler.writeNewline()
        outputHandler.write(`checkmark ${timing.toFixed(1)}s`)
        outputHandler.writeNewline()
      }

      // Cache is globally disabled - no caching

      return {
        model,
        response: fullResponse,
        timing,
        success: true,
        isWinner: isThisModelWinner,
      }
    } catch (error) {
      const timing = (Date.now() - startTime) / 1000

      if (error.message === 'AbortError' || error.name === 'AbortError') {
        return { model, timing, success: false, error: 'Request cancelled' }
      }

      return { model, timing, success: false, error: error.message }
    }
  },

  /**
   * Get model key for maps
   */
  getModelKey(model) {
    return `${model.provider}:${model.model}`
  },

  /**
   * Display model result (for non-winners)
   */
  displayModelResult(result) {
    const { model, response, timing, success, error } = result

    outputHandler.writeNewline()
    outputHandler.writeModel(model)

    if (success) {
      outputHandler.write(response)
      outputHandler.write(`checkmark ${timing.toFixed(1)}s`)
    } else {
      // Show clean error message to user (only if not cancelled)
      if (error !== 'Request cancelled') {
        outputHandler.writeError(error)
      }
      outputHandler.write(`${UI_SYMBOLS.CROSS} ${timing.toFixed(1)}s`)
    }

    outputHandler.writeNewline()
  },

  /**
   * Display final summary
   */
  displaySummary(cachedCount, liveCount, totalCount, stateManager) {
    if (totalCount > 1) {
      outputHandler.writeNewline()
      const respondedCount = cachedCount + liveCount
      outputHandler.write(`[${respondedCount}/${totalCount} models responded]`)
      
      // Display context dots after multi-model response
      outputHandler.writeContextDots(stateManager)
    }
  },
}
