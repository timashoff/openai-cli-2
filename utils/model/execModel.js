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

  const modelOptions = models.map(model => model.id)
  const currentModelIndex = models.findIndex(model => model.id === currentModel)
  
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
  
  const newModel = models[selectedIndex].id
  console.log(
    color.reset +
      'Your model is now: ' +
      color.cyan +
      newModel +
      color.reset
  )
  return newModel
}
