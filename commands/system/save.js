import { createTextInput } from './ui/interactive-menu.js'
import { outputHandler } from '../../core/print/index.js'
import { createSessionRecord, writeSession } from '../../services/sessions/store.js'
import { syncSessions } from '../../services/sessions/sync.js'
import { SESSIONS } from '../../config/constants.js'

// Auto-proposed title: the first user message flattened to one line and cut
// to the configured length — the owner confirms or edits it.
const proposeTitle = (history) => {
  const firstUser = history.find((entry) => entry.role === 'user')
  if (!firstUser || !firstUser.content) return ''
  const oneLine = String(firstUser.content).split('\n').join(' ').trim()
  return oneLine.slice(0, SESSIONS.TITLE_MAX_LENGTH)
}

// `save [title]` — persist the current conversation as a named session:
// local JSON record + account sync (kind='sessions'). The conversation
// itself stays untouched (ephemerality is the default; save is the copy).
export const SaveCommand = {
  async execute(args = [], context = {}) {
    const history = context.conversation.getHistory()
    if (history.length === 0) {
      return outputHandler.formatWarning('Nothing to save — the conversation is empty')
    }

    const givenTitle = args.join(' ').trim()
    const title = givenTitle
      ? givenTitle
      : (await createTextInput('Session title', proposeTitle(history), context)).trim()
    if (!title) {
      return outputHandler.formatWarning('Save cancelled — no title given')
    }

    const currentProvider = context.providers.getCurrent()
    const session = createSessionRecord({
      title,
      provider: currentProvider && currentProvider.key ? currentProvider.key : '',
      model: context.models.getCurrent(),
      kind: 'chat',
      lastResponseId: context.conversation.getLastResponseId(),
      messages: history,
    })
    writeSession(session)

    const sync = await syncSessions()
    const syncNote = sync.ok
      ? ' and synced to your account'
      : ' (local only — sync unavailable)'
    return outputHandler.formatSuccess(`Saved "${title}"${syncNote}`)
  },
}
