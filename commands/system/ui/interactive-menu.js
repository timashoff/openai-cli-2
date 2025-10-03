import { APP_CONSTANTS, UI_SYMBOLS } from '../../../config/constants.js'
import { ANSI } from '../../../config/ansi.js'
import readline from 'node:readline'
import { outputHandler } from '../../../core/print/index.js'

export async function createNavigationMenu(title, options, initialIndex = 0, context = null) {
  const normalizedOptions = options.map((option) => {
    if (option && typeof option === 'object') {
      return {
        label: option.label ?? '',
        hint: option.hint ?? '',
      }
    }
    return {
      label: option !== undefined && option !== null ? String(option) : '',
      hint: '',
    }
  })

  const pageSize = APP_CONSTANTS.MENU_PAGE_SIZE
  const totalOptions = normalizedOptions.length
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(totalOptions - 1, 0))
  return new Promise((resolve) => {
    if (totalOptions === 0) {
      outputHandler.clearScreen()
      console.log(ANSI.COLORS.CYAN + title + ANSI.COLORS.RESET)
      console.log(`${ANSI.COLORS.GREY}No options available.${ANSI.COLORS.RESET}`)
      resolve(APP_CONSTANTS.MENU_CANCELLED_INDEX)
      return
    }

    const menuState = {
      selectedIndex: safeInitialIndex,
      currentPage: Math.floor((safeInitialIndex || 0) / pageSize),
      totalPages: Math.ceil(totalOptions / pageSize) || 1,
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
      const end = Math.min(start + pageSize, totalOptions)

      outputHandler.clearScreen()
      console.log(ANSI.COLORS.CYAN + title + ANSI.COLORS.RESET)

      const currentOption = normalizedOptions[menuState.selectedIndex]
      if (currentOption && currentOption.hint) {
        console.log(`${ANSI.COLORS.GREY}${currentOption.hint}${ANSI.COLORS.RESET}`)
      }
      console.log('')

      for (let i = start; i < end; i++) {
        const option = normalizedOptions[i]
        const label = option ? option.label : ''
        const isSelected = i === menuState.selectedIndex
        const prefix = isSelected ? ANSI.COLORS.GREEN + UI_SYMBOLS.ARROW + ' ' : '  '
        const suffix = isSelected ? ANSI.COLORS.RESET : ''
        const textColor = isSelected ? ANSI.COLORS.YELLOW : ANSI.COLORS.RESET
        console.log(`${prefix}${textColor}${label}${suffix}`)
      }

      console.log('')
      const pageInfo = menuState.totalPages > 1 ? ` (page ${menuState.currentPage + 1}/${menuState.totalPages})` : ''
      console.log(
        ANSI.COLORS.RESET +
          `Use ↑/↓ to navigate${menuState.totalPages > 1 ? ', ←/→ to change page' : ''}, Enter to select, Esc to cancel${pageInfo}` +
          ANSI.COLORS.RESET,
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
        menuState.selectedIndex < totalOptions - 1 &&
        normalizedOptions[menuState.selectedIndex] &&
        normalizedOptions[menuState.selectedIndex].label === ''
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
        menuState.selectedIndex = totalOptions - 1
      }
      skipEmptyOptions('up')
      updateCurrentPageForIndex()
      renderMenu()
    }

    const navigateDown = () => {
      if (menuState.selectedIndex < totalOptions - 1) {
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
      if ((menuState.currentPage + 1) * pageSize < totalOptions) {
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
        process.stdout.write(ANSI.SOUND.BELL) // Bell sound
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
