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
    const { content, userInput, models } = data
    
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
    const { content, userInput, commandId, models } = data
    
    // DEBUG: Log all data for debugging
    logger.debug('CommandHandler: handleSingleModel called with:', {
      commandId, 
      userInput,
      modelsCount: models.length,
      models: models
    })
    
    // Cache is globally disabled - proceed directly to LLM request
    logger.debug('CommandHandler: Cache disabled globally - proceeding to LLM request')
    
    // Send directly to ChatRequest (cache disabled)
    return await chatRequest.processChatRequest(data)
  }

  return {
    handle,
    handleSingleModel
  }
}