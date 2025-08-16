#!/usr/bin/env node

import { getDatabase } from './database-manager.js'

/**
 * Migration script to add default models to existing commands
 */
async function migrateModels() {
  try {
    const db = getDatabase()
    
    // Define model configurations for existing commands
    const modelConfigurations = {
      // Multi-provider commands (aa, cc, rr)
      'ENGLISH': [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'deepseek', model: 'deepseek-chat' }
      ],
      'RUSSIAN': [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'deepseek', model: 'deepseek-chat' }
      ],
      'CHINESE': [
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'deepseek', model: 'deepseek-chat' }
      ],
      
      // Document command (doc)
      'DOC': [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' }
      ]
    }
    
    // Get all commands
    const commands = db.getCommandsFromDB()
    
    console.log('Migrating models for existing commands...')
    
    for (const [commandId, command] of Object.entries(commands)) {
      // Skip if models already configured
      if (command.models && command.models.length > 0) {
        console.log(`- ${commandId}: already has models configured, skipping`)
        continue
      }
      
      // Check if this command should get models
      const models = modelConfigurations[commandId]
      if (models) {
        // Update command with models
        db.saveCommand(commandId, command.key, command.description, command.instruction, models)
        console.log(`- ${commandId}: added ${models.length} model(s) - ${models.map(m => `${m.provider}:${m.model}`).join(', ')}`)
      } else {
        console.log(`- ${commandId}: no default models configured, leaving empty`)
      }
    }
    
    console.log('Migration completed successfully!')
    
  } catch (error) {
    console.error('Migration failed:', error.message)
    process.exit(1)
  }
}

// Run migration if this script is called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateModels()
}

export { migrateModels }