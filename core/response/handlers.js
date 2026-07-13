import { prepareStreamingMessages } from '../../utils/message-utils.js'
import { createStreamCommandRunner } from './stream-runner.js'

export const createStreamResponder = ({
  stateManager,
  attachStreamProcessor = false,
  showModelHeader = false,
}) => {
  if (!stateManager) {
    throw new Error('stateManager is required to create stream responder')
  }

  const runStreamCommand = createStreamCommandRunner({ stateManager })

  return async function respond({
    input,
    providerModel = null,
    onComplete,
    includeContext = true,
    chain = false,
  }) {
    const controller = stateManager.getCurrentRequestController()
    if (!controller) {
      throw new Error('No abort controller available for request')
    }

    // Interactive chat opt-in only: the current provider's conversation
    // strategy decides what the turn sends — only the new message when the
    // server holds the context, the full history otherwise.
    const strategy =
      chain && !providerModel ? stateManager.getConversationStrategy() : null

    const turn = strategy
      ? strategy.buildTurn({
          history: includeContext ? stateManager.getContextHistory() : [],
          input,
          continuationToken: stateManager.getLastResponseId(),
        })
      : {
          messages: prepareStreamingMessages(stateManager, input, includeContext),
          options: null,
        }

    const result = await runStreamCommand({
      controller,
      messages: turn.messages,
      providerModel,
      attachStreamProcessor,
      showModelHeader,
      onComplete,
      completionOptions: turn.options,
    })

    // An aborted stream still completes and stays stored server-side (verified
    // live) — discard it so the chain never sees it.
    if (strategy && result.aborted) {
      strategy.discard(strategy.captureContinuation(result))
    }

    return result
  }
}
