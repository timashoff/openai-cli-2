import OpenAI from 'openai'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { exec } from 'node:child_process'
import util from 'node:util'
import { platform } from 'node:os'

import { execModel } from './model/execModel.js'
import { execHelp } from './help/execHelp.js'
import cache from './cache.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { color } from '../config/color.js'
import { getAllSystemCommands } from './autocomplete.js'
import { AppError } from './error-handler.js'

const execution = util.promisify(exec)

const getClipboardContent = async () => {
  const os = platform()
  let command
  switch (os) {
    case 'darwin':
      command = 'pbpaste'
      break
    case 'linux':
      command = 'xclip -selection clipboard -o'
      break
    case 'win32':
      command = 'powershell.exe -command "Get-Clipboard"'
      break
    default:
      throw new Error(`Unsupported platform: ${os}`)
  }
  try {
    const { stdout } = await execution(command)
    return stdout.trim()
  } catch (error) {
    if (os === 'linux' && error.message.includes('command not found')) {
      console.error(
        'Error: "xclip" is not installed. Please install it to use clipboard functionality on Linux.',
      )
      return ''
    }
    throw error
  }
}

// Create completer function for system commands autocomplete
function completer(line) {
  const commands = getAllSystemCommands()
  const hits = commands.filter((cmd) => cmd.startsWith(line))
  // Show matches or all commands if no matches
  return [hits.length ? hits : [], line]
}

const rl = readline.createInterface({ 
  input, 
  output,
  completer
})

const initializeApi = (providerKey) => {
  const provider = API_PROVIDERS[providerKey]
  if (!provider) {
    console.log(`${color.red}Error: Invalid provider selected.${color.reset}`)
    process.exit(1)
  }

  const apiKey = process.env[provider.apiKeyEnv]
  if (!apiKey) {
    console.log(
      `${color.red}Error: API key for ${provider.name} not found.${color.reset}`,
    )
    console.log(`Please set the ${color.yellow}${provider.apiKeyEnv}${color.reset} environment variable.`)
    process.exit(1)
  }

  return new OpenAI({
    baseURL: provider.baseURL,
    apiKey: apiKey,
    timeout: 100 * 1000,
  })
}

export { rl, initializeApi, getClipboardContent, execModel, execHelp, cache }