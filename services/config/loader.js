import fs from 'node:fs'
import { parse } from 'smol-toml'
import { validateUserConfig } from './validate.js'

// Read + parse + validate the user config file synchronously.
// Returns { overlay, errors }. A missing/unreadable file is NOT an error — it
// simply means "no overlay", i.e. every provider connects directly.
export const loadConfigFile = (filePath) => {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    return { overlay: {}, errors: [] }
  }

  let parsed
  try {
    parsed = parse(text)
  } catch (e) {
    const where =
      typeof e.line === 'number' ? ` (line ${e.line}, column ${e.column})` : ''
    return { overlay: {}, errors: [`TOML syntax error${where}: ${e.message}`] }
  }

  return validateUserConfig(parsed)
}
