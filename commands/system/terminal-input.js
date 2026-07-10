// No-dependency terminal input for the auth commands (`ai login`, `ai reset`):
// a plain line read (email/code) and a masked read (password). The password is
// never echoed and never placed in argv. Backspace edits; Ctrl-C exits 130;
// Enter / Ctrl-D submit. Colocated with the auth commands that use it.

import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'

// Control characters built from code points (no literal control bytes in source).
const CTRL_C = String.fromCharCode(3)
const CTRL_D = String.fromCharCode(4)
const DEL = String.fromCharCode(127)
const BACKSPACE = String.fromCharCode(8)

export const promptLine = (label) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout })
    rl.question(label, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })

export const promptHidden = (label) =>
  new Promise((resolve) => {
    stdout.write(label)
    const wasRaw = Boolean(stdin.isRaw)
    stdin.setRawMode(true)
    stdin.resume()
    let buffer = ''

    const finish = (value) => {
      stdin.setRawMode(wasRaw)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdout.write('\n')
      resolve(value)
    }

    const onData = (chunk) => {
      const text = chunk.toString('utf8')
      for (const ch of text) {
        if (ch === '\r' || ch === '\n' || ch === CTRL_D) return finish(buffer)
        if (ch === CTRL_C) {
          stdin.setRawMode(wasRaw)
          process.exit(130)
        }
        if (ch === DEL || ch === BACKSPACE) {
          buffer = buffer.slice(0, -1)
          continue
        }
        buffer += ch
      }
    }

    stdin.on('data', onData)
  })
