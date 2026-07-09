import { spawnSync } from 'node:child_process'
import { commandService } from '../../services/commands/index.js'
import { commandsFilePath } from '../../services/commands/paths.js'
import { syncCommands, forcePull, forcePush } from '../../services/commands/sync.js'
import { resolveGateway } from '../../services/config/gateway.js'
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

// Open the commands file in the user's editor, then reload, push, and report.
const openEditor = async (context) => {
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
  let note = ''
  if (resolveGateway()) {
    const synced = await syncCommands()
    note = synced.ok
      ? ` ${ANSI.COLORS.GREY}(synced to your account)${ANSI.COLORS.RESET}`
      : ` ${ANSI.COLORS.YELLOW}(sync failed: ${synced.error})${ANSI.COLORS.RESET}`
  }
  return `${ANSI.COLORS.GREEN}Loaded ${count} command(s).${ANSI.COLORS.RESET}${note}`
}

const doPush = async () => {
  const result = await forcePush()
  if (!result.ok) return `Push failed: ${result.error}`
  return `Pushed ${result.count} command(s) to your account.`
}

const doPull = async () => {
  const result = await forcePull()
  if (!result.ok) return `Pull failed: ${result.error}`
  if (result.empty) return 'Your account has no synced commands yet. Run "cmd push" to seed it.'
  return result.pulled
    ? 'Pulled your commands from this account (local backed up to commands.toml.bak).'
    : 'Already up to date.'
}

export const CmdCommand = {
  async execute(args = [], context = {}) {
    const sub = (args[0] || '').toLowerCase()
    if (sub === 'list' || sub === 'ls') {
      return listCommands()
    }
    if (sub === 'push') return await doPush()
    if (sub === 'pull') return await doPull()
    return await openEditor(context)
  },
}
