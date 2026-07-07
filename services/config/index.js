import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../../utils/logger.js'
import { PROVIDERS } from '../../config/providers.js'
import { configFilePath, defaultConfigPath } from './paths.js'
import { loadConfigFile } from './loader.js'

// User config service: overlays ~/.openai-cli/config.toml onto the built-in
// provider defaults. Loaded once at startup — endpoint routing is fixed for the
// session (the provider client is built with its baseURL/credential up front),
// so there is deliberately no mtime hot-reload here (unlike commands.toml).
const createConfigService = () => {
  let overlay = {}
  let lastErrors = []
  let loadedOnce = false

  const load = () => {
    const { overlay: loaded, errors } = loadConfigFile(configFilePath())
    overlay = loaded
    lastErrors = errors
    loadedOnce = true
    if (errors.length > 0) {
      logger.warn(
        `config.toml: ${errors.length} problem(s); applying valid settings only (${errors[0]})`,
      )
    }
  }

  // Effective provider config = built-in defaults merged with the user overlay.
  // Returns undefined for an unknown provider (same contract as PROVIDERS[id]).
  const getProviderConfig = (providerId) => {
    if (!loadedOnce) load()
    const base = PROVIDERS[providerId]
    if (!base) return undefined
    const over = overlay[providerId]
    return over ? { ...base, ...over } : base
  }

  // A provider is usable if it has a gateway token OR its env API key is set.
  const isConfigured = (providerId) => {
    const cfg = getProviderConfig(providerId)
    if (!cfg) return false
    return Boolean(cfg.token) || Boolean(process.env[cfg.apiKeyEnv])
  }

  const availableProviders = () =>
    Object.keys(PROVIDERS).filter((id) => isConfigured(id))

  const getStatus = () => {
    if (!loadedOnce) load()
    const providers = Object.keys(PROVIDERS).map((id) => {
      const over = overlay[id] || {}
      return {
        id,
        baseURL: over.baseURL || null, // gateway URL if repointed, else null (direct)
        viaGateway: Boolean(over.baseURL),
        configured: isConfigured(id),
      }
    })
    return {
      path: configFilePath(),
      providers,
      errors: lastErrors,
    }
  }

  // Re-read the file (used by the `config` command after an edit).
  const reload = () => load()

  // Ensure config.toml exists by copying the shipped commented template on first
  // run, then load it. A missing template is non-fatal (everything stays direct).
  const bootstrap = async () => {
    const filePath = configFilePath()
    if (!fs.existsSync(filePath)) {
      const template = defaultConfigPath()
      if (fs.existsSync(template)) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.copyFileSync(template, filePath)
        logger.info(`Created ${filePath} from shipped template`)
      }
    }
    load()
  }

  return {
    getProviderConfig,
    availableProviders,
    getStatus,
    reload,
    bootstrap,
  }
}

export const configService = createConfigService()
