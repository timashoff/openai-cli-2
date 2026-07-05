import { spawnSync } from 'node:child_process'
import { commandService } from '../../services/commands/index.js'
import { commandsFilePath } from '../../services/commands/paths.js'
import { ANSI } from '../../config/ansi.js'
import { outputHandler } from '../../core/print/index.js'

const listCommands = () => {
  const commands = commandService.getCommands()
  const ids = Object.keys(commands)
  if (ids.length === 0) {
    return 'No commands defined yet. Run "cmd" to add some.'
  }
  const rows = ids.map((id) => {
    const command = commands[id]
    const keys = command.key.join(', ')
    const models = command.models.length > 0 ? ` [${command.models.length}]` : ''
    const ctx = command.context ? ' (context)' : ''
    return `  ${ANSI.COLORS.WHITE}${keys}${ANSI.COLORS.RESET}${models}${ctx} — ${command.description}`
  })
  return `Commands (${ids.length}):\n` + rows.join('\n')
}

// Open the commands file in the user's editor, then reload and report.
const openEditor = (context) => {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
  const filePath = commandsFilePath()

  context.ui.pauseReadline()
  outputHandler.showCursor()
  const result = spawnSync(editor, [filePath], { stdio: 'inherit' })
  context.ui.resumeReadline()

  if (result.error) {
    return `${ANSI.COLORS.RED}Could not launch editor "${editor}": ${result.error.message}${ANSI.COLORS.RESET}`
  }

  const status = commandService.reload()
  if (!status.ok) {
    const first = status.errors.length > 0 ? status.errors[0] : 'unknown error'
    return `${ANSI.COLORS.YELLOW}commands.toml has ${status.errors.length} problem(s) - keeping the previous set.\n  ${first}${ANSI.COLORS.RESET}`
  }

  const count = Object.keys(commandService.getCommands()).length
  return `${ANSI.COLORS.GREEN}Loaded ${count} command(s).${ANSI.COLORS.RESET}`
}

export const CmdCommand = {
  async execute(args = [], context = {}) {
    const sub = (args[0] || '').toLowerCase()
    if (sub === 'list' || sub === 'ls') {
      return listCommands()
    }
    return openEditor(context)
  },
}
