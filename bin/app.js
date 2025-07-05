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
import { validateApiKey, sanitizeErrorMessage, createSecureHeaders } from '../utils/security.js'
import { createInteractiveMenu } from '../utils/interactive_menu.js'
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

  if (!API_PROVIDERS[selectedProviderKey]?.isClaude) {
    openai = initializeApi(selectedProviderKey)
  }
  const providerName = API_PROVIDERS[selectedProviderKey].name

  console.log(`Loading models from ${providerName}...`)
  try {
    let list
    if (API_PROVIDERS[selectedProviderKey]?.isClaude) {
      const apiKey = process.env.ANTHROPIC_API_KEY
      validateApiKey(apiKey, 'anthropic')
      
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: createSecureHeaders(apiKey, 'anthropic')
      })
      list = await response.json()
      if (!response.ok) {
        throw new Error(list.error.message)
      }
    } else {
      list = await openai.models.list()
    }
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
      } else setTimeout(() => process.stdout.write('\x1b[2J\x1b[0;0H> '), 100) //clear the CLI window
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

    if (userInput.includes('$$')) {
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
        
        // Replace $$ with sanitized content
        userInput = userInput.replace(/\$\$/g, sanitizedBuffer)
        console.log(`${color.grey}[Clipboard content inserted (${sanitizedBuffer.length} chars)]${color.reset}`)
      } catch (error) {
        console.log(`${color.red}Error reading clipboard: ${error.message}${color.reset}`)
        continue
      }
    }

    let forceRequest = false
    if (userInput.endsWith(' --force') || userInput.endsWith(' -f')) {
      forceRequest = true
      userInput = userInput.replace(/ --force$| -f$/, '').trim()
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

      const isClaude = API_PROVIDERS[selectedProviderKey]?.isClaude;

      // Start timing before API request
      startTime = Date.now()

      let stream;
      if (isClaude) {
        const apiKey = process.env.ANTHROPIC_API_KEY
        validateApiKey(apiKey, 'anthropic')
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: createSecureHeaders(apiKey, 'anthropic'),
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          max_tokens: 4096
        }),
        signal: requestController.signal
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error.message)
      }
      stream = response.body
      } else {
        stream = await openai.chat.completions.create(
          {
            model,
            messages,
            stream: true,
          },
          { signal: requestController.signal },
        );
      }

      const response = []
      const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      let i = 0
      process.stdout.write('\x1B[?25l') // Hide cursor
      interval = setInterval(() => {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1)
        process.stdout.write(
          `${color.reset}${spinner[i++ % spinner.length]} ${elapsedTime}s${color.reset}`,
        )
      }, 100)

      if (isClaude) {
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let done = false
        let buffer = ''
        
        while (!done) {
          const { value, done: readerDone } = await reader.read()
          done = readerDone
          
          if (value) {
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            
            // Keep the last incomplete line in buffer
            buffer = lines.pop() || ''
            
            for (const line of lines) {
              const trimmedLine = line.trim()
              
              // Skip empty lines and comments
              if (!trimmedLine || trimmedLine.startsWith(':')) {
                continue
              }
              
              if (trimmedLine.startsWith('data: ')) {
                const data = trimmedLine.substring(6).trim()
                
                // Check for end of stream
                if (data === '[DONE]') {
                  done = true
                  break
                }
                
                // Skip empty data
                if (!data) {
                  continue
                }
                
                try {
                  const json = JSON.parse(data)
                  
                  // Handle different event types
                  if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
                    response.push(json.delta.text)
                  } else if (json.delta && json.delta.text) {
                    // Fallback for older format
                    response.push(json.delta.text)
                  }
                } catch (e) {
                  // Only log if it's not a known non-JSON line
                  if (data !== '[DONE]' && !data.startsWith('event:')) {
                    console.error('JSON parsing error in Claude stream:', e.message, 'Data:', data.substring(0, 100))
                  }
                }
              }
            }
          }
        }
      } else {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            response.push(content)
          }
        }
      }

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
          await new Promise((resolve) => setTimeout(resolve, 10)) // Adjust delay as needed
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
