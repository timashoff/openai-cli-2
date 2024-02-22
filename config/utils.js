import OpenAI from 'openai';
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { exec } from 'node:child_process'
import util from 'node:util'

const execution = util.promisify(exec)
const getBuffer = async () => {
  const { stdout, stderr } = await execution('pbpaste')
  return stdout.trim()
}

const rl = readline.createInterface({ input, output })

const openai = new OpenAI(
  {
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 2 * 1000,
  }
)

const commandExists = (str, arr) => arr.includes(str)

export { rl, openai, getBuffer, commandExists }