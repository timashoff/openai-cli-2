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
  }) {
    const controller = stateManager.getCurrentRequestController()
    if (!controller) {
      throw new Error('No abort controller available for request')
    }

    const messages = prepareStreamingMessages(stateManager, input)

    const result = await runStreamCommand({
      controller,
      messages,
      providerModel,
      attachStreamProcessor,
      showModelHeader,
      onComplete,
    })

    return result
  }
}
