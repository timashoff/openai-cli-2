#!/usr/bin/env node

import { openai, rl, getBuffer } from '../config/utils.js'
import { color } from '../config/color.js'
import { INSTRUCTIONS, SYS_INSTRUCTIONS } from '../config/instructions.js'

process.title = 'OpenAI_cli-tool'

let model = 'gpt-4o-mini'
let flag = true // let isUserInputEnabled = true
let historyLength = 10

/* TODO: turn history on and off
let historyON = true // let isHistoryEnabled = true
if (!historyON) {
   historyLength = 0
}
*/

async function main() {
  const chatHistory = []

  while (flag) {
    let userInput = await rl.question(`${color.green}> `)
    const userInputWords = userInput.trim().split(' ').length

    if (!userInput) {
      if (chatHistory.length) {
        chatHistory.length = 0
        console.log(color.yellow + 'history context is empty')
      }
      continue
    }

    if (userInputWords === 1) {
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
      const messages = chatHistory.map(([role, content]) => ({ role, content }))
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

      chatHistory.push(['user', input], ['assistant', response.join('')])

      if (chatHistory.length > historyLength) chatHistory.splice(0, 2)

      const historyDots = '.'.repeat(chatHistory.length)
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

main()

// helpers

function isCommand(str) {
  for (const prop in SYS_INSTRUCTIONS) {
    if (SYS_INSTRUCTIONS[prop].key.includes(str)) return true
  }
}

function exec(str) {
  if (SYS_INSTRUCTIONS.EXIT.key.includes(str)) process.exit()
  //TODO Refactor the code below
  if (SYS_INSTRUCTIONS.MODEL.key.includes(str)) {
    console.log(color.reset + '\nYour current model is: ' + color.cyan + model + color.reset)
    console.log('\nYou can choose another model:')
    flag = false
    ;(async () => {
      const list = await openai.models.list()
      const models = list.data.filter((model) => model.id.includes('gpt'))
      models.forEach((model, indx) =>
        console.log(color.yellow + `[${indx + 1}]`.padStart(4, ' ') + color.reset, model.id)
      )
      flag = true
      console.log('')
      const userInput = await rl.question(`${color.green}choose the model number >${color.yellow} `)
      if (+userInput && +userInput <= models.length) {
        model = models[+userInput - 1].id
        console.log(color.reset + '\nNow your model is: ' + color.cyan + model + color.reset + '\n')
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
            color.reset
        )
        console.log(color.reset + 'Your model stays at: ' + color.cyan + model + color.reset + '\n')
      }
      main()
      return
    })()
  }
  //TODO Refactor the code above

  /*TODO: turn history on and off
  if (SYS_INSTRUCTIONS.HISTORY.key.includes(str)) {
  //
  }
  */
  if (SYS_INSTRUCTIONS.HELP.key.includes(str)) {
    console.log(`\n${color.yellow}system:${color.reset}`)
    help(SYS_INSTRUCTIONS)
    console.log(`\n${color.yellow}openai prompts:${color.reset}`)
    help(INSTRUCTIONS)
    console.log('')
  }
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

function help(obj) {
  const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b))
  const sortedObj = {}
  sortedKeys.forEach((key) => (sortedObj[key] = obj[key]))
  for (let prop in sortedObj) {
    const command = color.cyan + sortedObj[prop].key.sort().reverse().join('  ') + color.reset
    console.log(
      color.reset + prop.toLowerCase().padEnd(20, ' '),
      command.padEnd(32, ' '),
      sortedObj[prop].description
    )
  }
}
