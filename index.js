import { openai, rl } from "./config/openai.js"

async function main() {

  const chatHistory = []

  while (true) {
    const userInput = await rl.question('\n\x1b[32m> ')

    if (userInput.toLowerCase() === 'exit') {
      rl.close()
      return
    }

    if (!userInput || userInput.trim().split(' ').length < 2) {
      console.error('\u001B[91mthe input must not be empty or shorter than 3 words')
      continue
    }

    try {
      const messages = chatHistory.map(([role, content]) => ({ role, content, }))
      messages.push({ role: 'user', content: userInput })

      const stream = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages,   // messages: [{ role: 'user', content: userInput }],
        stream: true,
      })
      console.time('time to respond')
      const response = []
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) response.push(content)
        process.stdout.write(content || '\n\x1b[0m')
      }
      console.timeEnd('time to respond')

      chatHistory.push(['user', userInput], ['assistant', response.join('')])

      if (chatHistory.length > 6) {
        chatHistory.splice(0, 2)
      }

      console.log(chatHistory.length)
    }
    catch (error) { console.error(error) }
  }

}
main()
