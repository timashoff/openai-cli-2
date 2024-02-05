import OpenAI from 'openai';
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const rl = readline.createInterface({ input, output })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, })

export { rl, openai }