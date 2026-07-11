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

    // Responses API chaining (interactive chat opt-in only): with a valid chain
    // pointer send just the new turn and reference the server-side context;
    // without one send full history once (re-anchor) and start storing.
    const chainActive =
      chain && !providerModel && stateManager.supportsResponseChaining()
    const chainId = chainActive ? stateManager.getLastResponseId() : null

    const messages = prepareStreamingMessages(
      stateManager,
      input,
      includeContext && !chainId,
    )

    const completionOptions = chainActive
      ? chainId
        ? { store: true, previous_response_id: chainId }
        : { store: true }
      : null

    const result = await runStreamCommand({
      controller,
      messages,
      providerModel,
      attachStreamProcessor,
      showModelHeader,
      onComplete,
      completionOptions,
    })

    return result
  }
}
