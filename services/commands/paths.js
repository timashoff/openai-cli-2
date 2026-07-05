import os from 'node:os'
import path from 'node:path'
import { USER_CONFIG } from '../../config/constants.js'

// Resolve the user commands directory (~/.openai-cli by default).
export const commandsDir = () => path.join(os.homedir(), USER_CONFIG.DIR_NAME)

// Resolve the commands.toml path. OPENAI_CLI_COMMANDS overrides it (tests, custom setups).
export const commandsFilePath = () => {
  const override = process.env.OPENAI_CLI_COMMANDS
  if (override) return override
  return path.join(commandsDir(), USER_CONFIG.COMMANDS_FILE)
}

// Legacy sqlite database shipped inside the project (source for one-time migration).
export const legacyDbPath = () =>
  path.join(import.meta.dirname, '../../db', USER_CONFIG.LEGACY_DB)
