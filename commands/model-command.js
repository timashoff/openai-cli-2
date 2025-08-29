/**
 * model-command.js - Model switching command
 * Functional approach with clean interfaces (NO CLASSES per CLAUDE.md!)
 */
import { execModel } from '../utils/model/execModel.js'
import { outputHandler } from '../core/output-handler.js'

export const ModelCommand = {
  /**
   * Execute model switching command
   */
  async execute(args = [], context = {}) {
    try {
      // Use clean interfaces instead of God Object (context.app)
      const currentModel = context.models.getCurrent()
      const availableModels = context.models.getAvailable()
      
      // Check if we have a provider selected
      const currentProvider = context.providers.getCurrent()
      if (!currentProvider || !currentProvider.instance) {
        return outputHandler.formatError('No provider currently active')
      }
      
      // Check if we have models available
      if (!availableModels || availableModels.length === 0) {
        return outputHandler.formatWarning(`No models available for ${currentProvider.key}`)
      }

      // Handle direct model specification: "model gpt-4"
      if (args.length > 0) {
        const targetModelName = args[0]
        
        // Check if model exists (handle both string and object models)
        const modelExists = availableModels.some(m => {
          return typeof m === 'string' ? m === targetModelName : (m.id === targetModelName || m.name === targetModelName)
        })

        if (!modelExists) {
          const modelNames = availableModels
            .map(m => typeof m === 'string' ? m : m.id)
            .slice(0, 5)
            .join(', ')
          return outputHandler.formatError(`Model '${targetModelName}' not available. Available: ${modelNames}${availableModels.length > 5 ? '...' : ''}`)
        }

        if (targetModelName === currentModel) {
          return outputHandler.formatWarning(`Already using ${targetModelName}`)
        }

        // Switch to specified model through clean interface
        await context.models.switch(targetModelName)
        return outputHandler.formatSuccess(`Switched to ${targetModelName}`)
      }

      // Interactive model selection
      const result = await execModel(
        currentModel,
        availableModels,
        context.ui.readline
      )

      // Handle user cancellation (ESC)
      if (result.cancelled) {
        return null
      }

      // Check if user selected the same model
      if (result.model === currentModel) {
        return outputHandler.formatWarning(`Already using ${currentModel}`)
      }

      // Perform the switch through clean interface
      await context.models.switch(result.model)
      return outputHandler.formatSuccess(`Switched to ${result.model}`)

    } catch (error) {
      return outputHandler.formatError(error.message)
    }
  }
}