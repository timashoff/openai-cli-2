import { getStateManager } from '../../core/StateManager.js'
import { createStreamCommandRunner } from '../../core/response/stream-runner.js'
import { outputHandler } from '../../core/print/index.js'
import { createNavigationMenu, createTextInput } from './ui/interactive-menu.js'
import {
  createSessionRecord,
  writeSession,
  readSession,
  listSessions,
  removeSession,
} from '../../services/sessions/store.js'
import { markSessionDeleted, syncSessions } from '../../services/sessions/sync.js'
import { DIALOGUE, SESSIONS } from '../../config/constants.js'
import { ANSI } from '../../config/ansi.js'

// Stateful dialogue-translation mode: relays a live two-person conversation
// through an EN pivot with the pivot VISIBLE (two calls per turn — the pivot
// pairs translate more accurately than the direct pair). Chain topology:
// leg1 (source→pivot) is a store:false fork off the chain tip, leg2
// (pivot→other side) is a store:true fork off the SAME parent and becomes
// the new tip. The local transcript stays the source of truth.

const fillTemplate = (template, pair) =>
  template
    .split('{a}').join(pair[0])
    .split('{b}').join(pair[1])
    .split('{pivot}').join(DIALOGUE.PIVOT_LANGUAGE)

const proposeTitle = (transcript) => {
  const firstUser = transcript.find((entry) => entry.role === 'user')
  if (!firstUser || !firstUser.content) return ''
  return String(firstUser.content).split('\n').join(' ').trim().slice(0, SESSIONS.TITLE_MAX_LENGTH)
}

const isChainMiss = (error) =>
  error && (error.statusCode === 404 || error.statusCode === 400)

export const createDialogueMode = ({ stateManager, context, session = null, pair = null }) => {
  const mode = {
    pair: session && session.pair ? session.pair : pair || [...DIALOGUE.DEFAULT_PAIR],
    transcript: session ? [...session.messages] : [],
    tip: session ? session.lastResponseId : null,
    sessionId: session ? session.id : null,
    title: session ? session.title : null,
    createdAt: session ? session.createdAt : null,
    lastTurn: null,
    dirty: false,
  }

  const runStreamCommand = createStreamCommandRunner({ stateManager })

  // Column label rendered inline right after the spinner freezes ("✓ Xs ").
  const legLabel = (code) => ` ${ANSI.COLORS.GREY}${code}${ANSI.COLORS.RESET}  `

  const runLeg = async ({ instructions, input, parentTip, store, label, history = null }) => {
    const controller = stateManager.getCurrentRequestController()
    const completionOptions = { store, instructions }
    if (parentTip) completionOptions.previous_response_id = parentTip
    const messages = history
      ? [...history, { role: 'user', content: input }]
      : [{ role: 'user', content: input }]
    return await runStreamCommand({
      controller,
      messages,
      attachStreamProcessor: true,
      completionOptions,
      streamLabel: legLabel(label),
    })
  }

  // One dialogue turn = two sequential streams off the SAME parent.
  // On a stale tip (expired/deleted server chain) re-anchor once with the
  // full local transcript — the single sanctioned fallback.
  const translateTurn = async (text, parentTip) => {
    let anchored = parentTip
    let history = null
    const runBothLegs = async () => {
      const leg1 = await runLeg({
        instructions: fillTemplate(DIALOGUE.LEG1_INSTRUCTIONS, mode.pair),
        input: text,
        parentTip: anchored,
        store: false,
        label: DIALOGUE.PIVOT_LABEL,
        history,
      })
      if (leg1.aborted) return null
      const leg2 = await runLeg({
        instructions: fillTemplate(DIALOGUE.LEG2_INSTRUCTIONS, mode.pair),
        input: `Original message:\n${text}\n\n${DIALOGUE.PIVOT_LANGUAGE} translation:\n${leg1.text}`,
        parentTip: anchored,
        store: true,
        label: DIALOGUE.TARGET_LABEL,
        history,
      })
      if (leg2.aborted) return null
      return { en: leg1.text, target: leg2.text, leg2Id: leg2.responseId }
    }

    try {
      return await runBothLegs()
    } catch (error) {
      if (!anchored || !isChainMiss(error)) throw error
      anchored = null
      history = mode.transcript
      return await runBothLegs()
    }
  }

  const handleTurn = async (text) => {
    const parentTip = mode.tip
    const turn = await translateTurn(text, parentTip)
    if (!turn) return
    mode.transcript.push({ role: 'user', content: text })
    mode.transcript.push({
      role: 'assistant',
      content: `[${DIALOGUE.PIVOT_LANGUAGE.toLowerCase()}] ${turn.en}\n${turn.target}`,
    })
    mode.tip = turn.leg2Id
    mode.lastTurn = { parentTip, text, leg2Id: turn.leg2Id }
    mode.dirty = true
  }

  const redoTurn = async () => {
    if (!mode.lastTurn) {
      console.log(outputHandler.formatWarning('Nothing to redo yet'))
      return
    }
    const { parentTip, text, leg2Id } = mode.lastTurn
    stateManager.deleteStoredResponse(leg2Id)
    mode.transcript.pop()
    mode.transcript.pop()
    mode.tip = parentTip
    mode.lastTurn = null
    await handleTurn(text)
  }

  const saveDialogue = async () => {
    if (mode.transcript.length === 0) {
      console.log(outputHandler.formatWarning('Nothing to save — the dialogue is empty'))
      return
    }
    const proposed = mode.title || proposeTitle(mode.transcript)
    const title = (await createTextInput('Dialogue title', proposed, context)).trim()
    if (!title) {
      console.log(outputHandler.formatWarning('Save cancelled — no title given'))
      return
    }
    const currentProvider = context.providers.getCurrent()
    let record = mode.sessionId ? readSession(mode.sessionId) : null
    if (record) {
      record.title = title
      record.updatedAt = Date.now()
      record.messages = mode.transcript
      record.lastResponseId = mode.tip
      record.pair = mode.pair
    } else {
      record = createSessionRecord({
        title,
        provider: currentProvider && currentProvider.key ? currentProvider.key : '',
        model: context.models.getCurrent(),
        kind: 'dialogue',
        pair: mode.pair,
        lastResponseId: mode.tip,
        messages: mode.transcript,
      })
    }
    writeSession(record)
    mode.sessionId = record.id
    mode.title = title
    mode.dirty = false
    const sync = await syncSessions()
    const syncNote = sync.ok ? ' and synced' : ' (local only — sync unavailable)'
    console.log(outputHandler.formatSuccess(`Saved "${title}"${syncNote}`))
  }

  const leave = () => {
    context.modes.leave()
    const hint = mode.dirty ? ' — unsaved turns discarded (use save to keep a dialogue)' : ''
    console.log(outputHandler.formatInfo(`Left dialogue mode${hint}`))
  }

  const commands = {
    exit: leave,
    q: leave,
    save: saveDialogue,
    redo: redoTurn,
  }

  const handleLine = async (input) => {
    const word = input.trim().toLowerCase()
    const command = commands[word]
    if (command) {
      await command()
      return
    }
    await handleTurn(input.trim())
  }

  return {
    prompt: `\n${ANSI.COLORS.GREEN}${DIALOGUE.PROMPT}`,
    pair: mode.pair,
    handleLine,
  }
}

// `dd` — enter dialogue-translation mode (Responses-capable providers only):
// no args → menu (new dialogue / resume a saved one); `dd <langA> <langB>`
// → new dialogue for that pair; `dd rm` → delete a saved dialogue.
export const DialogueCommand = {
  async execute(args = [], context = {}) {
    const stateManager = getStateManager()
    if (!stateManager.supportsResponseChaining()) {
      return outputHandler.formatWarning(
        'Dialogue mode needs a Responses API provider — run: provider openai',
      )
    }

    if (args[0] === 'rm') {
      return await removeDialogueFlow(context)
    }

    let session = null
    let pair = null
    if (args.length >= 2) {
      pair = [args[0], args[1]]
    } else {
      const saved = listSessions().filter((meta) => meta.kind === 'dialogue')
      if (saved.length > 0) {
        const options = ['New dialogue', ...saved.map((meta) => meta.title)]
        const index = await createNavigationMenu('Dialogue:', options, 0, context)
        if (index === -1) return outputHandler.formatInfo('Cancelled')
        if (index > 0) session = readSession(saved[index - 1].id)
      }
    }

    const mode = createDialogueMode({ stateManager, context, session, pair })
    context.modes.enter(mode)
    const resumed = session ? ` — resumed "${session.title}" (${Math.floor(session.messages.length / 2)} turns)` : ''
    const hints = [
      '  save   keep this dialogue (it then appears in the dd menu)',
      '  redo   translate the last message again',
      '  exit   leave the mode (or q)',
    ].join('\n')
    return outputHandler.formatInfo(
      `Dialogue mode: ${mode.pair[0]} ⇄ ${mode.pair[1]} via ${DIALOGUE.PIVOT_LANGUAGE}${resumed}\n${hints}`,
    )
  },
}

const removeDialogueFlow = async (context) => {
  const saved = listSessions().filter((meta) => meta.kind === 'dialogue')
  if (saved.length === 0) {
    return outputHandler.formatWarning('No saved dialogues')
  }
  const index = await createNavigationMenu(
    'Delete which dialogue?',
    saved.map((meta) => meta.title),
    0,
    context,
  )
  if (index === -1) return outputHandler.formatInfo('Cancelled')
  const target = saved[index]
  const confirm = await createNavigationMenu(
    `Delete "${target.title}"?`,
    ['Cancel', 'Delete'],
    0,
    context,
  )
  if (confirm !== 1) return outputHandler.formatInfo('Cancelled')
  markSessionDeleted(target.id)
  removeSession(target.id)
  const sync = await syncSessions()
  const syncNote = sync.ok ? ' (synced)' : ' (local only — sync unavailable)'
  return outputHandler.formatSuccess(`Deleted "${target.title}"${syncNote}`)
}
