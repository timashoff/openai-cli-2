#!/usr/bin/env node

import { openai, rl, getBuffer, commandExists } from "../config/utils.js"
import { color } from '../config/consts.js'
import { INSTRUCTIONS } from '../config/instructions.js'

async function main() {
  const chatHistory = []

  while (true) {
    let userInput = await rl.question(`${color.green}> `)

    if (userInput.toLowerCase() === 'exit') {
      rl.close()
      return
    }

    if (!userInput || userInput.trim().split(' ').length < 2) {
      if (commandExists(userInput, INSTRUCTIONS.HELP.key)) {
        help(INSTRUCTIONS)
      }
      else if (chatHistory.length) {
        chatHistory.length = 0
        console.log(color.yellow + 'history context is empty')
      }
      continue
    }

    if (userInput.includes('$$')) {
      const buffer = await getBuffer()
      userInput = userInput.replace('$$', '') + buffer
      console.log(buffer)
    }


    const input = findCommand(userInput) || userInput

    try {
      const messages = chatHistory.map(([role, content]) => ({ role, content, }))
      messages.push({ role: 'user', content: input })

      console.time('time to respond')

      const stream = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages,   // messages: [{ role: 'user', content: input }],
        stream: true,
      })

      const response = []

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) response.push(content)
        process.stdout.write(content || `\n${color.reset}`)
      }

      chatHistory.push(['user', input], ['assistant', response.join('')])

      if (chatHistory.length > 4) chatHistory.splice(0, 2)

      const historyDots = '.'.repeat(chatHistory.length)
      console.log(color.yellow + historyDots + color.reset)
    }

    catch (error) {
      const errMessage = `${error.message.toLowerCase()} trying to reconect...`
      console.log('\n🤬' + color.red + errMessage + color.reset)
    }

    finally {
      console.timeEnd('time to respond')
      console.log('')
    }
  }

}

main()

// helpers

function findCommand(str) {
  const arr = str.trim().split(' ')
  const command = arr.shift()
  for (const prop in INSTRUCTIONS) {
    if (commandExists(command, INSTRUCTIONS[prop].key)) {
      const restString = arr.join(' ')
      return `${INSTRUCTIONS[prop].instruction}: ${restString}`
    }
  }
}

function help(obj) {
  const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b))
  const sortedObj = {}
  sortedKeys.forEach((key) => (sortedObj[key] = obj[key]))
  console.log('\n')
  for (let prop in sortedObj) {
    const command = color.cyan + sortedObj[prop].key.sort().reverse().join('  ') + color.reset
    console.log(
      color.reset + prop.toLowerCase().padEnd(20, ' '),
      command.padEnd(32, ' '),
      sortedObj[prop].description,
    )
  }
  console.log('')
}