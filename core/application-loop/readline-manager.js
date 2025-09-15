import readline from 'node:readline/promises'
import { getAllAvailableCommands } from './utils/completer.js'

// Create completer function for system commands autocomplete
const createCompleter = () => {
  return (line) => {
    const commands = getAllAvailableCommands()
    const hits = commands.filter((cmd) => cmd.startsWith(line))
    // Show matches or all commands if no matches
    return [hits.length ? hits : [], line]
  }
}

export const createReadlineManager = (handleInterrupt) => {
  // Readline config for pause/resume functionality
  const readlineConfig = {
    input: process.stdin,
    output: process.stdout,
    completer: createCompleter(),
  }

  let currentRl = null

  const createReadlineInterface = () => {
    const rl = readline.createInterface(readlineConfig)

    // CRITICAL: Redirect readline SIGINT to our graceful handler instead of default AbortError
    rl.on('SIGINT', () => {
      handleInterrupt()
    })

    return rl
  }

  const pauseReadline = () => {
    if (currentRl) {
      currentRl.close()
      currentRl = null
    }
  }

  const resumeReadline = () => {
    if (!currentRl) {
      currentRl = createReadlineInterface()
    }
  }

  const getReadlineInterface = () => currentRl

  // Initialize with first interface
  currentRl = createReadlineInterface()

  return {
    createReadlineInterface,
    pauseReadline,
    resumeReadline,
    getReadlineInterface,
  }
}