import { logger } from '../../utils/logger.js'
import { createSpinner } from '../../utils/spinner.js'
import { outputHandler } from '../print/index.js'
import { updateContext } from '../../utils/context-utils.js'
import { errorHandler } from '../error-system/index.js'

export function createResponsesAgentCommand(app) {
  const stateManager = app.stateManager

  return {
    async execute({ profile, userInput }) {
      if (!profile) {
        throw new Error('Agent profile is required for agent command execution')
      }

      const controller = stateManager.getCurrentRequestController()
      if (!controller) {
        throw new Error('AbortController not available for agent command')
      }

      const spinnerLabel = profile.id ? ` ${profile.id}` : ` ${profile.model}`
      const spinner = createSpinner(spinnerLabel)
      spinner.start(controller)

      const subscriptions = []
      let accumulatedText = ''
      let aborted = false

      const stopSpinner = (status = 'success') => {
        if (spinner.isActive()) {
          spinner.stop(status)
        }
      }

      try {
        logger.debug(`ResponsesAgent: Executing profile ${profile.id}`)

        const responseStream = await stateManager.createResponseStream({
          profile,
          userInput,
          signal: controller.signal,
        })

        subscriptions.push(
          responseStream.on('first-delta', () => {
            stopSpinner('success')
            outputHandler.writeNewline()
            outputHandler.writeModel({ model: profile.model })
          }),
        )

        subscriptions.push(
          responseStream.on('delta', ({ delta, snapshot }) => {
            if (delta) {
              outputHandler.writeStream(delta)
            }

            if (snapshot) {
              accumulatedText = snapshot
            }
          }),
        )

        subscriptions.push(
          responseStream.on('function-call-delta', (event) => {
            if (event?.delta) {
              outputHandler.writeStream(event.delta)
            }
          }),
        )

        subscriptions.push(
          responseStream.on('completed', ({ text }) => {
            accumulatedText = text || accumulatedText
            stopSpinner('success')
          }),
        )

        subscriptions.push(
          responseStream.on('final', ({ text }) => {
            accumulatedText = text || accumulatedText
            stopSpinner('success')
          }),
        )

        subscriptions.push(
          responseStream.on('aborted', () => {
            aborted = true
            stopSpinner('error')
          }),
        )

        subscriptions.push(
          responseStream.on('error', (error) => {
            stopSpinner('error')
            errorHandler
              .handleError(error, {
                context: 'ResponsesAgent:stream',
              })
              .catch((handlerError) => {
                logger.debug(
                  `ResponsesAgent: error handler failed: ${handlerError.message}`,
                )
              })
          }),
        )

        subscriptions.push(
          responseStream.on('end', () => {
            stopSpinner('success')
          }),
        )

        const result = await responseStream.waitForCompletion()
        accumulatedText = result?.text || accumulatedText

        if (result?.aborted || aborted) {
          logger.debug(`ResponsesAgent: Stream aborted for profile ${profile.id}`)
          return { aborted: true }
        }

        if (accumulatedText && accumulatedText.trim()) {
          process.stdout.write('\n')
          updateContext(stateManager, userInput, accumulatedText)
          outputHandler.writeContextDots(stateManager)
        }

        return {
          text: accumulatedText,
          response: result?.response || responseStream.getFinalResponse?.(),
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return { aborted: true }
        }

        stopSpinner('error')
        await errorHandler.handleError(error, {
          context: 'ResponsesAgent:execute',
        })
        return { error }
      } finally {
        for (const unsubscribe of subscriptions) {
          if (typeof unsubscribe === 'function') {
            try {
              unsubscribe()
            } catch (unsubscribeError) {
              logger.debug(`ResponsesAgent: Failed to unsubscribe handler: ${unsubscribeError.message}`)
            }
          }
        }

        spinner.dispose()
      }
    },
  }
}
