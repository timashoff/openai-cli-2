import { color } from '../config/color.js'
import readline from 'node:readline'

/**
 * Создает интерактивное меню с возможностью навигации стрелками
 * @param {string} title - Заголовок меню
 * @param {Array} options - Массив опций для выбора
 * @param {number} [initialIndex=0] - Изначально выбранный индекс
 * @returns {Promise<number>} - Индекс выбранной опции
 */
export async function createInteractiveMenu(title, options, initialIndex = 0) {
  const pageSize = 10; // Количество опций для отображения на одной странице
  return new Promise((resolve) => {
    let selectedIndex = initialIndex
    let currentPage = Math.floor(initialIndex / pageSize)
    
    // Настройка readline для обработки клавиш
    readline.emitKeypressEvents(process.stdin)
    const wasRawMode = process.stdin.isRaw
    // Только устанавливаем raw mode если он еще не установлен
    if (process.stdin.isTTY && !wasRawMode) {
      process.stdin.setRawMode(true)
    }
    
    const renderMenu = () => {
      const start = currentPage * pageSize
      const end = Math.min(start + pageSize, options.length)

      // Очистка экрана и возврат курсора
      process.stdout.write('\x1b[2J\x1b[H')

      // Вывод заголовка
      console.log(color.cyan + title + color.reset)
      console.log('')

      // Вывод опций
      for (let i = start; i < end; i++) {
        const isSelected = i === selectedIndex
        const prefix = isSelected ? color.green + '▶ ' : '  '
        const suffix = isSelected ? color.reset : ''
        const textColor = isSelected ? color.yellow : color.reset

        console.log(`${prefix}${textColor}${options[i]}${suffix}`)
      }

      console.log('')
      const totalPages = Math.ceil(options.length / pageSize)
      const pageInfo = totalPages > 1 ? ` (страница ${currentPage + 1}/${totalPages})` : ''
      console.log(color.grey + `Use ↑/↓ to navigate${totalPages > 1 ? ', ←/→ to change page' : ''}, Enter to select, Esc to cancel${pageInfo}` + color.reset)
    }
    
    const onKeypress = (str, key) => {
      if (key.name === 'up' && selectedIndex > 0) {
        selectedIndex--
        // Проверяем, нужно ли переключиться на предыдущую страницу
        if (selectedIndex < currentPage * pageSize) {
          currentPage--
        }
        renderMenu()
      } else if (key.name === 'down' && selectedIndex < options.length - 1) {
        selectedIndex++
        // Проверяем, нужно ли переключиться на следующую страницу
        if (selectedIndex >= (currentPage + 1) * pageSize) {
          currentPage++
        }
        renderMenu()
      } else if (key.name === 'return') {
        // Восстановление режима терминала
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY && !wasRawMode) {
          process.stdin.setRawMode(false)
        }
        
        // Очистка экрана
        process.stdout.write('\x1b[2J\x1b[H')
        resolve(selectedIndex)
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        // Восстановление режима терминала
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY && !wasRawMode) {
          process.stdin.setRawMode(false)
        }
        
        // Очистка экрана
        process.stdout.write('\x1b[2J\x1b[H')
        resolve(-1) // -1 означает отмену
      } else if (key.name === 'left' && currentPage > 0) {
        currentPage--
        // Перемещаем выбранный элемент на новую страницу
        selectedIndex = Math.min(selectedIndex, (currentPage + 1) * pageSize - 1)
        renderMenu()
      } else if (key.name === 'right' && (currentPage + 1) * pageSize < options.length) {
        currentPage++
        // Перемещаем выбранный элемент на новую страницу
        selectedIndex = Math.max(selectedIndex, currentPage * pageSize)
        renderMenu()
      }
    }
    
    process.stdin.on('keypress', onKeypress)
    
    // Первоначальный рендер меню
    renderMenu()
  })
}
