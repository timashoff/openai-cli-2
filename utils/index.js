import OpenAI from 'openai'

import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { exec } from 'node:child_process'
import util from 'node:util'

import { execModel } from './model/execModel.js'
import { execHelp } from './help/execHelp.js'

const execution = util.promisify(exec)
//change the variable name getBuffer to clipboard
const getBuffer = async () => {
  const { stdout, _stderr } = await execution('pbpaste')
  return stdout.trim()
}

const rl = readline.createInterface({ input, output })

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
  // apiKey: process.env.OPENAI_API_KEY,
  timeout: 10 * 1000,
})

export { rl, openai, getBuffer, execModel, execHelp }
