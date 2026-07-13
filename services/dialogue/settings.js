import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { USER_CONFIG, DIALOGUE } from '../../config/constants.js'

// Persisted defaults for NEW dialogues (the settings screen would be a lie if it
// forgot on restart). A RESUMED dialogue always uses the pair/pivot stored in its
// own session record — its accumulated context is in those languages.

const settingsPath = () =>
  path.join(os.homedir(), USER_CONFIG.DIR_NAME, DIALOGUE.SETTINGS_FILE)

const defaults = () => ({
  pair: [...DIALOGUE.DEFAULT_PAIR],
  pivot: DIALOGUE.PIVOT_ENABLED,
  model: DIALOGUE.MODEL,
})

export const readSettings = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
    const fallback = defaults()
    const pair =
      Array.isArray(parsed.pair) && parsed.pair.length === 2 ? parsed.pair : fallback.pair
    const pivot = typeof parsed.pivot === 'boolean' ? parsed.pivot : fallback.pivot
    const model =
      typeof parsed.model === 'string' && parsed.model ? parsed.model : fallback.model
    return { pair, pivot, model }
  } catch (e) {
    return defaults()
  }
}

export const writeSettings = (settings) => {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 })
  } catch (e) {
    // settings are a convenience; failing to persist only costs the default next run
  }
}
