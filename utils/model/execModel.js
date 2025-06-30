import { color } from '../../config/color.js'

export const execModel = async (currentModel, models, rl) => {
  console.log(
    color.reset +
      '\nYour current model is: ' +
      color.cyan +
      currentModel +
      color.reset,
  )

  console.log('\nYou can choose another model:')

  models.forEach((model, indx) =>
    console.log(
      color.yellow + `[${indx + 1}]`.padStart(4, ' ') + color.reset,
      model.id,
    ),
  )
  console.log('')

  const userInput = await rl.question(
    `${color.green}choose the model number >${color.yellow} `,
  )

  if (+userInput && +userInput > 0 && +userInput <= models.length) {
    const newModel = models[+userInput - 1].id
    console.log(
      color.reset +
        '\nNow your model is: ' +
        color.cyan +
        newModel +
        color.reset +
        '\n',
    )
    return newModel
  } else {
    console.log(
      color.reset +
        '\nInput was not correct! You should use only numbers from ' +
        color.yellow +
        '1 ' +
        color.reset +
        'to ' +
        color.yellow +
        models.length +
        color.reset,
    )
    console.log(
      color.reset +
        'Your model stays at: ' +
        color.cyan +
        currentModel +
        color.reset +
        '\n',
    )
    return currentModel
  }
}