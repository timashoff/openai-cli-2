import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  const chatCompletion = await openai.chat.completions.create(
    {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say this is a test' }],
    }
  )

  console.log(chatCompletion.choices[0].message)
}

main()
