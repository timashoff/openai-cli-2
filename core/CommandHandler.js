/**
 * CommandHandler - Handles database instruction commands with multi-model support
 * Functional object (NO CLASSES per CLAUDE.md!)
 * Routes between single-model ChatRequest and multi-model MultiModelCommand
 */
import { logger } from '../utils/logger.js'
import { multiModelCommand } from '../commands/multi-model-command.js'

export function createCommandHandler(chatRequest, cacheManager) {
  
  /**
   * Handle instruction command from database with multi-model and cache support
   */
  async function handle(data, app) {
    const { content, userInput, isCached, isForced, models } = data
    
    logger.debug(`CommandHandler: Processing instruction command with ${models.length} model(s)`)
    
    // Route to appropriate handler based on model count
    if (models.length > 1) {
      logger.debug('CommandHandler: Routing to MultiModelCommand')
      return await multiModelCommand.execute(data, app, cacheManager)
    } else {
      logger.debug('CommandHandler: Routing to single ChatRequest')
      return await handleSingleModel(data, app)
    }
  }
  
  /**
   * Handle single model command with cache support
   * Uses unified cache API like MultiModelCommand
   */
  async function handleSingleModel(data, app) {
    const { content, userInput, isCached, isForced, commandId, models } = data
    
    // DEBUG: Log all data for debugging
    logger.debug('CommandHandler: handleSingleModel called with:', {
      commandId, 
      userInput,
      isCached,
      isForced,
      modelsCount: models.length,
      models: models
    })
    
    // CRITICAL FIX: Use correct model for caching
    let modelKey
    if (models.length === 1) {
      // Instruction command - use model from command
      modelKey = `${models[0].provider}:${models[0].model}`
      logger.debug(`CommandHandler: Using command model: ${modelKey}`)
    } else {
      // Direct chat (models: []) - use StateManager
      const stateManager = app.stateManager
      modelKey = `${stateManager.currentProvider}:${stateManager.currentModel}`
      logger.debug(`CommandHandler: Using StateManager model: ${modelKey}`)
    }
    
    // Check cache first (unless forced) using unified API
    if (isCached && !isForced) {
      const cacheKey = `${commandId || 'single'}:${userInput}:${modelKey}`
      logger.debug(`CommandHandler: Checking cache with key: ${cacheKey}`)
      
      const hasCachedResult = await cacheManager.hasCacheByModel(userInput, commandId || 'single', modelKey)
      logger.debug(`CommandHandler: Cache check result: ${hasCachedResult}`)
      
      if (hasCachedResult) {
        const cachedResult = await cacheManager.getCacheByModel(userInput, commandId || 'single', modelKey)
        logger.debug('CommandHandler: Single model cache hit - returning cached result')
        app.cliManager.writeOutput(cachedResult)
        return cachedResult
      } else {
        logger.debug('CommandHandler: Cache miss - proceeding to LLM request')
      }
    } else {
      logger.debug(`CommandHandler: Skipping cache check - isCached: ${isCached}, isForced: ${isForced}`)
    }
    
    // No cache or forced - send to ChatRequest
    const result = await chatRequest.processChatRequest(data)
    
    // Cache the result if needed using unified API
    if (isCached && result) {
      const cacheKey = `${commandId || 'single'}:${userInput}:${modelKey}`
      logger.debug(`CommandHandler: Caching result with key: ${cacheKey}`)
      await cacheManager.setCacheByModel(userInput, commandId || 'single', modelKey, result)
      logger.debug('CommandHandler: Result cached successfully')
    }
    
    return result
  }

  return {
    handle,
    handleSingleModel
  }
}