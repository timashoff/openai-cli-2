import { getStateManager } from '../StateManager.js'
import { inputProcessingService } from '../../services/input-processing/index.js'
import { commandService } from '../../services/commands/index.js'
import { configService } from '../../services/config/index.js'
import { createStreamCommandRunner } from '../response/stream-runner.js'
import { prepareStreamingMessages } from '../../utils/message-utils.js'
import { EXIT_CODES } from '../../config/constants.js'
import { sanitizeMessage } from '../error-system/index.js'

const readStdin = async () => {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

const firstAvailableProvider = () => {
  const available = configService.availableProviders()
  return available.length > 0 ? available[0] : null
}

// Non-interactive run: "ai rr text" or "echo text | ai rr".
// Streams the raw answer to stdout (no spinner/headers) so it pipes cleanly.
export const runOneShot = async (argv) => {
  await commandService.bootstrap()
  await configService.bootstrap()

  const positional = argv.join(' ').trim()
  const piped = await readStdin()
  const input = [positional, piped].filter(Boolean).join(' ').trim()

  if (!input) {
    process.stderr.write('Usage: ai <command> <text>   |   echo text | ai <command>\n')
    return EXIT_CODES.ERROR
  }

  const stateManager = getStateManager()
  const controller = new AbortController()
  stateManager.setProcessingRequest(true, controller)
  process.on('SIGINT', () => controller.abort())

  try {
    const instruction = await inputProcessingService.findInstructionCommand(input)

    if (instruction && instruction.isInvalid) {
      process.stderr.write(`${instruction.error}\n`)
      return EXIT_CODES.ERROR
    }

    let content = input
    let includeContext = false
    let providerModel = null
    let providerId = firstAvailableProvider()

    if (instruction) {
      content = instruction.content
      includeContext = instruction.context === true
      if (instruction.models.length > 0) {
        providerModel = {
          provider: instruction.models[0].provider,
          model: instruction.models[0].model,
        }
        providerId = instruction.models[0].provider
      }
    }

    if (!providerId) {
      process.stderr.write('No AI providers available - check your API keys\n')
      return EXIT_CODES.ERROR
    }

    await stateManager.primeProvider(
      providerId,
      providerModel ? providerModel.model : null,
    )

    const runStreamCommand = createStreamCommandRunner({ stateManager })
    const messages = prepareStreamingMessages(stateManager, content, includeContext)

    let wrote = false
    await runStreamCommand({
      controller,
      messages,
      providerModel,
      useSpinner: false,
      onChunk: ({ content: chunk }) => {
        if (chunk) {
          process.stdout.write(chunk)
          wrote = true
        }
      },
    })

    if (controller.signal.aborted) return EXIT_CODES.SIGINT
    if (wrote) process.stdout.write('\n')
    return EXIT_CODES.SUCCESS
  } catch (error) {
    if (controller.signal.aborted) return EXIT_CODES.SIGINT
    const message = sanitizeMessage(
      error && error.message ? error.message : String(error),
    )
    process.stderr.write(`Error: ${message}\n`)
    return EXIT_CODES.ERROR
  }
}
