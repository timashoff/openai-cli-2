#!/usr/bin/env node

import { openai, rl, getBuffer, execModel, execHelp } from '../utils/index.js'
import { color } from '../config/color.js'
import { INSTRUCTIONS, SYS_INSTRUCTIONS } from '../config/instructions.js'

let models = []
let model = 'gpt-4o-mini'

let isUserInputEnabled = false
rl.pause()
const loading = () => {
  const loadingText = 'AI models are loading. Please wait... . . . '
  let index = 0
  let str = ''
  const intervalId = setInterval(() => {
    process.stdout.clearLine()
    process.stdout.cursorTo(0)
    str += loadingText[index]
    if (models.length) {
      clearInterval(intervalId)
      console.log(
        `\x1b[2J\x1b[0;0H${color.reset}Loading is complete! Type '${color.cyan}help${color.reset}' or '${color.cyan}hh${color.reset}' to see information`,
      )
      main()
      return
    }
    if (str.length === loadingText.length) str = ''
    process.stdout.write(`${color.orangeLight}${str}`)
    index = (index + 1) % loadingText.length
  }, 50)
  return
}
loading()
try {
  const list = await openai.models.list()
  models = list.data.filter(
    (model) => model.id.includes('o1') || model.id.includes('mini'),
  )
} catch (e) {
  process.stdout.clearLine()
  process.stdout.cursorTo(0)
  console.log(`\n${color.red}Error:${color.reset}`, e.message, '\n')
  process.exit(0)
}
isUserInputEnabled = true

let contextLength = 10

/* TODO: turn context on and off
let isContextEnabled = true
if (!isContextEnabled) {
   contextLength = 0
}
*/

async function main() {
  process.title = model
  const contextHistory = []
  const colorInput = model.includes('4o') ? color.green : color.yellow
  while (isUserInputEnabled) {
    rl.resume()
    let userInput = await rl.question(`${colorInput}> `)
    userInput = userInput.trim()
    const userInputWords = userInput.split(' ')

    if (!userInput) {
      if (contextHistory.length) {
        contextHistory.length = 0
        console.log(color.yellow + 'the context history is empty')
      } else setTimeout(() => process.stdout.write('\x1b[2J\x1b[0;0H> '), 100) //clear the CLI window
      continue
    }

    if (userInputWords.length === 1) {
      if (isCommand(userInput)) exec(userInput)
      continue
    }

    if (userInput.includes('$$')) {
      const buffer = await getBuffer()
      userInput = userInput.replace('$$', '') + buffer
      console.log(buffer)
    }

    const input = findCommand(userInput) || userInput

    try {
      const messages = contextHistory.map(([role, content]) => ({
        role,
        content,
      }))
      messages.push({ role: 'user', content: input })

      console.time('time to respond')

      const stream = await openai.chat.completions.create({
        model,
        messages, // messages: [{ role: 'user', content: input }],
        stream: true,
      })

      const response = []

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) response.push(content)
        process.stdout.write(content || `\n${color.reset}`)
      }

      contextHistory.push(['user', input], ['assistant', response.join('')])

      if (contextHistory.length > contextLength) contextHistory.splice(0, 2)

      const historyDots = '.'.repeat(contextHistory.length)
      console.log(color.yellow + historyDots + color.reset)
    } catch (error) {
      const errMessage = `${error.message.toLowerCase()} trying to reconect...`
      console.log('\n🤬' + color.red + errMessage + color.reset)
    } finally {
      console.timeEnd('time to respond')
      console.log('')
    }
  }
}

// helpers

function isCommand(str) {
  for (const prop in SYS_INSTRUCTIONS) {
    if (SYS_INSTRUCTIONS[prop].key.includes(str)) return true
  }
}

function exec(str) {
  if (SYS_INSTRUCTIONS.EXIT.key.includes(str)) process.exit()
  if (SYS_INSTRUCTIONS.HELP.key.includes(str)) execHelp()

  //TODO: implement execModel
  if (SYS_INSTRUCTIONS.MODEL.key.includes(str)) {
    console.log(
      color.reset +
        '\nYour current model is: ' +
        color.cyan +
        model +
        color.reset,
    )

    console.log('\nYou can choose another model:')

    isUserInputEnabled = false
    ;(async () => {
      models.forEach((model, indx) =>
        console.log(
          color.yellow + `[${indx + 1}]`.padStart(4, ' ') + color.reset,
          model.id,
        ),
      )
      isUserInputEnabled = true
      console.log('')

      const userInput = await rl.question(
        `${color.green}choose the model number >${color.yellow} `,
      )

      if (+userInput && +userInput <= models.length) {
        model = models[+userInput - 1].id
        console.log(
          color.reset +
            '\nNow your model is: ' +
            color.cyan +
            model +
            color.reset +
            '\n',
        )
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
            model +
            color.reset +
            '\n',
        )
      }
      main()
      return
    })()
  }

  /*TODO: turn context on and off
  if (SYS_INSTRUCTIONS.HISTORY.key.includes(str)) execContext(str)
  */
}

function findCommand(str) {
  const arr = str.trim().split(' ')
  const command = arr.shift()
  for (const prop in INSTRUCTIONS) {
    if (INSTRUCTIONS[prop].key.includes(command)) {
      const restString = arr.join(' ')
      return `${INSTRUCTIONS[prop].instruction}: ${restString}`
    }
  }
}
