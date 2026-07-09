import os from 'node:os'
import path from 'node:path'
import { USER_CONFIG } from '../../config/constants.js'

// Resolve the user config directory (~/.openai-cli by default).
export const configDir = () => path.join(os.homedir(), USER_CONFIG.DIR_NAME)

// Resolve the config.toml path. OPENAI_CLI_CONFIG overrides it (tests, custom setups).
export const configFilePath = () => {
  const override = process.env.OPENAI_CLI_CONFIG
  if (override) return override
  return path.join(configDir(), USER_CONFIG.CONFIG_FILE)
}

// Shipped commented template, copied to the user dir on first run.
export const defaultConfigPath = () =>
  path.join(import.meta.dirname, '../../config/config-default.toml')
