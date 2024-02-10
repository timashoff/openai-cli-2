#!/usr/bin/env node

import { openai, rl, getBuffer } from "../config/utils.js"

async function main() {
  const chatHistory = []

  while (true) {
    let userInput = await rl.question('\n\x1b[32m> ')

    if (userInput.toLowerCase() === 'exit') {
      rl.close()
      return
    }

    if (!userInput || userInput.trim().split(' ').length < 2) {
      chatHistory.length = 0
      console.error('\u001B[91mthe history context is empty')
      continue
    }

    if (userInput.includes('$$')) {
      const buffer = await getBuffer()
      userInput = userInput.replace('$$', '') + buffer
      console.log(buffer)
    }

    try {
      const messages = chatHistory.map(([role, content]) => ({ role, content, }))
      messages.push({ role: 'user', content: userInput })

      console.time('time to respond')

      const stream = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages,   // messages: [{ role: 'user', content: userInput }],
        stream: true,
      })

      const response = []

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) response.push(content)
        process.stdout.write(content || '\n\x1b[0m')
      }

      console.timeEnd('time to respond')

      chatHistory.push(['user', userInput], ['assistant', response.join('')])

      if (chatHistory.length > 4) {
        chatHistory.splice(0, 2)
      }

      console.log(chatHistory.length)
    }
    catch (error) { console.error(error) }
  }

}

main()
