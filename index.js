import { openai } from "./config/openai.js"

async function main() {
  const chatCompletion = await openai.chat.completions.create(
    {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say this is a test' }],
    }
  )

  console.log('ai:', chatCompletion.choices[0].message.content)
  console.log('tokens$', chatCompletion.usage.total_tokens)
}

main()
