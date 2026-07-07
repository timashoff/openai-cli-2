import { spawnSync } from 'node:child_process'
import { configService } from '../../services/config/index.js'
import { configFilePath } from '../../services/config/paths.js'
import { ANSI } from '../../config/ansi.js'
import { outputHandler } from '../../core/print/index.js'

// Show only scheme://host:port of a URL (never the token, which lives elsewhere).
const safeHost = (url) => {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch (e) {
    return 'gateway'
  }
}

// Show how each provider is routed (direct vs via gateway), plus any config warnings.
const showStatus = () => {
  const status = configService.getStatus()
  const rows = status.providers.map((p) => {
    const route = p.viaGateway
      ? `${ANSI.COLORS.YELLOW}via ${safeHost(p.baseURL)}${ANSI.COLORS.RESET}`
      : `${ANSI.COLORS.GREEN}direct${ANSI.COLORS.RESET}`
    const off = p.configured ? '' : ` ${ANSI.COLORS.RED}(no key/token)${ANSI.COLORS.RESET}`
    return `  ${ANSI.COLORS.WHITE}${p.id}${ANSI.COLORS.RESET} — ${route}${off}`
  })
  const warn =
    status.errors.length > 0
      ? `\n${ANSI.COLORS.YELLOW}${status.errors.length} config problem(s): ${status.errors[0]}${ANSI.COLORS.RESET}`
      : ''
  return `Provider routing (${status.path}):\n${rows.join('\n')}${warn}`
}

// Open the config file in the user's editor, then reload and report the routing.
const openEditor = (context) => {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
  const filePath = configFilePath()

  context.ui.pauseReadline()
  outputHandler.showCursor()
  const result = spawnSync(editor, [filePath], { stdio: 'inherit' })
  context.ui.resumeReadline()

  if (result.error) {
    return `${ANSI.COLORS.RED}Could not launch editor "${editor}": ${result.error.message}${ANSI.COLORS.RESET}`
  }

  configService.reload()
  const note = `${ANSI.COLORS.RESET}(routing changes apply to providers initialized after this point; restart to re-route active ones)`
  return `${showStatus()}\n${note}`
}

export const ConfigCommand = {
  async execute(args = [], context = {}) {
    const sub = (args[0] || '').toLowerCase()
    if (sub === 'status' || sub === 'list' || sub === 'ls') {
      return showStatus()
    }
    return openEditor(context)
  },
}
