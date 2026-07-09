import { PROVIDERS } from '../../config/providers.js'
import { getAllSystemCommandNames } from '../../utils/system-commands.js'

const VALID_PROVIDERS = Object.keys(PROVIDERS)

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim() !== ''

// Validate a parsed commands table. Returns { commands, errors }.
// commands: { id: { id, key, description, instruction, models, context } } (valid entries only).
// errors: array of human-readable messages (all problems collected, not just the first).
export const validateCommands = (parsed) => {
  const errors = []
  const commands = {}
  const seenAliases = new Map()
  const systemNames = new Set(getAllSystemCommandNames())

  const table = parsed && parsed.commands ? parsed.commands : {}

  for (const [id, raw] of Object.entries(table)) {
    const where = `[commands.${id}]`

    if (!Array.isArray(raw.key) || raw.key.length === 0) {
      errors.push(`${where}: "key" must be a non-empty array of alias strings`)
      continue
    }
    if (raw.key.some((alias) => !isNonEmptyString(alias))) {
      errors.push(`${where}: "key" contains empty or non-string aliases`)
      continue
    }

    if (!isNonEmptyString(raw.instruction)) {
      errors.push(`${where}: "instruction" is required and must be a non-empty string`)
      continue
    }

    let models = []
    if (raw.models !== undefined) {
      if (!Array.isArray(raw.models)) {
        errors.push(`${where}: "models" must be an array`)
        continue
      }
      let modelsOk = true
      for (const m of raw.models) {
        if (!m || typeof m.provider !== 'string' || typeof m.model !== 'string') {
          errors.push(`${where}: each model needs string "provider" and "model"`)
          modelsOk = false
          break
        }
        if (!VALID_PROVIDERS.includes(m.provider)) {
          errors.push(
            `${where}: unknown provider "${m.provider}" (known: ${VALID_PROVIDERS.join(', ')})`,
          )
          modelsOk = false
          break
        }
      }
      if (!modelsOk) continue
      models = raw.models.map((m) => ({ provider: m.provider, model: m.model }))
    }

    let aliasOk = true
    for (const alias of raw.key) {
      if (systemNames.has(alias)) {
        errors.push(`${where}: alias "${alias}" collides with a system command`)
        aliasOk = false
      } else if (seenAliases.has(alias)) {
        errors.push(
          `${where}: alias "${alias}" already used by [commands.${seenAliases.get(alias)}]`,
        )
        aliasOk = false
      }
    }
    if (!aliasOk) continue
    for (const alias of raw.key) seenAliases.set(alias, id)

    commands[id] = {
      id,
      key: raw.key,
      description: typeof raw.description === 'string' ? raw.description : '',
      instruction: raw.instruction,
      models,
      context: raw.context === true,
    }
  }

  return { commands, errors }
}
