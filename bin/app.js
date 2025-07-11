#!/usr/bin/env node

import { Application } from '../utils/application.js'
import { CommandManager } from '../utils/command-manager.js'
import { rl } from '../utils/index.js'
import { color } from '../config/color.js'
import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { getClipboardContent } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { createProvider } from '../utils/provider-factory.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { createInteractiveMenu } from '../utils/interactive_menu.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { INSTRUCTIONS } from '../config/instructions.js'
import cache from '../utils/cache.js'
import { sanitizeErrorMessage } from '../utils/security.js'
import { errorHandler } from '../utils/error-handler.js'
import { logger } from '../utils/logger.js'
import readline from 'node:readline'
import { mcpManager } from '../utils/mcp-manager.js'
import { intentDetector } from '../utils/intent-detector.js'
import { fetchMCPServer } from '../utils/fetch-mcp-server.js'
import { searchMCPServer } from '../utils/search-mcp-server.js'
import { readFile } from 'node:fs/promises'


// Create application instance
const app = new Application()

/**
 * Enhanced Application class with AI functionality
 */
class AIApplication extends Application {
  constructor() {
    super()
    this.aiState = {
      provider: null,
      models: [],
      model: '',
      selectedProviderKey: ''
    }
    
    // Use separate command manager to avoid conflicts
    this.aiCommands = new CommandManager()
    
    // Track operation state
    this.isProcessingRequest = false
    this.isTypingResponse = false
    this.currentRequestController = null
    this.currentSpinnerInterval = null
    this.currentStreamProcessor = null
    this.shouldReturnToPrompt = false
    
    // Setup global cleanup handlers
    this.setupCleanupHandlers()
  }
  
  /**
   * Setup process cleanup handlers
   */
  setupCleanupHandlers() {
    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.removeAllListeners('keypress')
      process.stdout.write('\x1B[?25h') // Show cursor
    }
    
    // Global keypress handler for the entire application
    const globalKeyPressHandler = (str, key) => {
      if (key && key.name === 'escape') {
        if (this.isProcessingRequest && this.currentRequestController) {
          // Stop spinner immediately
          if (this.currentSpinnerInterval) {
            clearInterval(this.currentSpinnerInterval)
            this.currentSpinnerInterval = null
          }
          
          process.stdout.clearLine()
          process.stdout.cursorTo(0)
          
          // Force abort and cleanup
          this.currentRequestController.abort()
          this.isProcessingRequest = false
          
          // Force terminate stream processing if active
          if (this.currentStreamProcessor) {
            this.currentStreamProcessor.forceTerminate()
          }
          
          // Force show cursor and ensure we're ready for input
          process.stdout.write('\x1B[?25h')
          
        } else if (this.isTypingResponse) {
          // Don't clear the line - keep the text that was already typed
          console.log() // Just add a new line
          this.isTypingResponse = false
          this.shouldReturnToPrompt = true
          
          // Force immediate return to input prompt
          process.stdout.write('\x1B[?25h') // Show cursor
        }
      }
    }
    
    // Setup global keypress handling once
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.on('keypress', globalKeyPressHandler)
    
    process.on('SIGINT', () => {
      cleanup()
      console.log('\n[Application terminated by user]')
      process.exit(0)
    })
    
    process.on('SIGTERM', cleanup)
    process.on('exit', cleanup)
  }

  /**
   * Register AI-specific commands
   */
  async registerAICommands() {
    const { BaseCommand } = await import('../utils/command-manager.js')
    
    // Provider command
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('provider', 'Switch AI provider', {
          aliases: ['p'],
          usage: 'provider',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        return await context.app.switchProvider()
      }
    })
    
    // Model command
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('model', 'Switch AI model', {
          aliases: ['m'],
          usage: 'model',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        return await context.app.switchModel()
      }
    })
  }

  /**
   * Initialize AI components
   */
  async initializeAI() {
    await this.registerAICommands()
    await cache.initialize()
    await this.initializeMCP()
    await this.switchProvider()
    
    // Small delay to let UI settle after provider selection
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  /**
   * Initialize MCP components
   */
  async initializeMCP() {
    try {
      logger.debug('Initializing MCP servers')
      
      // Load MCP server configuration
      const mcpConfigPath = new URL('../config/mcp-servers.json', import.meta.url).pathname
      const mcpConfigContent = await readFile(mcpConfigPath, 'utf-8')
      const mcpConfig = JSON.parse(mcpConfigContent)
      
      // Setup built-in servers
      mcpConfig.fetch.server = fetchMCPServer
      mcpConfig['web-search'].server = searchMCPServer
      
      // Initialize MCP manager
      await mcpManager.initialize(mcpConfig)
      
      logger.debug('MCP servers initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize MCP servers:', error)
      // Don't throw - continue without MCP
    }
  }

  /**
   * Switch AI provider
   */
  async switchProvider() {
    const providerKeys = Object.keys(API_PROVIDERS)
    const providerOptions = providerKeys.map((key) => API_PROVIDERS[key].name)

    const selectedIndex = await createInteractiveMenu(
      'Select an AI provider:',
      providerOptions,
    )

    if (selectedIndex === -1) {
      console.log(`${color.red}Selection cancelled. No changes made.${color.reset}`)
      return
    }

    this.aiState.selectedProviderKey = providerKeys[selectedIndex]
    
    const providerConfig = API_PROVIDERS[this.aiState.selectedProviderKey]
    const providerName = providerConfig.name

    console.log(`Loading models from ${providerName}...`)
    logger.debug(`Switching to provider: ${providerName}`)
    
    try {
      // Create provider using factory
      const provider = createProvider(this.aiState.selectedProviderKey, providerConfig)
      await provider.initializeClient()
      
      this.aiState.provider = provider
      
      // Fetch models through provider
      const list = await provider.listModels()
      this.aiState.models = list.map(m => m.id).sort((a, b) => a.localeCompare(b))
      
      this.aiState.model = this.findModel(DEFAULT_MODELS, this.aiState.models)
      
      process.title = this.aiState.model
      
      console.log(`\nProvider changed to ${color.cyan}${providerName}${color.reset}.`)
      console.log(`Current model is now '${color.yellow}${this.aiState.model}${color.reset}'.\n`)
      
      logger.debug(`Provider switched successfully. Model: ${this.aiState.model}, Available models: ${this.aiState.models.length}`)
      // Note: Don't emit provider:changed event here as it causes duplicate logging
    } catch (e) {
      process.stdout.clearLine()
      process.stdout.cursorTo(0)
      errorHandler.handleError(e, { context: 'provider_switch' })
      
      if (!this.aiState.model) {
        process.exit(0)
      }
    }
  }

  /**
   * Switch AI model
   */
  async switchModel() {
    const { execModel } = await import('../utils/index.js')
    
    logger.debug('Starting model selection')
    try {
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      // Convert models back to object format for compatibility
      const modelsForMenu = this.aiState.models.map(id => ({ id }))
      const newModel = await execModel(this.aiState.model, modelsForMenu, rl)
      this.aiState.model = newModel
      process.title = this.aiState.model

      logger.debug(`Model changed to: ${this.aiState.model}`)

      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(true)
      }
    } catch (error) {
      errorHandler.handleError(error, { context: 'model_switch' })
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
    }
  }

  /**
   * Process AI input (override parent method)
   */
  async processAIInput(input) {
    let interval
    let startTime
    
    // Check for clipboard content FIRST (before MCP processing)
    if (input.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      try {
        const buffer = await getClipboardContent()
        const sanitizedBuffer = sanitizeString(buffer)
        validateString(sanitizedBuffer, 'clipboard content', false)
        
        if (sanitizedBuffer.length > configManager.get('maxInputLength')) {
          console.log(`${color.red}Error: Clipboard content too large (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
          return
        }
        
        input = input.replace(new RegExp(APP_CONSTANTS.CLIPBOARD_MARKER.replace(/\$/g, '\\$'), 'g'), sanitizedBuffer)
        console.log(`${color.grey}[Clipboard content inserted (${sanitizedBuffer.length} chars)]${color.reset}`)
      } catch (error) {
        errorHandler.handleError(error, { context: 'clipboard_read' })
        return
      }
    }
    
    // Now check for MCP processing (after clipboard substitution)
    const mcpResult = await this.processMCPInput(input)
    if (mcpResult) {
      input = mcpResult.enhancedInput
      if (mcpResult.directResponse) {
        console.log(`\n${color.cyan}[MCP Data]${color.reset}`)
        console.log(mcpResult.directResponse)
        console.log()
        return
      }
      if (mcpResult.showMCPData) {
        console.log(`\n${color.cyan}[MCP]${color.reset}`)
        console.log(`${color.grey}Source: ${mcpResult.mcpData.url}${color.reset}`)
        console.log(`${color.grey}Content: ${mcpResult.mcpData.content.length} chars${color.reset}`)
        console.log()
      }
    }

    // Check for force flags
    let forceRequest = false
    for (const flag of APP_CONSTANTS.FORCE_FLAGS) {
      if (input.endsWith(flag)) {
        forceRequest = true
        input = input.replace(new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '').trim()
        break
      }
    }

    const command = this.findCommand(input)
    const finalInput = command ? command.fullInstruction : input

    // Check cache for translation commands
    if (command && command.isTranslation && !forceRequest && cache.has(finalInput)) {
      console.log(`\n${color.yellow}[from cache]${color.reset}`)
      process.stdout.write(cache.get(finalInput))
      console.log('\n')
      return
    }

    // Setup request state for global handler
    this.currentRequestController = new AbortController()
    this.isProcessingRequest = true

    try {
      let messages = []
      if (command && command.isTranslation) {
        messages = [{ role: 'user', content: finalInput }]
      } else {
        messages = this.state.contextHistory.map(({ role, content }) => ({ role, content }))
        messages.push({ role: 'user', content: finalInput })
      }

      startTime = Date.now()

      // Start spinner before making API call
      let i = 0
      process.stdout.write('\x1B[?25l') // Hide cursor
      this.currentSpinnerInterval = setInterval(() => {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1)
        process.stdout.write(
          `${color.reset}${UI_SYMBOLS.SPINNER[i++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s${color.reset}`,
        )
      }, configManager.get('spinnerInterval'))
      interval = this.currentSpinnerInterval

      // Use provider for API calls
      const stream = await this.aiState.provider.createChatCompletion(this.aiState.model, messages, {
        stream: true,
        signal: this.currentRequestController.signal
      })

      const streamProcessor = new StreamProcessor(this.aiState.selectedProviderKey)
      this.currentStreamProcessor = streamProcessor
      let response = []
      let firstChunk = true
      
      // Setup streaming output callback  
      const onChunk = async (content) => {
        // Check if typing was cancelled
        if (!this.isTypingResponse && !firstChunk) {
          return // Stop processing chunks if user cancelled
        }
        
        if (firstChunk) {
          // Stop spinner and show success on first chunk
          clearInterval(this.currentSpinnerInterval)
          this.currentSpinnerInterval = null
          
          const finalTime = ((Date.now() - startTime) / 1000).toFixed(1)
          process.stdout.clearLine()
          process.stdout.cursorTo(0)
          console.log(`${color.green}✓${color.reset} ${finalTime}s`)
          
          // Switch to typing mode immediately
          this.isProcessingRequest = false
          this.isTypingResponse = true
          firstChunk = false
        }
        
        // Simple chunk output - just write content as it comes
        if (this.isTypingResponse) {
          process.stdout.write(content)
        }
      }
      
      try {
        // Use Promise.race for IMMEDIATE cancellation
        response = await Promise.race([
          streamProcessor.processStream(stream, this.currentRequestController.signal, onChunk),
          // Immediate abort promise that resolves instantly on cancellation
          new Promise((resolve, reject) => {
            // Set up immediate abort listener
            const abortHandler = () => {
              // Force immediate rejection - no waiting
              setTimeout(() => reject(new Error('AbortError')), 0)
            }
            
            // Safety check before adding listener
            if (this.currentRequestController && this.currentRequestController.signal) {
              this.currentRequestController.signal.addEventListener('abort', abortHandler, { once: true })
            }
            
            // Also check termination flag very rapidly
            const rapidCheck = () => {
              // Safety check for null controller
              if (!this.currentRequestController || !this.currentRequestController.signal) {
                return // Stop checking if controller is gone
              }
              
              if (this.currentStreamProcessor?.isTerminated || this.shouldReturnToPrompt) {
                setTimeout(() => reject(new Error('AbortError')), 0)
              } else if (!this.currentRequestController.signal.aborted) {
                setTimeout(rapidCheck, 5) // Check every 5ms
              }
            }
            rapidCheck()
          }),
          // Nuclear option: force timeout after 200ms of abort signal
          new Promise((_, reject) => {
            const forceTimeout = () => {
              // Safety check for null controller
              if (!this.currentRequestController || !this.currentRequestController.signal) {
                return // Stop checking if controller is gone
              }
              
              if (this.currentRequestController.signal.aborted) {
                setTimeout(() => reject(new Error('AbortError')), 200)
              } else {
                setTimeout(forceTimeout, 100)
              }
            }
            forceTimeout()
          })
        ])
      } catch (error) {
        if (error.message === 'AbortError' || error.name === 'AbortError' || error.message === 'Stream processing aborted' || error.message.includes('aborted')) {
          // For AbortError, just continue with empty response
          response = []
        } else {
          throw error
        }
      }

      clearInterval(interval)

      if (this.currentRequestController.signal.aborted || this.shouldReturnToPrompt) {
        // Only show cancellation if no content was output yet
        if (firstChunk) {
          const finalTime = ((Date.now() - startTime) / 1000).toFixed(1)
          process.stdout.clearLine()
          process.stdout.cursorTo(0)
          console.log(`${color.red}☓${color.reset} ${finalTime}s\n`)
        } else {
          // Content was already streaming, just add newline
          console.log()
        }
        
        // Reset flags when cancelled during streaming
        this.shouldReturnToPrompt = false
        this.isTypingResponse = false
        return
      } else {
        // Stream completed successfully
        this.isTypingResponse = false
        
        // If no content was output (empty response), show completion
        if (firstChunk) {
          const finalTime = ((Date.now() - startTime) / 1000).toFixed(1)
          process.stdout.clearLine()
          process.stdout.cursorTo(0)
          console.log(`${color.green}✓${color.reset} ${finalTime}s`)
          console.log('No content received.')
        } else {
          // Content was streaming, just add newline
          console.log()
        }
        
        // Check if we should return to prompt immediately
        if (this.shouldReturnToPrompt) {
          this.shouldReturnToPrompt = false
          return // Early return to avoid context processing
        }

        // Handle caching and context
        const fullResponse = response.join('')
        if (command && command.isTranslation) {
          await cache.set(finalInput, fullResponse)
        } else {
          this.addToContext('user', finalInput)
          this.addToContext('assistant', fullResponse)
          
          const maxHistory = configManager.get('maxContextHistory')
          if (this.state.contextHistory.length > maxHistory) {
            this.state.contextHistory = this.state.contextHistory.slice(-maxHistory)
          }
          
          const historyDots = '.'.repeat(this.state.contextHistory.length)
          console.log(color.yellow + historyDots + color.reset)
        }
      }
    } catch (error) {
      if (interval) clearInterval(interval)
      process.stdout.write('')
      const finalTime = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : 'N/A'

      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        console.log(`${color.red}☓${color.reset} ${finalTime}s\n`)
      } else {
        errorHandler.handleError(error, { context: 'ai_processing' })
      }
    } finally {
      // Critical: Always clean up properly
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      if (this.currentSpinnerInterval) {
        clearInterval(this.currentSpinnerInterval)
        this.currentSpinnerInterval = null
      }
      
      // Clear request state
      this.isProcessingRequest = false
      this.currentRequestController = null
      this.currentStreamProcessor = null
      
      // Show cursor
      process.stdout.write('\x1B[?25h') // Show cursor
    }
  }

  /**
   * Find command in instructions
   */
  findCommand(str) {
    const TRANSLATION_KEYS = [
      'RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS'
    ]
    
    const arr = str.trim().split(' ')
    const commandKey = arr.shift()
    
    for (const prop in INSTRUCTIONS) {
      if (INSTRUCTIONS[prop].key.includes(commandKey)) {
        const restString = arr.join(' ')
        return {
          fullInstruction: `${INSTRUCTIONS[prop].instruction}: ${restString}`,
          isTranslation: TRANSLATION_KEYS.includes(prop),
        }
      }
    }
    return null
  }

  /**
   * Find suitable model from defaults
   */
  findModel(defaultModels, models) {
    for (const defaultModel of defaultModels) {
      const currentModel = models.find((modelId) => modelId.includes(defaultModel))
      if (currentModel) {
        return currentModel
      }
    }
    return models[0]
  }

  /**
   * Process MCP input and enhance with external data
   */
  async processMCPInput(input) {
    try {
      // Detect if input requires MCP processing
      if (!intentDetector.requiresMCP(input)) {
        return null
      }
      
      const intents = intentDetector.detectIntent(input)
      if (intents.length === 0) {
        return null
      }
      
      const routing = intentDetector.getMCPRouting(intents)
      if (!routing) {
        return null
      }
      
      logger.debug(`MCP routing: ${routing.server}/${routing.tool}`)
      
      // Call MCP server
      const mcpData = await this.callMCPServer(routing.server, routing.tool, routing.args)
      
      if (!mcpData) {
        return null
      }
      
      // Format the MCP data for AI consumption
      const formattedData = this.formatMCPData(mcpData, intents[0])
      
      // Detect language from original input for response
      const isRussian = /[а-яё]/i.test(input)
      const language = isRussian ? 'русском' : 'English'
      
      // Create language instruction based on detected language
      const languageInstruction = isRussian 
        ? 'Отвечай на русском языке простым текстом без markdown разметки (без **, ###, -, •). Используй только простой текст с переносами строк для структуры.'
        : 'Please respond in English using plain text without markdown formatting (no **, ###, -, •). Use only plain text with line breaks for structure.'
      
      // For some intents, we might want to show data directly
      if (intents[0].type === 'webpage' && formattedData.content) {
        // For webpage extractions, show enhanced content and pass to AI
        const enhancedInput = `${input}\n\nContent from webpage:\n${formattedData.text}\n\n${languageInstruction}`
        return {
          enhancedInput,
          showMCPData: true,
          mcpData: formattedData
        }
      }
      
      // Enhance input with MCP data
      const enhancedInput = `${input}\n\n[Additional context from web search/fetch:]\n${formattedData.text}\n\n${languageInstruction}`
      
      return {
        enhancedInput,
        mcpData: formattedData
      }
      
    } catch (error) {
      logger.error('MCP processing failed:', error)
      return null
    }
  }

  /**
   * Call MCP server with error handling
   */
  async callMCPServer(serverName, toolName, args) {
    try {
      logger.debug(`Calling MCP: ${serverName}/${toolName}`)
      
      // For built-in servers, call directly
      if (serverName === 'fetch') {
        return await fetchMCPServer.callTool(toolName, args)
      } else if (serverName === 'web-search') {
        return await searchMCPServer.callTool(toolName, args)
      }
      
      // For external servers, use MCP manager
      return await mcpManager.callTool(serverName, toolName, args)
      
    } catch (error) {
      logger.error(`MCP call failed: ${error.message}`)
      throw error
    }
  }

  /**
   * Format MCP data for AI consumption
   */
  formatMCPData(mcpData, intent) {
    switch (intent.type) {
      case 'webpage':
        return {
          type: 'webpage',
          url: mcpData.url,
          title: mcpData.title,
          content: mcpData.content,
          summary: `${mcpData.title}\n\n${mcpData.content.substring(0, 500)}${mcpData.content.length > 500 ? '...' : ''}`,
          text: `Website: ${mcpData.url}\nTitle: ${mcpData.title}\nContent: ${mcpData.content}`
        }
      
      
      case 'search':
        const searchResults = mcpData.results || []
        const searchSummary = searchResults.map(result => 
          `• ${result.title}\n  ${result.content}\n  ${result.url}`
        ).join('\n\n')
        
        return {
          type: 'search',
          query: mcpData.query,
          results: searchResults,
          summary: `Search Results: ${mcpData.query}\n\n${searchSummary}`,
          text: `Search results for "${mcpData.query}":\n\n${searchSummary}`
        }
      
      default:
        return {
          type: 'unknown',
          text: JSON.stringify(mcpData, null, 2)
        }
    }
  }




  /**
   * Main application loop
   */
  async run() {
    process.title = this.aiState.model
    // Don't log here as it interferes with the prompt
    
    while (true) {
      const colorInput = this.aiState.model.includes('chat') ? color.green : color.yellow
      let userInput = await rl.question(`${colorInput}> `)
      userInput = userInput.trim()

      if (!userInput) {
        if (this.state.contextHistory.length) {
          this.clearContext()
          console.log(color.yellow + 'Context history cleared')
        } else {
          setTimeout(() => process.stdout.write('\x1b[2J\x1b[0;0H> '), APP_CONSTANTS.CLEAR_TIMEOUT)
        }
        continue
      }

      try {
        // Validate and sanitize input
        userInput = sanitizeString(userInput)
        
        if (userInput.length > configManager.get('maxInputLength')) {
          console.log(`${color.red}Error: Input too long (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
          continue
        }
        
        validateString(userInput, 'user input', true)
        
        // Check if it's a command first
        const words = userInput.trim().split(' ')
        const commandName = words[0]
        const args = words.slice(1)
        
        if (this.commands.hasCommand(commandName) || this.aiCommands.hasCommand(commandName)) {
          const startTime = Date.now()
          try {
            let result
            
            // Try AI commands first, then core commands
            if (this.aiCommands.hasCommand(commandName)) {
              result = await this.aiCommands.executeCommand(commandName, args, {
                app: this,
                user: this.state.userSession
              })
              if (result) console.log(result)
            } else {
              result = await this.commands.executeCommand(commandName, args, {
                app: this,
                user: this.state.userSession
              })
              if (result) console.log(result)
            }
            
            const duration = Date.now() - startTime
            logger.debug(`Command executed: ${commandName} (${duration}ms)`)
            
          } catch (error) {
            logger.error(`Command failed: ${commandName} - ${error.message}`)
            errorHandler.handleError(error, { context: 'command_execution', command: commandName })
            throw error
          }
        } else {
          // Process as AI input
          await this.processAIInput(userInput)
        }
        
      } catch (error) {
        errorHandler.handleError(error, { context: 'user_input' })
        continue
      }
    }
  }
}

/**
 * Start the application
 */
async function start() {
  const aiApp = new AIApplication()
  
  try {
    logger.debug('Starting AI application')
    await aiApp.initialize()
    await aiApp.initializeAI()
    // Don't log here as it interferes with first prompt
    await aiApp.run()
  } catch (error) {
    errorHandler.handleError(error, { context: 'application_start', fatal: true })
    process.exit(1)
  }
}

start()