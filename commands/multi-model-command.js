import { outputHandler } from '../core/output-handler.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { logger } from '../utils/logger.js'
import { createSpinner } from '../utils/spinner.js'
import { APP_CONSTANTS } from '../config/constants.js'

export const multiModelCommand = {
  /**
   * Execute multiple models in parallel with proper leaderboard and caching
   */
  async execute(commandData, app, cacheManager) {
    try {
      logger.debug(`MultiModelCommand: Executing ${commandData.models.length} models`)

      // Check cache for each model using proper CacheManager methods
      const cacheResults = await this.checkCacheForAllModels(commandData, commandData.userInput, cacheManager)

      // Separate cached and live models
      const { cachedModels, liveModels } = this.separateCachedAndLive(commandData.models, cacheResults)

      // Display cached results immediately (if any)
      if (cachedModels.length > 0) {
        this.displayCachedResults(cachedModels)
      }

      // Execute live models with race logic if any
      let completed = true
      let successfulLiveModels = 0
      if (liveModels.length > 0) {
        try {
          successfulLiveModels = await this.executeRaceWithStreaming(liveModels, commandData, app, cacheManager)
        } catch (error) {
          if (error.message === 'AbortError' || error.name === 'AbortError') {
            completed = false // Don't show summary if aborted
          } else {
            throw error
          }
        }
      }

      // Display final summary only if not aborted
      if (completed) {
        this.displaySummary(cachedModels.length, successfulLiveModels, commandData.models.length)
      }

    } catch (error) {
      logger.error(`MultiModelCommand: Execution failed: ${error.message}`)
      outputHandler.writeError(`Multi-model execution failed: ${error.message}`)
      throw error
    }
  },

  /**
   * Check cache for all models using proper CacheManager API
   */
  async checkCacheForAllModels(commandData, input, cacheManager) {
    const results = []

    for (const model of commandData.models) {
      try {
        // Use proper CacheManager method for per-model cache
        const hasCache = await cacheManager.hasCacheByModel(input, commandData.commandId, `${model.provider}:${model.model}`)

        if (hasCache) {
          const cachedResponse = await cacheManager.getCacheByModel(input, commandData.commandId, `${model.provider}:${model.model}`)
          results.push({ model, cached: cachedResponse, error: null })
        } else {
          results.push({ model, cached: null, error: null })
        }
      } catch (error) {
        logger.error(`MultiModelCommand: Cache check failed for ${model.provider}:${model.model}: ${error.message}`)
        results.push({ model, cached: null, error })
      }
    }

    return results
  },

  /**
   * Separate models into cached and live groups
   */
  separateCachedAndLive(models, cacheResults) {
    const cachedModels = []
    const liveModels = []

    cacheResults.forEach((result, index) => {
      const model = models[index]

      if (result.cached) {
        cachedModels.push({
          model,
          response: result.cached,
          source: 'cache'
        })
      } else {
        liveModels.push(model)
      }
    })

    logger.debug(`MultiModelCommand: ${cachedModels.length} cached, ${liveModels.length} live models`)
    return { cachedModels, liveModels }
  },

  /**
   * Display cached results immediately (clean text, no emojis)
   */
  displayCachedResults(cachedModels) {
    cachedModels.forEach(({ model, response }) => {
    const providerName =  model.provider

      // Clean header format
      outputHandler.writeNewline()
      outputHandler.write(`${providerName} (${model.model}):`)
      outputHandler.write(response)
      outputHandler.write(`[CACHED] 0.1s`)
      outputHandler.writeNewline()
    })
  },

  /**
   * Execute live models with race logic and proper streaming
   */
  async executeRaceWithStreaming(liveModels, commandData, app, cacheManager) {
    const stateManager = app.stateManager
    // const streamBuffers = new Map()
    const modelTimings = new Map()
    const modelResults = new Map()

    let firstModelStarted = false
    let winnerModel = null
    this.allModelsCompleted = false

    // Create and start spinner before any AI requests
    const spinner = createSpinner()
    const controller = stateManager.getCurrentRequestController()

    // Set abort signal in outputHandler to block output on ESC
    if (controller) {
      outputHandler.setAbortSignal(controller.signal)
      spinner.start(controller) // Show spinner with ESC handling
    }

    // Prepare messages with context
    const contextHistory = stateManager.getContextHistory()
    const messages = contextHistory.map(({ role, content }) => ({ role, content }))
    messages.push({ role: 'user', content: commandData.content }) // FIXED: use processed instruction!

    // Start all models in parallel
    const modelPromises = liveModels.map(async (model) => {
      const startTime = Date.now()
      modelTimings.set(`${model.provider}:${model.model}`, startTime)

      try {
        // Use the main AbortController from StateManager (connected to ESC key)
        const controller = stateManager.getCurrentRequestController()


        // if (!controller || !controller.signal) {
        if (!controller.signal) {
          throw new Error('AbortController not available from StateManager')
        }

        // Create streaming request directly via StateManager
        const stream = await stateManager.createChatCompletion(messages, {
          stream: true,
          signal: controller.signal
        }, model)

        const streamProcessor = new StreamProcessor(model.provider)
        const responseBuffer = []
        let isWinner = false

        const chunkHandler = async (content) => {
          if (controller.signal.aborted) return

          responseBuffer.push(content)

          // First chunk - determine winner
          if (!firstModelStarted && content && content.trim()) {
            firstModelStarted = true
            winnerModel = model
            isWinner = true

            // Stop spinner on first response
            if (spinner.isActive()) {
              spinner.stop('success')
            }

            // Display winner header
            const providerName =  model.provider
            outputHandler.writeNewline()
            outputHandler.write(`${providerName} (${model.model}):`)
          }

          // Stream content if this is the winner
          if (isWinner && content) {
            outputHandler.writeStream(content)
          }
        }

        // Process stream
        await streamProcessor.processStream(stream, controller.signal, chunkHandler)

        const timing = (Date.now() - startTime) / 1000
        const fullResponse = responseBuffer.join('')

        // Store result
        modelResults.set(`${model.provider}:${model.model}`, {
          response: fullResponse,
          timing,
          success: true
        })

        // Cache the response
        if (commandData.isCached && fullResponse) {
          await cacheManager.setCacheByModel(commandData.userInput, commandData.commandId, `${model.provider}:${model.model}`, fullResponse)
        }

        // Display timing if winner
        if (isWinner) {
          outputHandler.writeNewline()
          outputHandler.write(`checkmark ${timing.toFixed(1)}s`)
          outputHandler.writeNewline()
          
          // Start spinner for remaining models if there are any
          const remainingModelsCount = liveModels.length - 1
          if (remainingModelsCount > 0) {
            // Check if we should show "Waiting..." message based on timing gap
            setTimeout(() => {
              // Only show spinner if still waiting after 1 second
              if (!this.allModelsCompleted) {
                const remainingSpinner = createSpinner()
                remainingSpinner.start(controller)
                
                // Store spinner reference for cleanup
                this.remainingSpinner = remainingSpinner
                outputHandler.write(`Waiting for ${remainingModelsCount} more model${remainingModelsCount > 1 ? 's' : ''}...`)
              }
            }, APP_CONSTANTS.MULTI_MODEL_WAIT_THRESHOLD)
          }
        }

        return { model, timing, success: true, isWinner }

      } catch (error) {
        const timing = (Date.now() - startTime) / 1000

        // Handle user cancellation silently
        if (error.message === 'AbortError' || error.name === 'AbortError') {
          modelResults.set(`${model.provider}:${model.model}`, {
            timing,
            success: false,
            error: 'Request cancelled'
          })
          return { model, timing, success: false, error: 'Request cancelled' }
        }

        // Log only real errors, not user cancellations
        logger.error(`MultiModelCommand: Model ${model.provider}:${model.model} failed: ${error.message}`)

        modelResults.set(`${model.provider}:${model.model}`, {
          timing,
          success: false,
          error: error.message
        })

        return { model, timing, success: false, error: error.message }
      }
    })

    // Wait for all models to complete
    const results = await Promise.allSettled(modelPromises)
    
    // Mark all models as completed to prevent delayed spinner
    this.allModelsCompleted = true

    // Cleanup main spinner if still active
    if (spinner.isActive()) {
      spinner.stop('error') // No models responded
    }
    spinner.dispose()
    
    // Cleanup remaining models spinner if active
    if (this.remainingSpinner && this.remainingSpinner.isActive()) {
      this.remainingSpinner.stop('success')
      this.remainingSpinner.dispose()
    }

    // Don't display results if request was aborted
    // if (controller && controller.signal && controller.signal.aborted) {
    if (controller.signal.aborted) {
      throw new Error('AbortError') // Signal to parent that execution was aborted
    }

    // Display non-winner results
    this.displayRemainingResults(liveModels, modelResults, winnerModel)
    
    // Count successful responses for accurate summary
    const successfulLiveModels = Array.from(modelResults.values()).filter(result => result.success).length
    
    return successfulLiveModels // Return count for summary
  },

  /**
   * Display results from non-winner models
   */
  displayRemainingResults(liveModels, modelResults, winnerModel) {
    liveModels.forEach(model => {
      const modelKey = `${model.provider}:${model.model}`

      // Skip winner (already displayed)
      if (winnerModel && modelKey === `${winnerModel.provider}:${winnerModel.model}`) {
        return
      }

      const result = modelResults.get(modelKey)
      if (!result) return

      const providerName = model.provider

      outputHandler.writeNewline()
      outputHandler.write(`${providerName} (${model.model}):`)

      if (result.success) {
        outputHandler.write(result.response)
        outputHandler.write(`checkmark ${result.timing.toFixed(1)}s`)
      } else {
        // Don't show cancelled requests as failures
        if (result.error !== 'Request cancelled') {
          outputHandler.writeError(`Failed: ${result.error}`)
        }
        outputHandler.write(`x ${result.timing.toFixed(1)}s`)
      }

      outputHandler.writeNewline()
    })
  },

  /**
   * Display final summary (clean text, no emojis)
   */
  displaySummary(cachedCount, liveCount, totalCount) {
    if (totalCount > 1) {
      outputHandler.writeNewline()

      const respondedCount = cachedCount + liveCount
      //strange code alert! 🚨
      if (respondedCount === totalCount) {
        outputHandler.write(`[${respondedCount}/${totalCount} models responded]`)
      } else {
        outputHandler.write(`[${respondedCount}/${totalCount} models responded]`)
      }
    }
  }
}
