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

/**
 * Find autocomplete for entered text
 * @param {string} input - entered text
 * @returns {string|null} autocomplete or null if not found
 */
function findAutocomplete(input) {
  if (!input) return null
  
  const commands = getAllSystemCommands()
  const matches = commands.filter(cmd => cmd.startsWith(input))
  
  // Return first match
  return matches.length > 0 ? matches[0] : null
}

/**
 * Get remainder of string for autocomplete
 * @param {string} input - entered text
 * @param {string} completion - full autocomplete command
 * @returns {string} remainder of string to add
 */
function getCompletionSuffix(input, completion) {
  if (!completion || !completion.startsWith(input)) {
    return ''
  }
  
  return completion.substring(input.length)
}

export { getAllSystemCommands, findAutocomplete, getCompletionSuffix }
