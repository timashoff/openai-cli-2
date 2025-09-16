import { color } from '../../../config/color.js'
import { APP_CONSTANTS, UI_SYMBOLS } from '../../../config/constants.js'
import readline from 'node:readline'
import { outputHandler } from '../../../core/print/output.js'

export async function createNavigationMenu(title, options, initialIndex = 0, context = null) {
  const pageSize = APP_CONSTANTS.MENU_PAGE_SIZE
  return new Promise((resolve) => {
    const menuState = {
      selectedIndex: initialIndex,
      currentPage: Math.floor(initialIndex / pageSize),
      totalPages: Math.ceil(options.length / pageSize)
    }

    // Pause ApplicationLoop readline interface to avoid conflicts
    if (context && context.ui) {
      context.ui.pauseReadline()
    }

    // Setup readline for key handling - working code from interactive_menu.js
    readline.emitKeypressEvents(process.stdin)
    const wasRawMode = process.stdin.isRaw

    // Force raw mode to block regular input - this blocks text input
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
      const start = menuState.currentPage * pageSize
      const end = Math.min(start + pageSize, options.length)

      outputHandler.clearScreen()
      console.log(color.cyan + title + color.reset)
      console.log('')

      for (let i = start; i < end; i++) {
        const isSelected = i === menuState.selectedIndex
        const prefix = isSelected ? color.green + UI_SYMBOLS.ARROW + ' ' : '  '
        const suffix = isSelected ? color.reset : ''
        const textColor = isSelected ? color.yellow : color.reset
        console.log(`${prefix}${textColor}${options[i]}${suffix}`)
      }

      console.log('')
      const pageInfo = menuState.totalPages > 1 ? ` (page ${menuState.currentPage + 1}/${menuState.totalPages})` : ''
      console.log(
        color.reset +
          `Use ↑/↓ to navigate${menuState.totalPages > 1 ? ', ←/→ to change page' : ''}, Enter to select, Esc to cancel${pageInfo}` +
          color.reset,
      )
    }

    const cleanupAndExit = (returnValue) => {
      process.stdin.removeListener('keypress', onKeypress)
      if (process.stdin.isTTY && !wasRawMode) {
        process.stdin.setRawMode(false)
      }
      if (context && context.ui) {
        context.ui.resumeReadline()
      }
      outputHandler.clearScreen()
      resolve(returnValue)
    }

    const skipEmptyOptions = (direction) => {
      const increment = direction === 'up' ? -1 : 1
      while (
        menuState.selectedIndex > 0 &&
        menuState.selectedIndex < options.length - 1 &&
        options[menuState.selectedIndex] === ''
      ) {
        menuState.selectedIndex += increment
      }
    }

    const updateCurrentPageForIndex = () => {
      menuState.currentPage = Math.floor(menuState.selectedIndex / pageSize)
    }

    const navigateUp = () => {
      if (menuState.selectedIndex > 0) {
        menuState.selectedIndex--
      } else {
        menuState.selectedIndex = options.length - 1
      }
      skipEmptyOptions('up')
      updateCurrentPageForIndex()
      renderMenu()
    }

    const navigateDown = () => {
      if (menuState.selectedIndex < options.length - 1) {
        menuState.selectedIndex++
      } else {
        menuState.selectedIndex = 0
      }
      skipEmptyOptions('down')
      updateCurrentPageForIndex()
      renderMenu()
    }

    const selectItem = () => cleanupAndExit(menuState.selectedIndex)
    const cancelMenu = () => cleanupAndExit(APP_CONSTANTS.MENU_CANCELLED_INDEX)

    const previousPage = () => {
      if (menuState.currentPage > 0) {
        menuState.currentPage--
        menuState.selectedIndex = Math.min(menuState.selectedIndex, (menuState.currentPage + 1) * pageSize - 1)
        renderMenu()
      }
    }

    const nextPage = () => {
      if ((menuState.currentPage + 1) * pageSize < options.length) {
        menuState.currentPage++
        menuState.selectedIndex = Math.max(menuState.selectedIndex, menuState.currentPage * pageSize)
        renderMenu()
      }
    }

    const onKeypress = (str, key) => {
      if (!key.name) return

      // Allow Ctrl+C for emergency exit
      if (key.ctrl && key.name === 'c') {
        cleanupAndExit(APP_CONSTANTS.MENU_CANCELLED_INDEX)
        return
      }

      const keyHandlers = {
        up: navigateUp,
        down: navigateDown,
        return: selectItem,
        escape: cancelMenu,
        left: previousPage,
        right: nextPage
      }

      const handler = keyHandlers[key.name]
      if (handler) {
        handler()
      } else {
        // Block non-navigation keys with subtle feedback
        process.stdout.write('\x07') // Bell sound
      }
    }

    process.stdin.on('keypress', onKeypress)

    // Initial menu render
    renderMenu()
  })
}

export async function createTextInput(prompt, defaultValue = '', context) {
  const fullPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `
  const result = await context.ui.readline.question(fullPrompt)
  return result.trim() || defaultValue
}