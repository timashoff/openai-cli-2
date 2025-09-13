import { createNavigationMenu } from './interactive_menu.js'
import { color } from '../config/color.js'
import { UI_SYMBOLS } from '../config/constants.js'

export async function createToggleMenu(title, items, initialSelection = null, actionButtons = ['Confirm', 'Back']) {
  // Initialize selection state - default to all selected if not specified
  const selection = new Set(initialSelection || items)
  
  while (true) {
    // Generate menu options with toggle indicators
    const menuOptions = [
      ...items.map(item => {
        const isSelected = selection.has(item)
        const indicator = isSelected
          ? color.green + `[${UI_SYMBOLS.CHECK}]` + color.reset
          : color.red + `[${UI_SYMBOLS.CROSS}]` + color.reset
        return `${indicator} ${item}`
      }),
      '', // Visual separator
      ...actionButtons
    ]
    
    const selectedIndex = await createNavigationMenu(title, menuOptions, 0)
    
    // Handle ESC or cancel
    if (selectedIndex === -1) {
      return null
    }
    
    // Handle item toggle (within items range)
    if (selectedIndex < items.length) {
      const selectedItem = items[selectedIndex]
      if (selection.has(selectedItem)) {
        selection.delete(selectedItem)
      } else {
        selection.add(selectedItem)
      }
      continue
    }
    
    // Skip empty separator
    if (selectedIndex === items.length) {
      continue
    }
    
    // Handle action buttons
    const actionIndex = selectedIndex - items.length - 1
    const selectedAction = actionButtons[actionIndex]
    
    if (selectedAction === 'Back') {
      return null
    }
    
    if (selectedAction === 'Confirm') {
      return {
        selectedItems: Array.from(selection),
        removedItems: items.filter(item => !selection.has(item)),
        action: 'confirm'
      }
    }
    
    // Handle other custom actions
    return {
      selectedItems: Array.from(selection),
      removedItems: items.filter(item => !selection.has(item)),
      action: selectedAction.toLowerCase()
    }
  }
}