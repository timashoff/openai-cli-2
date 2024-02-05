import { openai, rl } from "./config/openai.js"

async function main() {

  while (true) {
    const userInput = await rl.question('\n\x1b[32m> ')

    if (userInput.toLowerCase() === 'exit') {
      rl.close()
      return
    }

    if (!userInput || userInput.trim().split(' ').length < 3) {
      console.error('\u001B[91mthe input must not be empty or shorter than 3 words')
      continue
    }

    try {
      const stream = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages: [{ role: 'user', content: userInput }],
        stream: true,
      })
      console.time('time to respond')
      for await (const chunk of stream) {
        process.stdout.write(chunk.choices[0]?.delta?.content || '\n\x1b[0m')
      }
      console.timeEnd('time to respond')

    } catch (error) {
      console.error(error)
    }
  }

}
main()
