import { color } from '../config/color.js'
import readline from 'node:readline'

/**
 * Creates an interactive menu with arrow key navigation
 * @param {string} title - Menu title
 * @param {Array} options - Array of options to choose from
 * @param {number} [initialIndex=0] - Initially selected index
 * @returns {Promise<number>} - Index of selected option
 */
export async function createInteractiveMenu(title, options, initialIndex = 0) {
  const pageSize = 10 // Number of options to display on one page
  return new Promise((resolve) => {
    let selectedIndex = initialIndex
    let currentPage = Math.floor(initialIndex / pageSize)

    // Setup readline for key handling
    readline.emitKeypressEvents(process.stdin)
    const wasRawMode = process.stdin.isRaw
    // Only set raw mode if it's not already set
    if (process.stdin.isTTY && !wasRawMode) {
      process.stdin.setRawMode(true)
    }

    const renderMenu = () => {
      const start = currentPage * pageSize
      const end = Math.min(start + pageSize, options.length)

      // Clear screen and return cursor
      process.stdout.write('\x1b[2J\x1b[H')

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
      if (key.name === 'up' && selectedIndex > 0) {
        selectedIndex--
        // Check if we need to switch to previous page
        if (selectedIndex < currentPage * pageSize) {
          currentPage--
        }
        renderMenu()
      } else if (key.name === 'down' && selectedIndex < options.length - 1) {
        selectedIndex++
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

        // Clear screen
        process.stdout.write('\x1b[2J\x1b[H')
        resolve(selectedIndex)
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        // Restore terminal mode
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY && !wasRawMode) {
          process.stdin.setRawMode(false)
        }

        // Clear screen
        process.stdout.write('\x1b[2J\x1b[H')
        resolve(-1) // -1 means cancelled
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
