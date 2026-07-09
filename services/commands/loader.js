import fs from 'node:fs'
import { parse } from 'smol-toml'
import { validateCommands } from './validate.js'

// Read + parse + validate the commands file synchronously.
// Returns { commands, errors, mtimeMs }. On any failure commands is {} and errors is populated.
export const loadCommandsFile = (filePath) => {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch (e) {
    return { commands: {}, errors: [`commands file not found: ${filePath}`], mtimeMs: 0 }
  }

  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    return {
      commands: {},
      errors: [`cannot read commands file: ${filePath}`],
      mtimeMs: stat.mtimeMs,
    }
  }

  let parsed
  try {
    parsed = parse(text)
  } catch (e) {
    const where =
      typeof e.line === 'number' ? ` (line ${e.line}, column ${e.column})` : ''
    return {
      commands: {},
      errors: [`TOML syntax error${where}: ${e.message}`],
      mtimeMs: stat.mtimeMs,
    }
  }

  const { commands, errors } = validateCommands(parsed)
  return { commands, errors, mtimeMs: stat.mtimeMs }
}
