/**
 * Helper functions for creating interactive menu titles with consistent formatting
 */

/**
 * Creates a menu title with item count
 * @param {string} action - The action being performed (e.g., 'Select', 'Choose')
 * @param {string} itemType - The type of items (e.g., 'model', 'command', 'provider')
 * @param {number} count - Number of available items
 * @param {string} verb - Optional verb (e.g., 'to edit', 'to delete')
 * @returns {string} Formatted menu title
 */
export function createMenuTitle(action, itemType, count, verb = '') {
  const verbText = verb ? ` ${verb}` : ''
  return `${action} ${itemType}${verbText} (${count} available):`
}

/**
 * Creates a simple menu title without count
 * @param {string} action - The action being performed
 * @param {string} itemType - The type of items
 * @param {string} verb - Optional verb
 * @returns {string} Formatted menu title
 */
export function createSimpleMenuTitle(action, itemType, verb = '') {
  const verbText = verb ? ` ${verb}` : ''
  return `${action} ${itemType}${verbText}:`
}

/**
 * Creates a selection menu title (most common pattern)
 * @param {string} itemType - What is being selected
 * @param {number} count - Number of items
 * @param {string} verb - Optional action verb
 * @returns {string} Formatted title
 */
export function createSelectionTitle(itemType, count, verb = '') {
  return createMenuTitle('Select', itemType, count, verb)
}