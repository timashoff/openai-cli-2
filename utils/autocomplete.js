import { SYS_INSTRUCTIONS } from '../config/instructions.js'

/**
 * Get all system commands
 * @returns {string[]} array of all system commands
 */
function getAllSystemCommands() {
  const commands = []
  
  for (const prop in SYS_INSTRUCTIONS) {
    const instruction = SYS_INSTRUCTIONS[prop]
    if (instruction.key && Array.isArray(instruction.key)) {
      commands.push(...instruction.key)
    }
  }
  
  return commands.sort()
}


export { getAllSystemCommands }
