import { SYS_INSTRUCTIONS } from '../config/instructions.js'

/**
 * Получить все системные команды
 * @returns {string[]} массив всех системных команд
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
 * Найти автокомплит для введенного текста
 * @param {string} input - введенный текст
 * @returns {string|null} автокомплит или null если не найден
 */
function findAutocomplete(input) {
  if (!input) return null
  
  const commands = getAllSystemCommands()
  const matches = commands.filter(cmd => cmd.startsWith(input))
  
  // Возвращаем первое совпадение
  return matches.length > 0 ? matches[0] : null
}

/**
 * Получить остаток строки для автокомплита
 * @param {string} input - введенный текст
 * @param {string} completion - полная команда автокомплита
 * @returns {string} остаток строки для добавления
 */
function getCompletionSuffix(input, completion) {
  if (!completion || !completion.startsWith(input)) {
    return ''
  }
  
  return completion.substring(input.length)
}

export { getAllSystemCommands, findAutocomplete, getCompletionSuffix }
