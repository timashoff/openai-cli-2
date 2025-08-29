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
  async function handle(commandData, app) {
    const { content, userInput, isCached, isForced, models } = commandData
    
    logger.debug(`CommandHandler: Processing instruction command with ${models.length} model(s)`)
    
    // Route to appropriate handler based on model count
    if (models.length > 1) {
      logger.debug('CommandHandler: Routing to MultiModelCommand')
      return await multiModelCommand.execute(commandData, app, cacheManager)
    } else {
      logger.debug('CommandHandler: Routing to single ChatRequest')
      return await handleSingleModel(commandData, app)
    }
  }
  
  /**
   * Handle single model command with cache support
   * Uses unified cache API like MultiModelCommand
   */
  async function handleSingleModel(commandData, app) {
    const { content, userInput, isCached, isForced, id, models } = commandData
    
    // DEBUG: Log all commandData for debugging
    logger.debug('CommandHandler: handleSingleModel called with:', {
      id, 
      userInput,
      isCached,
      isForced,
      modelsCount: models?.length || 0,
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
      const cacheKey = `${id || 'single'}:${userInput}:${modelKey}`
      logger.debug(`CommandHandler: Checking cache with key: ${cacheKey}`)
      
      const hasCachedResult = await cacheManager.hasCacheByModel(userInput, id || 'single', modelKey)
      logger.debug(`CommandHandler: Cache check result: ${hasCachedResult}`)
      
      if (hasCachedResult) {
        const cachedResult = await cacheManager.getCacheByModel(userInput, id || 'single', modelKey)
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
    const result = await chatRequest.processChatRequest(commandData, app.cliManager)
    
    // Cache the result if needed using unified API
    if (isCached && result) {
      const cacheKey = `${id || 'single'}:${userInput}:${modelKey}`
      logger.debug(`CommandHandler: Caching result with key: ${cacheKey}`)
      await cacheManager.setCacheByModel(userInput, id || 'single', modelKey, result)
      logger.debug('CommandHandler: Result cached successfully')
    }
    
    return result
  }

  return {
    handle,
    handleSingleModel
  }
}