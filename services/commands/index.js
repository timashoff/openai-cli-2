import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../../utils/logger.js'
import { commandsFilePath, legacyDbPath } from './paths.js'
import { loadCommandsFile } from './loader.js'
import { migrateIfNeeded } from './migrate.js'
import { USER_CONFIG } from '../../config/constants.js'

const createCommandService = () => {
  let cache = {}
  let cacheMtimeMs = -1
  let lastErrors = []
  let loadedOnce = false

  const currentMtime = (filePath) => {
    try {
      return fs.statSync(filePath).mtimeMs
    } catch (e) {
      return 0
    }
  }

  // Reload only when the file's mtime changed. On error, keep the last-good set.
  const refreshIfChanged = () => {
    const filePath = commandsFilePath()
    const mtime = currentMtime(filePath)
    if (loadedOnce && mtime === cacheMtimeMs) return

    const { commands, errors, mtimeMs } = loadCommandsFile(filePath)
    cacheMtimeMs = mtimeMs
    loadedOnce = true
    lastErrors = errors

    if (errors.length > 0) {
      logger.warn(
        `commands.toml: ${errors.length} problem(s); keeping last-good set (${errors[0]})`,
      )
      return
    }
    cache = commands
  }

  const getCommands = () => {
    refreshIfChanged()
    return cache
  }

  const findByKey = (key) => {
    const commands = getCommands()
    for (const command of Object.values(commands)) {
      if (command.key.includes(key)) return command
    }
    return null
  }

  const hasCommand = (key) => findByKey(key) !== null

  const getAllKeys = () => {
    const commands = getCommands()
    return Object.values(commands).flatMap((command) => command.key)
  }

  const reload = () => {
    cacheMtimeMs = -1
    refreshIfChanged()
    return { ok: lastErrors.length === 0, errors: lastErrors }
  }

  const getStatus = () => {
    refreshIfChanged()
    return {
      path: commandsFilePath(),
      commandCount: Object.keys(cache).length,
      errors: lastErrors,
      ok: lastErrors.length === 0,
    }
  }

  const defaultCommandsPath = () =>
    path.join(import.meta.dirname, '../../config/commands-default.toml')

  // Ensure a commands.toml exists: migrate the legacy db once, else copy shipped defaults.
  const bootstrap = async () => {
    const tomlPath = commandsFilePath()
    if (fs.existsSync(tomlPath)) {
      refreshIfChanged()
      return
    }

    const dbPath = legacyDbPath()
    if (fs.existsSync(dbPath)) {
      const report = await migrateIfNeeded({
        dbPath,
        tomlPath,
        backupPath: dbPath + USER_CONFIG.BACKUP_SUFFIX,
      })
      if (report.migrated) {
        logger.info(
          `Migrated ${report.commandCount} command(s) to ${report.tomlPath}; legacy db saved as ${report.backup}`,
        )
      }
    } else {
      const defaults = defaultCommandsPath()
      if (fs.existsSync(defaults)) {
        fs.mkdirSync(path.dirname(tomlPath), { recursive: true })
        fs.copyFileSync(defaults, tomlPath)
        logger.info(`Created ${tomlPath} from shipped defaults`)
      }
    }

    refreshIfChanged()
  }

  return {
    getCommands,
    findByKey,
    hasCommand,
    getAllKeys,
    reload,
    getStatus,
    bootstrap,
  }
}

export const commandService = createCommandService()
