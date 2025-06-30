import OpenAI from 'openai'

import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { exec } from 'node:child_process'
import util from 'node:util'
import { platform } from 'node:os'

import { execModel } from './model/execModel.js'
import { execHelp } from './help/execHelp.js'

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

const rl = readline.createInterface({ input, output })

const openai = new OpenAI({
  /*TODO
  implement a toggle between a few APIs
  */
  // baseURL: 'https://api.deepseek.com/v1',
  // apiKey: process.env.DEEPSEEK_API_KEY,
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 100 * 1000,
})

export { rl, openai, getClipboardContent, execModel, execHelp }
