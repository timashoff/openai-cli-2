#!/usr/bin/env node

import {
  rl,
  getClipboardContent,
  execModel,
  execHelp,
  initializeApi,
} from '../utils/index.js'
import { validateString, sanitizeString } from '../utils/validation.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { APP_COMMANDS, CLIPBOARD_MARKER, FORCE_FLAGS, SPINNER_FRAMES, TIMING_CONFIG } from '../config/app_constants.js'
import { validateApiKey, sanitizeErrorMessage, createSecureHeaders } from '../utils/security.js'
import { createInteractiveMenu } from '../utils/interactive_menu.js'
import { ApiHandler } from '../utils/api-handler.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import cache from '../utils/cache.js'
import { color } from '../config/color.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { INSTRUCTIONS, SYS_INSTRUCTIONS } from '../config/instructions.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { AppError, errorHandler } from '../utils/error-handler.js'
import readline from 'node:readline'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'

marked.setOptions({
  renderer: new TerminalRenderer(),
  gfm: true,
  breaks: true,
})

let openai
let models = []
let model = ''
let selectedProviderKey = ''
let requestController = null

async function switchProvider() {
  const providerKeys = Object.keys(API_PROVIDERS)
  const providerOptions = providerKeys.map((key) => API_PROVIDERS[key].name)

  const selectedIndex = await createInteractiveMenu(
    'Select an AI provider:',
    providerOptions,
  )

  if (selectedIndex === -1) {
    console.log(
      `${color.red}Selection cancelled. No changes made.${color.reset}`,
    )
    return
  }

  selectedProviderKey = providerKeys[selectedIndex]
  const apiHandler = new ApiHandler(selectedProviderKey)

  if (!API_PROVIDERS[selectedProviderKey]?.isClaude) {
    // Validate API key and initialize OpenAI client
    apiHandler.validateCurrentApiKey()
    openai = initializeApi(selectedProviderKey)
  }
  const providerName = API_PROVIDERS[selectedProviderKey].name

  console.log(`Loading models from ${providerName}...`)
  try {
    const list = await apiHandler.fetchModels(openai)
    models = list.data.sort((a, b) => a.id.localeCompare(b.id))
    model = findModel(DEFAULT_MODELS, models)
    process.title = model
    console.log(
      `\nProvider changed to ${color.cyan}${providerName}${color.reset}.`,
    )
    console.log(
      `Current model is now '${color.yellow}${model}${color.reset}'.\n`,
    )
  } catch (e) {
    process.stdout.clearLine()
    process.stdout.cursorTo(0)
    const sanitizedMessage = sanitizeErrorMessage(e.message)
    console.log(`\n${color.red}Error:${color.reset}`, sanitizedMessage, '\n')
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

function preProcessMarkdown(text) {
  // Remove common emoji ranges that might not render correctly
  const emojiRegex =
    /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g
  return text
    .replace(/•/g, '*')
    .replace(/\n{3,}/g, '\n\n')
    .replace(emojiRegex, '')
}

async function main() {
  let interval
  let startTime

  process.title = model
  const contextHistory = []

  while (true) {
    const colorInput = model.includes('chat') ? color.green : color.yellow
    let userInput = await rl.question(`${colorInput}> `)
    userInput = userInput.trim()

    if (!userInput) {
      if (contextHistory.length) {
        contextHistory.length = 0
        console.log(color.yellow + 'Context history cleared')
      } else setTimeout(() => process.stdout.write('\x1b[2J\x1b[0;0H> '), TIMING_CONFIG.CLEAR_TIMEOUT) //clear the CLI window
      continue
    }

    // Validate and sanitize user input
    try {
      userInput = sanitizeString(userInput)
      
      // Check input length limits
      if (userInput.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
        console.log(`${color.red}Error: Input too long (max ${APP_CONSTANTS.MAX_INPUT_LENGTH} characters)${color.reset}`)
        continue
      }
      
      validateString(userInput, 'user input', true)
    } catch (error) {
      console.log(`${color.red}Invalid input: ${error.message}${color.reset}`)
      continue
    }

    const userInputWords = userInput.split(' ')

    if (userInputWords.length === 1 && isCommand(userInput)) {
      await exec(userInput)
      continue
    }

    if (userInput.includes(CLIPBOARD_MARKER)) {
      try {
        const buffer = await getClipboardContent()
        
        // Validate and sanitize clipboard content
        const sanitizedBuffer = sanitizeString(buffer)
        validateString(sanitizedBuffer, 'clipboard content', false)
        
        // Check size limits
        if (sanitizedBuffer.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
          console.log(`${color.red}Error: Clipboard content too large (max ${APP_CONSTANTS.MAX_INPUT_LENGTH} characters)${color.reset}`)
          continue
        }
        
        // Replace clipboard marker with sanitized content
        userInput = userInput.replace(new RegExp(CLIPBOARD_MARKER.replace(/\$/g, '\\$'), 'g'), sanitizedBuffer)
        console.log(`${color.grey}[Clipboard content inserted (${sanitizedBuffer.length} chars)]${color.reset}`)
      } catch (error) {
        console.log(`${color.red}Error reading clipboard: ${error.message}${color.reset}`)
        continue
      }
    }

    let forceRequest = false
    for (const flag of FORCE_FLAGS) {
      if (userInput.endsWith(flag)) {
        forceRequest = true
        userInput = userInput.replace(new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '').trim()
        break
      }
    }

    const command = findCommand(userInput)
    const input = command ? command.fullInstruction : userInput

    if (command && command.isTranslation && !forceRequest && cache.has(input)) {
      console.log(`\n${color.yellow}[from cache]${color.reset}`)
      process.stdout.write(cache.get(input))
      console.log('\n')
      continue
    }

    requestController = new AbortController()

    const onKeyPress = (str, key) => {
      if (key.name === 'escape' && requestController) {
        requestController.abort()
      }
    }

    readline.emitKeypressEvents(process.stdin)
    const wasRaw = process.stdin.isRaw
    if (process.stdin.isTTY && !wasRaw) {
      process.stdin.setRawMode(true)
    }
    process.stdin.on('keypress', onKeyPress)

    try {
      let messages = []
      if (command && command.isTranslation) {
        messages = [{ role: 'user', content: input }]
      } else {
        messages = contextHistory.map(([role, content]) => ({
          role,
          content,
        }))
        messages.push({ role: 'user', content: input })
      }


      // Start timing before API request
      startTime = Date.now()

      const apiHandler = new ApiHandler(selectedProviderKey)
      const stream = await apiHandler.createChatStream(messages, model, requestController.signal, openai)

      let i = 0
      process.stdout.write('\x1B[?25l') // Hide cursor
      interval = setInterval(() => {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1)
        process.stdout.write(
          `${color.reset}${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${elapsedTime}s${color.reset}`,
        )
      }, TIMING_CONFIG.SPINNER_INTERVAL)

      const streamProcessor = new StreamProcessor(selectedProviderKey)
      const response = await streamProcessor.processStream(stream)

      clearInterval(interval)

      if (requestController.signal.aborted) {
        const finalTime = ((Date.now() - startTime) / 1000).toFixed(1)
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        console.log(`${color.red}☓${color.reset} ${finalTime}s\n`)
      } else {
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        const finalTime = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`${color.green}✓${color.reset} ${finalTime}s`)

        const fullResponse = response.join('')
        const processedResponse = preProcessMarkdown(fullResponse)
        const finalOutput = marked(processedResponse)

        for (let j = 0; j < finalOutput.length; j++) {
          process.stdout.write(finalOutput[j])
          await new Promise((resolve) => setTimeout(resolve, TIMING_CONFIG.TYPING_DELAY))
        }
        // New line after typing

        if (command && command.isTranslation) {
          await cache.set(input, fullResponse)
        } else {
          contextHistory.push(['user', input], ['assistant', fullResponse])
          if (contextHistory.length > contextLength) contextHistory.splice(0, 2)
          const historyDots = '.'.repeat(contextHistory.length)
          console.log(color.yellow + historyDots + color.reset)
        }
      }
    } catch (error) {
      if (interval) clearInterval(interval)
      process.stdout.write('')
      const finalTime = startTime
        ? ((Date.now() - startTime) / 1000).toFixed(1)
        : 'N/A'

      if (error.name === 'AbortError') {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        console.log(`${color.red}☓${color.reset} ${finalTime}s\n`)
      } else {
        const sanitizedMessage = sanitizeErrorMessage(error.message)
        const errMessage = `${sanitizedMessage.toLowerCase()} trying to reconnect...`
        console.log('\n🤬' + color.red + errMessage + color.reset)
      }
    } finally {
      process.stdin.removeListener('keypress', onKeyPress)
      if (process.stdin.isTTY && !wasRaw) {
        process.stdin.setRawMode(false)
      }
      requestController = null

      process.stdout.write('\x1B[?25h') // Show cursor
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
    try {
      // Temporarily disable raw mode for interactive menu
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      await switchProvider()

      // Restore raw mode
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(true)
      }
    } catch (error) {
      console.log(
        `${color.red}Error switching provider:${color.reset}`,
        error.message,
      )
      // Ensure raw mode is restored
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
    }
    return
  }

  if (SYS_INSTRUCTIONS.MODEL.key.includes(str)) {
    try {
      // Temporarily disable raw mode for interactive menu
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      const newModel = await execModel(model, models, rl)
      model = newModel
      process.title = model

      // Restore raw mode
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(true)
      }
    } catch (error) {
      console.log(
        `${color.red}Error selecting model:${color.reset}`,
        error.message,
      )
      // Ensure raw mode is restored
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
    }
    return
  }

  /*TODO: turn context on and off
  if (SYS_INSTRUCTIONS.HISTORY.key.includes(str)) execContext(str)
  */
}

const TRANSLATION_KEYS = [
  'RUSSIAN',
  'ENGLISH',
  'CHINESE',
  'PINYIN',
  'TRANSCRIPTION',
  'HSK',
  'HSK_SS',
]

function findCommand(str) {
  const arr = str.trim().split(' ')
  const commandKey = arr.shift()
  for (const prop in INSTRUCTIONS) {
    if (INSTRUCTIONS[prop].key.includes(commandKey)) {
      const restString = arr.join(' ')
      return {
        fullInstruction: `${INSTRUCTIONS[prop].instruction}: ${restString}`,
        isTranslation: TRANSLATION_KEYS.includes(prop),
      }
    }
  }
  return null
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
  await cache.initialize()
  await switchProvider()
  main()
}

start()
