import { ANSI } from '../../config/ansi.js'
import { SYSTEM_COMMANDS } from '../../config/system-commands.js'
import { databaseCommandService } from '../../services/database-command-service.js'
import { UI_CONFIG } from '../../config/constants.js'

export const HelpCommand = {
  /**
   * Get visual length of string without ANSI escape codes
   */
  getVisualLength(str) {
    // Remove ANSI escape codes for accurate length calculation
    return str.replace(/\x1b\[[0-9;]*m/g, '').length
  },

  /**
   * Pad string to visual width accounting for ANSI codes
   */
  padToVisualWidth(str, width) {
    const visualLength = this.getVisualLength(str)
    const padding = width - visualLength
    return str + ' '.repeat(Math.max(0, padding))
  },

  async execute(args = [], context = {}) {
    try {
      let output = `${ANSI.COLORS.CYAN}┌─ OpenAI CLI 2 - Help System ─┐${ANSI.COLORS.RESET}\n`
      output += `${ANSI.COLORS.CYAN}│                              │${ANSI.COLORS.RESET}\n`
      output += `${ANSI.COLORS.CYAN}└──────────────────────────────┘${ANSI.COLORS.RESET}\n\n`

      // System Commands Section
      output += `${ANSI.COLORS.BLUE}━━━ System Commands ━━━${ANSI.COLORS.RESET}\n`
      const tableConfig = UI_CONFIG.HELP_TABLE.COLUMN_WIDTHS
      const separator = UI_CONFIG.HELP_TABLE.SEPARATORS.COLUMN
      const formatting = UI_CONFIG.HELP_TABLE.FORMATTING
      const indent = ' '.repeat(formatting.ROW_INDENT)

      Object.entries(SYSTEM_COMMANDS).forEach(([commandKey, config]) => {
        const keys = [commandKey, ...config.aliases].join(', ')
        const paddedKeys = keys.padEnd(tableConfig.KEYS)

        output += `${indent}${ANSI.COLORS.WHITE}${paddedKeys}${ANSI.COLORS.RESET}${separator} ${config.description}\n`
      })
      output += '\n'

      // User Commands Section
      try {
        const userCommands = databaseCommandService.getCommands()
        if (Object.keys(userCommands).length > 0) {
          output += `${ANSI.COLORS.BLUE}━━━ User Commands ━━━${ANSI.COLORS.RESET}\n`

          // Table headers
          const tableConfig = UI_CONFIG.HELP_TABLE.COLUMN_WIDTHS
          const separator = UI_CONFIG.HELP_TABLE.SEPARATORS.COLUMN
          const rowSep = UI_CONFIG.HELP_TABLE.SEPARATORS.ROW
          const formatting = UI_CONFIG.HELP_TABLE.FORMATTING

          const keysHeader = 'Keys'.padEnd(tableConfig.KEYS)
          const descHeader = 'Description'.padEnd(tableConfig.DESCRIPTION)
          const modelsHeader = 'Models'.padEnd(tableConfig.MODELS)

          const indent = ' '.repeat(formatting.ROW_INDENT)
          output += `${indent}${ANSI.COLORS.WHITE}${keysHeader}${separator} ${descHeader}${separator} ${modelsHeader}${ANSI.COLORS.RESET}\n`

          const separatorWidth =
            formatting.SEPARATOR_COUNT +
            (formatting.SEPARATOR_COUNT + 1) * formatting.SEPARATOR_SPACES
          const totalWidth =
            tableConfig.KEYS +
            tableConfig.DESCRIPTION +
            tableConfig.MODELS +
            separatorWidth
          output += `${indent}${ANSI.COLORS.GREY}${rowSep.repeat(totalWidth)}${ANSI.COLORS.RESET}\n`

          Object.entries(userCommands).forEach(([commandId, command]) => {
            const keys = command.key.join(', ')
            const paddedKeys = this.padToVisualWidth(keys, tableConfig.KEYS)
            const models = this.formatModels(command.models)
            const paddedModels = this.padToVisualWidth(
              models,
              tableConfig.MODELS,
            )

            // Handle long descriptions (> 26 chars)
            const description = command.description
            if (description.length > tableConfig.DESCRIPTION) {
              const words = description.split(' ')
              let firstLine = ''
              let secondLine = ''

              // Build first line (up to 26 chars)
              for (const word of words) {
                const testLine = firstLine + (firstLine ? ' ' : '') + word
                if (testLine.length <= tableConfig.DESCRIPTION) {
                  firstLine = testLine
                } else {
                  secondLine = words.slice(words.indexOf(word)).join(' ')
                  break
                }
              }

              const paddedFirstLine = this.padToVisualWidth(
                firstLine,
                tableConfig.DESCRIPTION,
              )

              // First line with all columns
              output += `${indent}${ANSI.COLORS.WHITE}${paddedKeys}${ANSI.COLORS.RESET}${separator} ${paddedFirstLine}${separator} ${paddedModels}\n`

              // Second line with description continuation (only if needed)
              if (secondLine) {
                const paddedSecondLine = this.padToVisualWidth(
                  secondLine,
                  tableConfig.DESCRIPTION,
                )
                const emptyKeys = this.padToVisualWidth('', tableConfig.KEYS)
                const emptyModels = this.padToVisualWidth(
                  '',
                  tableConfig.MODELS,
                )
                output += `${indent}${emptyKeys}${separator} ${paddedSecondLine}${separator} ${emptyModels}\n`
              }
            } else {
              // Short description - single line
              const paddedDescription = this.padToVisualWidth(
                description,
                tableConfig.DESCRIPTION,
              )
              output += `${indent}${ANSI.COLORS.WHITE}${paddedKeys}${ANSI.COLORS.RESET}${separator} ${paddedDescription}${separator} ${paddedModels}\n`
            }
          })
          output += '\n'
        }
      } catch (error) {
        output += `${ANSI.COLORS.YELLOW}Note: Could not load user commands from database${ANSI.COLORS.RESET}\n\n`
      }

      // Special Features Section
      output += `${ANSI.COLORS.BLUE}━━━ Special Features ━━━${ANSI.COLORS.RESET}\n`
      output += `${ANSI.COLORS.WHITE}Clipboard:${ANSI.COLORS.RESET} Add '${ANSI.COLORS.YELLOW}$${ANSI.COLORS.RESET}' to include clipboard content\n`
      output += `  ${ANSI.COLORS.GREY}Example: code $${ANSI.COLORS.RESET}\n\n`

      process.stdout.write(output + '\n')
      return null
    } catch (error) {
      return `${ANSI.COLORS.RED}Error: Failed to show help - ${error.message}${ANSI.COLORS.RESET}`
    }
  },

  /**
   * Format models list for display - show only count
   */
  formatModels(models) {
    if (!models || models.length === 0) {
      return '' // Empty string for default commands
    }

    return models.length.toString() // Just the number
  },
}
