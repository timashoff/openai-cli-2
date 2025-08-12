import { color } from '../../config/color.js'
import { createInteractiveMenu } from '../interactive_menu.js'
import { createSelectionTitle } from '../menu-helpers.js'

export const execModel = async (currentModel, models, rl) => {
  console.log(
    color.reset +
      'Current model: ' +
      color.cyan +
      currentModel +
      color.reset + '\n'
  )

  // Handle both string arrays and object arrays for backward compatibility
  const modelOptions = models.map(model => typeof model === 'string' ? model : model.id)
  const currentModelIndex = modelOptions.findIndex(modelId => modelId === currentModel)
  
  const selectedIndex = await createInteractiveMenu(
    createSelectionTitle('model', models.length),
    modelOptions,
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
    return currentModel
  }
  
  const newModel = modelOptions[selectedIndex]
  console.log(
    color.reset +
      'Your model is now: ' +
      color.cyan +
      newModel +
      color.reset
  )
  return newModel
}
