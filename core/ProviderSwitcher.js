/**
 * ProviderSwitcher - Extracted provider and model switching logic from monolith decomposition
 * Handles all provider switching, model switching, and fallback logic
 */
import { logger } from '../utils/logger.js'
import { errorHandler } from '../core/error-system/index.js'
import { color } from '../config/color.js'

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

      const currentAIState = this.app.stateManager.getAIState()
      const newModel = await execModel(currentAIState.model, currentAIState.models, this.app.cliManager.rl)
      this.app.stateManager.updateModel(newModel)

      logger.debug(`Model changed to: ${newModel}`)

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

      // Instant switch without validation - errors will show during usage
      try {
        const switchResult = await this.app.serviceManager.switchProvider(selectedProvider.key)
        
        const newCurrentProvider = aiService.getCurrentProvider()
        this.app.stateManager.updateAIProvider({
          instance: newCurrentProvider.instance,
          key: newCurrentProvider.key,
          model: newCurrentProvider.model,
          models: switchResult.availableModels || []
        })

        // Simple confirmation message
        console.log(`Switched to ${selectedProvider.name}`)
        
        logger.debug(`Provider switched to: ${newCurrentProvider.key} with model: ${newCurrentProvider.model}`)
      } catch (switchError) {
        // Simple error message without retry loop
        console.log(`${color.red}Failed to switch to ${selectedProvider.name}: ${switchError.message}${color.reset}`)
      }

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