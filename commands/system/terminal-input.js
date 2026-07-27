// No-dependency terminal input for `ai login`: a plain line read (email/code).
// The masked (hidden) variant died with the password layer (2026-07-27) —
// login is passwordless now. Colocated with the auth command that uses it.

import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'

export const promptLine = (label) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout })
    rl.question(label, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
