import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../utils/logger.js'
import { createBaseError, logError, processError } from '../core/error-system/index.js'

const dbPath = path.join(import.meta.dirname, '../db/commands.db')
const LEGACY_PROFILES_DIR = path.join(import.meta.dirname, '../config/agents')

const AGENT_PROFILES_SCHEMA = {
  tableName: 'agent_profiles',
  fields: {
    id: 'TEXT PRIMARY KEY',
    owner_id: 'TEXT DEFAULT NULL',
    name: 'TEXT NOT NULL',
    description: 'TEXT DEFAULT NULL',
    provider: 'TEXT NOT NULL',
    model: 'TEXT NOT NULL',
    instructions: 'TEXT NOT NULL',
    tools: "TEXT DEFAULT '[]'",
    metadata: "TEXT DEFAULT '{}'",
    created_at: "INTEGER DEFAULT (strftime('%s', 'now'))",
    updated_at: "INTEGER DEFAULT (strftime('%s', 'now'))",
  },
}

const RESERVED_METADATA_KEYS = new Set(['description'])

function createAgentProfileService() {
  let db = null
  let profilesCache = null
  let initialized = false

  function initDatabase() {
    db = new DatabaseSync(dbPath)
    createTables()
  }

  function createTables() {
    const fieldDefinitions = Object.entries(AGENT_PROFILES_SCHEMA.fields)
      .map(([name, type]) => `${name} ${type}`)
      .join(',\n ')

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${AGENT_PROFILES_SCHEMA.tableName} (
        ${fieldDefinitions}
      )
    `

    db.exec(createTableSQL)
  }

  function ensureInitialized() {
    if (initialized) {
      return
    }

    initDatabase()
    tryLegacyImport()
    bootstrapFromCommandsIfNeeded()
    normalizeExistingProfiles()
    initialized = true
    logger.debug('AgentProfileService: initialized')
  }

  function tryLegacyImport() {
    if (!fs.existsSync(LEGACY_PROFILES_DIR)) {
      return
    }

    const entries = fs.readdirSync(LEGACY_PROFILES_DIR, { withFileTypes: true })
    if (entries.length === 0) {
      return
    }

    const selectStmt = db.prepare(`SELECT COUNT(*) as count FROM ${AGENT_PROFILES_SCHEMA.tableName}`)
    const existingCount = selectStmt.get().count
    if (existingCount > 0) {
      return
    }

    logger.info('AgentProfileService: importing legacy JSON agent profiles')

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }

      const filePath = path.join(LEGACY_PROFILES_DIR, entry.name)
      try {
        const json = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        const normalized = normalizeProfile(json)
        upsertProfile(normalized)
      } catch (error) {
        logger.warn(`AgentProfileService: failed to import legacy profile ${entry.name}: ${error.message}`)
      }
    }

    logger.info('AgentProfileService: legacy import completed')
  }

  function bootstrapFromCommandsIfNeeded() {
    const countStmt = db.prepare(
      `SELECT COUNT(*) as count FROM ${AGENT_PROFILES_SCHEMA.tableName}`,
    )
    const existingCount = countStmt.get().count
    if (existingCount > 0) {
      return
    }

    const commandStmt = db.prepare(`SELECT id, name, description, instruction, models, key, command_type, agent_profile_id, input_mode FROM commands`)
    const commands = commandStmt.all()

    if (!commands || commands.length === 0) {
      return
    }

    logger.info('AgentProfileService: creating profiles from commands table')

    const updateCommandStmt = db.prepare(
      `UPDATE commands SET agent_profile_id = ?, command_type = COALESCE(command_type, 'agent'), input_mode = COALESCE(input_mode, 'text') WHERE id = ?`,
    )

    for (const command of commands) {
      if (!command.instruction) {
        logger.warn(
          `AgentProfileService: command ${command.id} skipped (no instruction available for profile)`,
        )
        continue
      }

      const models = parseCommandModels(command.models)
      const providerModel = models.find((item) => item && typeof item === 'object' && item.model)
      const originalProvider = providerModel?.provider || null
      const originalModel = providerModel?.model || null

      let derivedModel = null
      if (originalProvider === 'openai' && originalModel) {
        derivedModel = originalModel
      } else if (typeof models[0] === 'string' && models[0]) {
        derivedModel = models[0]
      }

      if (!derivedModel) {
        derivedModel = 'gpt-5-mini'
      }
      const keys = parseJsonArray(command.key)

      const description = command.description || null

      const profile = {
        id: command.id,
        name: command.name || command.id,
        description,
        provider: 'openai',
        model: derivedModel,
        instructions: command.instruction,
        tools: [],
        metadata: {
          commandKeys: keys,
          originalModels: models,
          originalProvider,
          originalModel,
        },
        owner_id: null,
      }

      try {
        upsertProfile(profile)
        updateCommandStmt.run(command.id, command.id)
      } catch (error) {
        logger.warn(
          `AgentProfileService: failed to bootstrap profile ${command.id}: ${error.message}`,
        )
      }
    }

    profilesCache = null
    logger.info('AgentProfileService: bootstrap from commands completed')
  }

  function normalizeProfile(rawProfile) {
    if (!rawProfile || typeof rawProfile !== 'object') {
      throw createBaseError('Invalid profile definition', true, 422)
    }

    const {
      id,
      name = rawProfile.id,
      description = rawProfile.metadata?.description || null,
      provider = rawProfile.provider || 'openai',
      model,
      instructions,
      tools = [],
      metadata = rawProfile.metadata || {},
      owner_id = null,
    } = rawProfile

    if (!id || !model || !instructions) {
      throw createBaseError('Profile missing required fields', true, 422)
    }

    const normalizedMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {}

    for (const reservedKey of RESERVED_METADATA_KEYS) {
      if (reservedKey in normalizedMetadata) {
        delete normalizedMetadata[reservedKey]
      }
    }

    let normalizedProvider = String(provider || 'openai').trim() || 'openai'
    let normalizedModel = model ? String(model).trim() : ''

    if (normalizedProvider !== 'openai') {
      if (!normalizedMetadata.originalProvider) {
        normalizedMetadata.originalProvider = normalizedProvider
      }
      if (normalizedModel && !normalizedMetadata.originalModel) {
        normalizedMetadata.originalModel = normalizedModel
      }
      normalizedProvider = 'openai'
      normalizedModel = ''
    }

    if (!normalizedModel) {
      normalizedModel = 'gpt-5-mini'
    }

    return {
      id: String(id).trim(),
      name: String(name || id).trim(),
      description: description ? String(description).trim() : null,
      provider: normalizedProvider,
      model: normalizedModel,
      instructions: String(instructions),
      tools,
      metadata: normalizedMetadata,
      owner_id,
    }
  }

  function serializeProfile(profile) {
    const toolsJson = JSON.stringify(profile.tools || [])
    const metadataJson = JSON.stringify(profile.metadata || {})

    return {
      ...profile,
      tools: toolsJson,
      metadata: metadataJson,
      description: profile.description || null,
      owner_id: profile.owner_id || null,
    }
  }

  function upsertProfile(profile) {
    const normalized = serializeProfile(profile)
    const insertFields = Object.keys(AGENT_PROFILES_SCHEMA.fields)
    const placeholders = insertFields.map(() => '?').join(', ')
    const updateFields = insertFields.filter((field) => field !== 'id' && field !== 'created_at')
    const updateClause = updateFields.map((field) => `${field} = excluded.${field}`).join(', ')

    const values = insertFields.map((field) => normalized[field] ?? null)
    const stmt = db.prepare(`
      INSERT INTO ${AGENT_PROFILES_SCHEMA.tableName} (${insertFields.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET
        ${updateClause},
        updated_at = strftime('%s', 'now')
    `)

    stmt.run(...values)
    profilesCache = null
  }

  function listProfiles({ ownerId = null } = {}) {
    ensureInitialized()
    const cacheKey = ownerId || '__all__'

    if (!profilesCache) {
      profilesCache = new Map()
    }

    if (profilesCache.has(cacheKey)) {
      return profilesCache.get(cacheKey)
    }

    const whereClause = ownerId ? 'WHERE owner_id = ? OR owner_id IS NULL' : ''
    const selectStmt = db.prepare(
      `SELECT * FROM ${AGENT_PROFILES_SCHEMA.tableName} ${whereClause} ORDER BY id`,
    )
    const rows = ownerId ? selectStmt.all(ownerId) : selectStmt.all()
    const result = rows.map(deserializeRow)
    profilesCache.set(cacheKey, result)
    return result
  }

  function deserializeRow(row) {
    return {
      id: row.id,
      owner_id: row.owner_id,
      name: row.name,
      description: row.description,
      provider: row.provider,
      model: row.model,
      instructions: row.instructions,
      tools: parseJsonArray(row.tools),
      metadata: parseJsonObject(row.metadata),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  function parseJsonArray(value) {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function parseCommandModels(value) {
    const parsed = parseJsonArray(value)
    return Array.isArray(parsed) ? parsed : []
  }

  function normalizeExistingProfiles() {
    const selectStmt = db.prepare(
      `SELECT * FROM ${AGENT_PROFILES_SCHEMA.tableName}`,
    )
    const rows = selectStmt.all()
    if (!rows || rows.length === 0) {
      return
    }

    let normalizedCount = 0
    for (const row of rows) {
      try {
        const profile = deserializeRow(row)
        const normalized = normalizeProfile(profile)

        const toolsChanged = JSON.stringify(normalized.tools || []) !== JSON.stringify(profile.tools || [])
        const metadataChanged = JSON.stringify(normalized.metadata || {}) !== JSON.stringify(profile.metadata || {})

        if (
          normalized.provider !== profile.provider ||
          normalized.model !== profile.model ||
          toolsChanged ||
          metadataChanged
        ) {
          upsertProfile(normalized)
          normalizedCount++
        }
      } catch (error) {
        logger.warn(
          `AgentProfileService: failed to normalize profile ${row.id}: ${error.message}`,
        )
      }
    }

    if (normalizedCount > 0) {
      profilesCache = null
      logger.info(
        `AgentProfileService: normalized ${normalizedCount} agent profile(s) for Responses API compatibility`,
      )
    }
  }

  function parseJsonObject(value) {
    if (!value) return {}
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function getProfile(id) {
    ensureInitialized()
    const stmt = db.prepare(`SELECT * FROM ${AGENT_PROFILES_SCHEMA.tableName} WHERE id = ?`)
    const row = stmt.get(id)
    return row ? deserializeRow(row) : null
  }

  function profileExists(id) {
    ensureInitialized()
    const stmt = db.prepare(`SELECT 1 FROM ${AGENT_PROFILES_SCHEMA.tableName} WHERE id = ? LIMIT 1`)
    return Boolean(stmt.get(id))
  }

  function createProfile(profile) {
    ensureInitialized()
    const normalized = normalizeProfile(profile)
    if (profileExists(normalized.id)) {
      throw createBaseError(`Agent profile ${normalized.id} already exists`, true, 409)
    }
    upsertProfile(normalized)
    return getProfile(normalized.id)
  }

  function updateProfile(id, profile) {
    ensureInitialized()
    if (!profileExists(id)) {
      throw createBaseError(`Agent profile ${id} not found`, true, 404)
    }
    const normalized = normalizeProfile({ ...profile, id })
    upsertProfile(normalized)
    return getProfile(id)
  }

  function deleteProfile(id) {
    ensureInitialized()
    const stmt = db.prepare(`DELETE FROM ${AGENT_PROFILES_SCHEMA.tableName} WHERE id = ?`)
    const result = stmt.run(id)
    profilesCache = null
    return result.changes > 0
  }

  async function safeExecute(operation, context) {
    try {
      return await operation()
    } catch (error) {
      const processed = await processError(error, context)
      await logError(processed)
      throw processed.originalError || error
    }
  }

  return {
    listProfiles: (options) => safeExecute(() => listProfiles(options), { context: 'AgentProfileService:listProfiles' }),
    getProfile: (id) => safeExecute(() => getProfile(id), { context: 'AgentProfileService:getProfile', id }),
    createProfile: (profile) => safeExecute(() => createProfile(profile), { context: 'AgentProfileService:createProfile' }),
    updateProfile: (id, profile) => safeExecute(() => updateProfile(id, profile), { context: 'AgentProfileService:updateProfile', id }),
    deleteProfile: (id) => safeExecute(() => deleteProfile(id), { context: 'AgentProfileService:deleteProfile', id }),
    profileExists: (id) => safeExecute(() => profileExists(id), { context: 'AgentProfileService:profileExists', id }),
    normalizeProfile,
  }
}

export const agentProfileService = createAgentProfileService()
