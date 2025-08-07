import { color } from '../config/color.js'
import { createInteractiveMenu } from './interactive_menu.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { createProvider } from './provider-factory.js'
import { rl } from './index.js'

export class ModelSelector {
  constructor(aiApplication) {
    this.app = aiApplication
  }

  async selectModels(currentModels = []) {
    let selectedModels = [...currentModels]
    
    console.log(color.cyan + 'Model Selection Menu' + color.reset)
    console.log('')
    
    if (selectedModels.length > 0) {
      console.log(color.yellow + 'Currently selected models:' + color.reset)
      selectedModels.forEach((model, index) => {
        console.log(`  ${index + 1}. ${model.provider} - ${model.model}`)
      })
      console.log('')
    } else {
      console.log(color.gray + 'No models selected yet.' + color.reset)
      console.log('')
    }

    const actions = [
      'Add model',
      'Remove model',
      'Clear all models',
      'Confirm selection',
      'Exit without saving'
    ]

    const selectedAction = await createInteractiveMenu(
      'What would you like to do?',
      actions
    )

    if (selectedAction === -1 || selectedAction === 4) {
      // Exit without saving
      return null
    }

    switch (selectedAction) {
      case 0: // Add model
        const newModel = await this.selectSingleModel()
        if (newModel) {
          // Check if model already selected
          const exists = selectedModels.some(
            m => m.provider === newModel.provider && m.model === newModel.model
          )
          if (!exists) {
            selectedModels.push(newModel)
            console.log(color.green + `Added: ${newModel.provider} - ${newModel.model}` + color.reset)
          } else {
            console.log(color.yellow + 'Model already selected!' + color.reset)
          }
        }
        // Continue loop
        return this.selectModels(selectedModels)

      case 1: // Remove model
        if (selectedModels.length === 0) {
          console.log(color.yellow + 'No models to remove!' + color.reset)
          return this.selectModels(selectedModels)
        }
        const removedModel = await this.selectModelToRemove(selectedModels)
        if (removedModel !== null) {
          selectedModels.splice(removedModel, 1)
          console.log(color.green + 'Model removed successfully!' + color.reset)
        }
        return this.selectModels(selectedModels)

      case 2: // Clear all
        selectedModels = []
        console.log(color.green + 'All models cleared!' + color.reset)
        return this.selectModels(selectedModels)

      case 3: // Confirm
        return selectedModels

      default:
        return null
    }
  }

  async selectSingleModel() {
    // Step 1: Select provider
    const providerKeys = Object.keys(API_PROVIDERS)
    const providerNames = providerKeys.map(key => API_PROVIDERS[key].name)

    const providerIndex = await createInteractiveMenu(
      'Select a provider:',
      providerNames
    )

    if (providerIndex === -1) {
      return null
    }

    const selectedProviderKey = providerKeys[providerIndex]
    const providerConfig = API_PROVIDERS[selectedProviderKey]

    // Step 2: Load models for selected provider
    try {
      console.log(`Loading models for ${providerConfig.name}...`)
      
      const provider = createProvider(selectedProviderKey, providerConfig)
      await provider.initializeClient()
      const models = await provider.listModels()

      if (models.length === 0) {
        console.log(color.yellow + 'No models available for this provider!' + color.reset)
        return null
      }

      // Step 3: Select model
      const modelOptions = models.map(model => model.id)
      const modelIndex = await createInteractiveMenu(
        `Select a model from ${providerConfig.name}:`,
        modelOptions
      )

      if (modelIndex === -1) {
        return null
      }

      return {
        provider: selectedProviderKey,
        model: models[modelIndex].id
      }

    } catch (error) {
      console.log(color.red + `Error loading models: ${error.message}` + color.reset)
      return null
    }
  }

  async selectModelToRemove(selectedModels) {
    const modelLabels = selectedModels.map(
      (model, index) => `${index + 1}. ${model.provider} - ${model.model}`
    )

    const removeIndex = await createInteractiveMenu(
      'Select model to remove:',
      modelLabels
    )

    if (removeIndex === -1) {
      return null
    }

    return removeIndex
  }

  async promptForInput(question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim())
      })
    })
  }
}

export const modelSelector = new ModelSelector()