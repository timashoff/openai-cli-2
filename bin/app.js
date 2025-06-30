#!/usr/bin/env node

import { rl, getClipboardContent, execModel, execHelp, initializeApi } from '../utils/index.js'
import { color } from '../config/color.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { INSTRUCTIONS, SYS_INSTRUCTIONS } from '../config/instructions.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import readline from 'node:readline'

let openai
let models = []
let model = ''
let requestController = null
const bufferSign = '$$'

async function switchProvider() {
  console.log('Please select an API provider:')
  const providerKeys = Object.keys(API_PROVIDERS)
  providerKeys.forEach((key, index) => {
    console.log(`[${index + 1}] ${API_PROVIDERS[key].name}`)
  })
  console.log('')

  const choice = await rl.question(
    `${color.green}Choose the provider number >${color.yellow} `,
  )
  const selectedProviderKey = providerKeys[+choice - 1]

  if (!selectedProviderKey) {
    console.log(`${color.red}Invalid selection. No changes made.${color.reset}`)
    return
  }

  openai = initializeApi(selectedProviderKey)
  const providerName = API_PROVIDERS[selectedProviderKey].name

  console.log(`Loading models from ${providerName}...`)
  try {
    const list = await openai.models.list()
    models = list.data.sort((a, b) => a.id.localeCompare(b.id))
    model = findModel(DEFAULT_MODELS, models)
    process.title = model
    console.log(
      `
Provider changed to ${color.cyan}${providerName}${color.reset}.`,
    )
    console.log(
      `Current model is now '${color.yellow}${model}${color.reset}'.
`,
    )
  } catch (e) {
    process.stdout.clearLine()
    process.stdout.cursorTo(0)
    console.log(` ${color.red}Error:${color.reset}`, e.message, ' ')
    // Exit if it's the initial load, otherwise just report error and continue
    if (!model) {
      process.exit(0)
    }
  }
}

let contextLength = 10

/* TODO: turn context on and off
let isContextEnabled = true
if (!isContextEnabled) {
   contextLength = 0
}
*/

async function main() {
  readline.emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit()
    }
    if (key.name === 'escape') {
      if (requestController) {
        requestController.abort()
        requestController = null
      }
    }
  })

  process.title = model
  const contextHistory = []

  while (true) {
    const colorInput = model.includes('chat') ? color.green : color.yellow
    rl.resume()
    let userInput = await rl.question(`${colorInput}> `)
    userInput = userInput.trim()
    const userInputWords = userInput.split(' ')

    if (!userInput) {
      if (contextHistory.length) {
        contextHistory.length = 0
        console.log(color.yellow + 'the context history is empty')
      } else setTimeout(() => process.stdout.write(' > '), 100) //clear the CLI window
      continue
    }

    if (userInputWords.length === 1 && isCommand(userInput)) {
      await exec(userInput)
      continue
    }

    if (userInput.includes(bufferSign)) {
      const buffer = await getClipboardContent()
      userInput = userInput.replace(bufferSign, '') + buffer
      console.log(buffer)
    }

    const input = findCommand(userInput) || userInput

    requestController = new AbortController()

    try {
      const messages = contextHistory.map(([role, content]) => ({
        role,
        content,
      }))
      messages.push({ role: 'user', content: input })

      console.time('time to respond')

      const stream = await openai.chat.completions.create(
        {
          model,
          messages, // messages: [{ role: 'user', content: input }],
          stream: true,
        },
        { signal: requestController.signal },
      )

      const response = []

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          response.push(content)
          process.stdout.write(color.reset + content)
        }
      }

      console.log('')

      contextHistory.push(['user', input], ['assistant', response.join('')])

      if (contextHistory.length > contextLength) contextHistory.splice(0, 2)

      const historyDots = '.'.repeat(contextHistory.length)
      console.log(color.yellow + historyDots + color.reset)
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(
          `
${color.yellow}Request cancelled.${color.reset}`,
        )
      } else {
        const errMessage = `${error.message.toLowerCase()} trying to reconect...`
        console.log(' 🤬' + color.red + errMessage + color.reset)
      }
    } finally {
      requestController = null
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

async function exec(str) {
  if (SYS_INSTRUCTIONS.EXIT.key.includes(str)) process.exit()
  if (SYS_INSTRUCTIONS.HELP.key.includes(str)) {
    execHelp()
    return
  }
  if (SYS_INSTRUCTIONS.PROVIDER.key.includes(str)) {
    await switchProvider()
    return
  }

  if (SYS_INSTRUCTIONS.MODEL.key.includes(str)) {
    rl.pause()
    const newModel = await execModel(model, models, rl)
    model = newModel
    process.title = model
    return
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

function findModel(defaultModels, models) {
  for (const defaultModel of defaultModels) {
    const currentModel = models.find((model) => model.id.includes(defaultModel))
    if (currentModel) {
      return currentModel.id
    }
  }
  return models[0].id
}

async function start() {
  await switchProvider()
  main()
}

start()
