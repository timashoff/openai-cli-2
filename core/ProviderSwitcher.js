/**
 * ProviderSwitcher - Extracted provider and model switching logic from monolith decomposition
 * Handles all provider switching, model switching, and fallback logic
 */
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'

export class ProviderSwitcher {
  constructor(app) {
    this.app = app
  }

  /**
   * Switch AI model (extracted from original business logic)
   */
  async switchModel() {
    const { execModel } = await import('../utils/index.js')
    
    logger.debug('Starting model selection')
    try {
      const wasRawMode = process.stdin.isRaw
      // TEMPORARILY DISABLED - causes input doubling
      // if (process.stdin.isTTY && wasRawMode) {
      //   process.stdin.setRawMode(false)
      // }

      const newModel = await execModel(this.app.aiState.model, this.app.aiState.models, this.app.cliManager.rl)
      this.app.aiState.model = newModel
      process.title = this.app.aiState.model

      logger.debug(`Model changed to: ${this.app.aiState.model}`)

      // TEMPORARILY DISABLED - causes input doubling
      // if (process.stdin.isTTY && wasRawMode) {
      //   process.stdin.setRawMode(true)
      // }
    } catch (error) {
      errorHandler.handleError(error, { context: 'model_switch' })
      // TEMPORARILY DISABLED - causes input doubling
      // if (process.stdin.isTTY) {
      //   process.stdin.setRawMode(true)
      // }
    }
  }

  /**
   * Switch AI provider (extracted from original business logic with ServiceManager)
   */
  async switchProvider() {
    const { execProvider } = await import('../utils/provider/execProvider.js')
    
    logger.debug('Starting provider selection')
    try {
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      const aiService = this.app.serviceManager.getAIProviderService()
      if (!aiService) {
        throw new Error('AI provider service not available')
      }
      
      const availableProviders = aiService.getAvailableProviders()
      const currentProvider = aiService.getCurrentProvider()
      
      if (availableProviders.length === 0) {
        console.log('No providers available')
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }
      
      if (availableProviders.length === 1) {
        console.log(`Only one provider available: ${availableProviders[0].name}`)
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }

      const selectedProvider = await execProvider(currentProvider.key, availableProviders, this.app.cliManager.rl)
      
      if (!selectedProvider) {
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }

      if (selectedProvider.key === currentProvider.key) {
        console.log(`Already using ${selectedProvider.name}`)
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }

      // Switch to selected provider using ServiceManager
      const switchResult = await this.app.serviceManager.switchProvider(selectedProvider.key)
      
      const newCurrentProvider = aiService.getCurrentProvider()
      this.app.aiState.provider = newCurrentProvider.instance
      this.app.aiState.selectedProviderKey = newCurrentProvider.key
      this.app.aiState.model = newCurrentProvider.model
      this.app.aiState.models = switchResult.availableModels || []
      
      process.title = this.app.aiState.model

      logger.debug(`Provider switched to: ${newCurrentProvider.key} with model: ${newCurrentProvider.model}`)

      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(true)
      }
    } catch (error) {
      errorHandler.handleError(error, { context: 'provider_switch' })
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
    }
  }
}