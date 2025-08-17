import { color } from '../config/color.js'
import { createInteractiveMenu } from './interactive_menu.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { createProvider } from './provider-factory.js'

export class ModelSelector {
  constructor(aiApplication) {
    this.app = aiApplication
  }

  async selectModels(currentModels = [], rl = null) {
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

    // Adapt menu options based on current state
    const actions = ['Add model']
    
    // Only show "Remove model" if there are models to remove
    if (selectedModels.length > 0) {
      actions.push('Remove model')
      actions.push('Clear all models')
    }
    
    actions.push('Confirm selection')
    actions.push('Exit without saving')

    const selectedAction = await createInteractiveMenu(
      'What would you like to do?',
      actions
    )

    if (selectedAction === -1) {
      // Exit without saving
      return null
    }

    const selectedActionText = actions[selectedAction]
    
    switch (selectedActionText) {
      case 'Add model':
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

      case 'Remove model':
        // This should only be available when models exist (due to our menu logic)
        const removedModel = await this.selectModelToRemove(selectedModels)
        if (removedModel !== null) {
          selectedModels.splice(removedModel, 1)
          console.log(color.green + 'Model removed successfully!' + color.reset)
        }
        return this.selectModels(selectedModels)

      case 'Clear all models':
        selectedModels = []
        console.log(color.green + 'All models cleared!' + color.reset)
        return this.selectModels(selectedModels)

      case 'Confirm selection':
        return selectedModels

      case 'Exit without saving':
        return null

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
    console.log(color.cyan + '[DEBUG] selectModelToRemove called' + color.reset)
    console.log(color.grey + `[DEBUG] selectedModels: ${JSON.stringify(selectedModels)}` + color.reset)
    
    const modelLabels = selectedModels.map(
      (model, index) => `${index + 1}. ${model.provider} - ${model.model}`
    )
    
    console.log(color.grey + `[DEBUG] modelLabels: ${JSON.stringify(modelLabels)}` + color.reset)

    try {
      const removeIndex = await createInteractiveMenu(
        'Select model to remove:',
        modelLabels
      )
      
      console.log(color.grey + `[DEBUG] removeIndex returned: ${removeIndex}` + color.reset)

      if (removeIndex === -1) {
        console.log(color.yellow + '[DEBUG] User cancelled model removal' + color.reset)
        return null
      }

      console.log(color.green + `[DEBUG] Will remove model at index: ${removeIndex}` + color.reset)
      return removeIndex
    } catch (error) {
      console.log(color.red + `[DEBUG] Error in selectModelToRemove: ${error.message}` + color.reset)
      console.log(color.red + `[DEBUG] Error stack: ${error.stack}` + color.reset)
      return null
    }
  }

  async promptForInput(question, rl) {
    if (!rl) {
      throw new Error('Readline interface is required')
    }
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim())
      })
    })
  }
}

export const modelSelector = new ModelSelector()