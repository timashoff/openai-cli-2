/**
 * Toggle menu utility for checkbox-style selection
 * Allows users to toggle multiple items on/off with visual indicators
 */
import { createInteractiveMenu } from './interactive_menu.js'
import { color } from '../config/color.js'

export async function createToggleMenu(title, items, initialSelection = null, actionButtons = ['Confirm', 'Back']) {
  // Initialize selection state - default to all selected if not specified
  const selection = new Set(initialSelection || items)
  
  while (true) {
    // Generate menu options with toggle indicators
    const menuOptions = [
      ...items.map(item => {
        const isSelected = selection.has(item)
        const indicator = isSelected 
          ? color.green + '[✓]' + color.reset 
          : color.red + '[☓]' + color.reset
        return `${indicator} ${item}`
      }),
      '', // Visual separator
      ...actionButtons
    ]
    
    const selectedIndex = await createInteractiveMenu(title, menuOptions, 0)
    
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