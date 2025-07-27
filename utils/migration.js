import { getDatabase } from './database-manager.js'
import { color } from '../config/color.js'

export async function migrateInstructionsToDatabase() {
  try {
    const db = getDatabase()
    
    // Check if we already have commands in database
    const existingCommands = db.getAllCommands()
    if (Object.keys(existingCommands).length > 0) {
      return // Silently skip migration if commands already exist
    }
    
    // Import instructions from file
    const { INSTRUCTIONS } = await import('../config/instructions.js')
    
    if (Object.keys(INSTRUCTIONS).length === 0) {
      return // Silently skip if no instructions to migrate
    }
    
    // Silently migrate all instructions
    db.migrateFromInstructions(INSTRUCTIONS)
    
  } catch (error) {
    // Only show error if something critical fails
    console.error(color.red + 'Failed to initialize commands' + color.reset)
    throw error
  }
}

export function getInstructionsFromDatabase() {
  try {
    const db = getDatabase()
    return db.getAllCommands()
  } catch (error) {
    // Silently return empty object if database fails
    return {}
  }
}