import { color } from '../config/color.js'
import { APP_CONSTANTS } from '../config/constants.js'
import readline from 'node:readline'
import { outputHandler } from '../core/output-handler.js'

/**
 * LEGACY: Creates an interactive menu with arrow key navigation
 * 
 * @deprecated Use interactive_menu_new.js instead
 * This file uses raw mode which conflicts with ApplicationLoop's readline
 * 
 * TODO: Remove this file once all references are migrated to new version
 */
export async function createInteractiveMenu(title, options, initialIndex = 0) {
  const pageSize = APP_CONSTANTS.MENU_PAGE_SIZE
  return new Promise((resolve) => {
    let selectedIndex = initialIndex
    let currentPage = Math.floor(initialIndex / pageSize)

    // Setup readline for key handling
    readline.emitKeypressEvents(process.stdin)
    const wasRawMode = process.stdin.isRaw
    
    // Force raw mode to block regular input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    
    // Resume stdin to ensure we get keypress events
    process.stdin.resume()
    
    // Clear any accumulated input buffer to prevent leakage
    if (process.stdin.readable && process.stdin.readableLength > 0) {
      process.stdin.read()
    }

    const renderMenu = () => {
      const start = currentPage * pageSize
      const end = Math.min(start + pageSize, options.length)

      // Clear screen properly without scrollback artifacts
      outputHandler.clearScreen()

      // Output title
      console.log(color.cyan + title + color.reset)
      console.log('')

      // Output options
      for (let i = start; i < end; i++) {
        const isSelected = i === selectedIndex
        const prefix = isSelected ? color.green + '▶ ' : '  '
        const suffix = isSelected ? color.reset : ''
        const textColor = isSelected ? color.yellow : color.reset

        console.log(`${prefix}${textColor}${options[i]}${suffix}`)
      }

      console.log('')
      const totalPages = Math.ceil(options.length / pageSize)
      const pageInfo =
        totalPages > 1 ? ` (page ${currentPage + 1}/${totalPages})` : ''
      console.log(
        color.reset +
          `Use ↑/↓ to navigate${totalPages > 1 ? ', ←/→ to change page' : ''}, Enter to select, Esc to cancel${pageInfo}` +
          color.reset,
      )
    }

    const onKeypress = (str, key) => {
      // Define allowed navigation keys
      const allowedKeys = ['up', 'down', 'left', 'right', 'return', 'escape']
      
      // Allow Ctrl+C for emergency exit
      if (key.ctrl && key.name === 'c') {
        // Handle Ctrl+C same as Escape
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY && !wasRawMode) {
          process.stdin.setRawMode(false)
        }
        outputHandler.clearScreen()
        resolve(APP_CONSTANTS.MENU_CANCELLED_INDEX)
        return
      }
      
      // Block all non-navigation keys
      if (!allowedKeys.includes(key.name)) {
        // Provide subtle feedback that input is blocked
        process.stdout.write('\x07') // Bell sound
        return
      }
      
      if (key.name === 'up' && selectedIndex > 0) {
        selectedIndex--
        // Skip empty strings (separator lines)
        while (selectedIndex > 0 && options[selectedIndex] === '') {
          selectedIndex--
        }
        // Check if we need to switch to previous page
        if (selectedIndex < currentPage * pageSize) {
          currentPage--
        }
        renderMenu()
      } else if (key.name === 'down' && selectedIndex < options.length - 1) {
        selectedIndex++
        // Skip empty strings (separator lines)
        while (selectedIndex < options.length - 1 && options[selectedIndex] === '') {
          selectedIndex++
        }
        // Check if we need to switch to next page
        if (selectedIndex >= (currentPage + 1) * pageSize) {
          currentPage++
        }
        renderMenu()
      } else if (key.name === 'return') {
        // Restore terminal mode
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY && !wasRawMode) {
          process.stdin.setRawMode(false)
        }

        // Clear screen completely including scrollback
        outputHandler.clearScreen()
        resolve(selectedIndex)
      } else if (key.name === 'escape') {
        // Restore terminal mode
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY && !wasRawMode) {
          process.stdin.setRawMode(false)
        }

        // Clear screen completely including scrollback
        outputHandler.clearScreen()
        resolve(APP_CONSTANTS.MENU_CANCELLED_INDEX)
      } else if (key.name === 'left' && currentPage > 0) {
        currentPage--
        // Move selected element to new page
        selectedIndex = Math.min(
          selectedIndex,
          (currentPage + 1) * pageSize - 1,
        )
        renderMenu()
      } else if (
        key.name === 'right' &&
        (currentPage + 1) * pageSize < options.length
      ) {
        currentPage++
        // Move selected element to new page
        selectedIndex = Math.max(selectedIndex, currentPage * pageSize)
        renderMenu()
      }
    }

    process.stdin.on('keypress', onKeypress)

    // Initial menu render
    renderMenu()
  })
}
