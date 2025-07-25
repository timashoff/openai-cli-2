import { getDatabase } from './database-manager.js'
import { color } from '../config/color.js'

export async function migrateInstructionsToDatabase() {
  try {
    const db = getDatabase()
    
    // Check if we already have commands in database
    const existingCommands = db.getAllCommands()
    if (Object.keys(existingCommands).length > 0) {
      console.log(color.yellow + 'Database already contains commands, skipping migration' + color.reset)
      return
    }
    
    // Import instructions from file
    const { INSTRUCTIONS } = await import('../config/instructions.js')
    
    if (Object.keys(INSTRUCTIONS).length === 0) {
      console.log(color.yellow + 'No instructions found to migrate' + color.reset)
      return
    }
    
    console.log(color.cyan + 'Migrating commands from instructions.js to database...' + color.reset)
    
    // Migrate all instructions
    db.migrateFromInstructions(INSTRUCTIONS)
    
    console.log(color.green + `Successfully migrated ${Object.keys(INSTRUCTIONS).length} commands to database` + color.reset)
    
  } catch (error) {
    console.error(color.red + 'Failed to migrate instructions to database:', error.message + color.reset)
    throw error
  }
}

export function getInstructionsFromDatabase() {
  try {
    const db = getDatabase()
    return db.getAllCommands()
  } catch (error) {
    console.error(color.red + 'Failed to load instructions from database:', error.message + color.reset)
    return {}
  }
}