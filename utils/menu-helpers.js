/**
 * Helper functions for creating interactive menu titles with consistent formatting
 */

/**
 * Creates a menu title with item count





 */
export function createMenuTitle(action, itemType, count, verb = '') {
  const verbText = verb ? ` ${verb}` : ''
  return `${action} ${itemType}${verbText} (${count} available):`
}

/**
 * Creates a simple menu title without count




 */
export function createSimpleMenuTitle(action, itemType, verb = '') {
  const verbText = verb ? ` ${verb}` : ''
  return `${action} ${itemType}${verbText}:`
}

/**
 * Creates a selection menu title (most common pattern)




 */
export function createSelectionTitle(itemType, count, verb = '') {
  return createMenuTitle('Select', itemType, count, verb)
}