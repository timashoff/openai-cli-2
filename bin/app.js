#!/usr/bin/env node

import { openai, rl, getBuffer } from '../config/utils.js'
import { color } from '../config/color.js'
import { INSTRUCTIONS, SYS_INSTRUCTIONS } from '../config/instructions.js'

process.title = 'OpenAI_cli-tool'

const historyLength = 10

async function main() {
  const chatHistory = []

  /*TODO Implement model selection
  const list = await openai.models.list()
  list.data.forEach((model) => {
    if (model.id.includes('gpt-4o')) console.log(model.id)
  })
  */
  while (true) {
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
        model: 'gpt-4o-mini',
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
