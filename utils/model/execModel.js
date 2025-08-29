import { color } from '../../config/color.js'
import { createInteractiveMenu } from '../interactive_menu.js'
import { createSelectionTitle } from '../menu-helpers.js'

export const execModel = async (currentModel, models, rl) => {
  // Handle both string arrays and object arrays for backward compatibility
  const modelOptions = models.map(model => typeof model === 'string' ? model : model.id)
  const currentModelIndex = modelOptions.findIndex(modelId => modelId === currentModel)
  
  // Add (current) marker to current model in the display list
  const displayOptions = modelOptions.map((model, index) => 
    index === currentModelIndex ? `${model} (current)` : model
  )
  
  const selectedIndex = await createInteractiveMenu(
    createSelectionTitle('model', models.length),
    displayOptions,
    currentModelIndex >= 0 ? currentModelIndex : 0
  )
  
  if (selectedIndex === -1) {
    console.log(
      color.reset +
        'Selection cancelled. Model remains: ' +
        color.cyan +
        currentModel +
        color.reset + '\n'
    )
    return { model: currentModel, cancelled: true }
  }
  
  const newModel = modelOptions[selectedIndex]
  return { model: newModel, cancelled: false }
}
