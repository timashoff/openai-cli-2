import { PROVIDER_API } from '../../config/providers.js'
import { composeTurnMessages } from '../../utils/message-utils.js'

// Conversation strategy: how a multi-turn conversation is carried for ONE
// provider. Each strategy answers the same four questions — what does turn N
// send, does the server hold the context, what token continues the chain, and
// how is a stored-but-unwanted turn discarded. Consumers (the chat path,
// dialogue mode) own the pointer and the turn topology; strategies own the
// wire-level policy, so adding a provider means adding a strategy, not
// threading endpoint checks through the stack.

// Full-history resend (chat/completions providers): every request carries the
// whole context itself, so there is no continuation token and nothing to
// discard server-side.
const createChatStrategy = () => ({
  carriesServerContext: false,
  buildTurn({ history = [], input }) {
    return { messages: composeTurnMessages(history, input), options: null }
  },
  captureContinuation() {
    return null
  },
  discard() {},
})

// Responses API chaining: with a continuation token the server already holds
// the context — send only the new turn; without one, re-anchor by sending the
// full history and start storing. The store/instructions overrides exist for
// callers with their own turn topology (dialogue mode forks legs off one
// parent and keeps its pivot leg unstored).
const createResponsesStrategy = ({ resolveInstance }) => ({
  carriesServerContext: true,
  buildTurn({
    history = [],
    input,
    continuationToken = null,
    store = true,
    instructions = null,
  }) {
    const options = { store }
    if (continuationToken) {
      options.previous_response_id = continuationToken
    }
    if (instructions) {
      options.instructions = instructions
    }
    return {
      messages: composeTurnMessages(continuationToken ? [] : history, input),
      options,
    }
  },
  captureContinuation(streamMeta) {
    return (streamMeta && streamMeta.responseId) || null
  },
  // Fire-and-forget: an unwanted stored response (aborted stream, rejected
  // redo) would otherwise sit in the provider's store for its full TTL.
  discard(token) {
    if (!token) {
      return
    }
    const instance = resolveInstance()
    if (!instance || typeof instance.deleteResponse !== 'function') {
      return
    }
    instance.deleteResponse(token).catch(() => {})
  },
})

const STRATEGY_FACTORIES = {
  [PROVIDER_API.CHAT]: createChatStrategy,
  [PROVIDER_API.RESPONSES]: createResponsesStrategy,
}

// An absent `api` field on a provider config means chat/completions (see
// config/providers.js), so the chat strategy is the fallback.
export const createConversationStrategy = ({
  api = null,
  resolveInstance = () => null,
}) => {
  const factory = STRATEGY_FACTORIES[api] || createChatStrategy
  return factory({ resolveInstance })
}
