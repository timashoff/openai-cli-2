#!/usr/bin/env node

/**
 * AI CLI Application - Phase 2 Complete Architecture 
 * Integrates existing business logic with new core/ and commands/ architecture
 */

import { Application } from '../utils/application.js'
import { CommandManager } from '../utils/command-manager.js'
import { rl } from '../utils/index.js'
import { color } from '../config/color.js'
import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { getClipboardContent, openInBrowser, getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { createProvider } from '../utils/provider-factory.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { SYS_INSTRUCTIONS } from '../config/instructions.js'
import { migrateInstructionsToDatabase, getInstructionsFromDatabase } from '../utils/migration.js'
import { CommandEditor } from '../utils/command-editor.js'
import cache from '../utils/cache.js'
import { errorHandler } from '../utils/error-handler.js'
import { logger } from '../utils/logger.js'
import readline from 'node:readline'
import { mcpManager } from '../utils/mcp-manager.js'
import { intentDetector } from '../utils/intent-detector.js'
import { fetchMCPServer } from '../utils/fetch-mcp-server.js'
import { searchMCPServer } from '../utils/search-mcp-server.js'
import { readFile } from 'node:fs/promises'
import { multiProviderTranslator } from '../utils/multi-provider-translator.js'
import { fileManager } from '../utils/file-manager.js'
import { multiCommandProcessor } from '../utils/multi-command-processor.js'
import { ServiceManager, getServiceManager } from '../services/service-manager.js'

// Phase 2 Components
import { CommandExecutor } from '../commands/CommandExecutor.js'
import { ProviderCommand } from '../commands/ProviderCommand.js'
import { ModelCommand } from '../commands/ModelCommand.js'
import { HelpCommand } from '../commands/HelpCommand.js'

/**
 * Phase 2 AI Application with integrated business logic
 */
class AIApplication extends Application {
  constructor() {
    super()
    
    // AI state
    this.aiState = {
      provider: null,
      models: [],
      model: '',
      selectedProviderKey: ''
    }
    
    // Command managers
    this.aiCommands = new CommandManager()
    
    // Modern command system (Phase 2)
    this.commandExecutor = null
    this.providerCommand = null
    this.modelCommand = null
    this.helpCommand = null
    
    // Legacy systems
    this.commandEditor = new CommandEditor(this)
    this.serviceManager = getServiceManager(this)
    
    // Request state
    this.isProcessingRequest = false
    this.isTypingResponse = false
    this.currentRequestController = null
    this.currentSpinnerInterval = null
    this.currentStreamProcessor = null
    this.shouldReturnToPrompt = false
    this.isRetryingProvider = false
    
    this.setupCleanupHandlers()
  }

  /**
   * Setup global cleanup handlers (from original)
   */
  setupCleanupHandlers() {
    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.removeAllListeners('keypress')
      process.stdout.write('\x1B[?25h')
    }
    
    const globalKeyPressHandler = (str, key) => {
      if (key && key.name === 'escape') {
        if (this.isProcessingRequest && this.currentRequestController) {
          if (this.currentSpinnerInterval) {
            clearInterval(this.currentSpinnerInterval)
            this.currentSpinnerInterval = null
          }
          
          clearTerminalLine()
          this.currentRequestController.abort()
          this.isProcessingRequest = false
          
          if (this.currentStreamProcessor) {
            this.currentStreamProcessor.forceTerminate()
          }
          
          process.stdout.write('\x1B[?25h')
          
        } else if (this.isTypingResponse) {
          console.log()
          this.isTypingResponse = false
          this.shouldReturnToPrompt = true
          process.stdout.write('\x1B[?25h')
        }
      }
    }
    
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.on('keypress', globalKeyPressHandler)
    
    process.on('SIGINT', () => {
      cleanup()
      console.log('\\n[Application terminated by user]')
      process.exit(0)
    })
    
    process.on('SIGTERM', cleanup)
    process.on('exit', cleanup)
  }

  /**
   * Initialize Phase 2 architecture
   */
  async initializePhase2Architecture() {
    logger.debug('🚀 Initializing Phase 2 Architecture')
    
    // Initialize modern commands with business logic
    this.providerCommand = new ProviderCommand({
      app: this,
      serviceManager: this.serviceManager,
      aiState: this.aiState,
      rl
    })
    
    this.modelCommand = new ModelCommand({
      app: this,
      aiState: this.aiState,
      rl  
    })
    
    this.helpCommand = new HelpCommand({
      app: this
    })
    
    // Initialize command executor
    this.commandExecutor = new CommandExecutor({
      app: this,
      providerCommand: this.providerCommand,
      modelCommand: this.modelCommand,
      helpCommand: this.helpCommand
    })
    
    logger.debug('✅ Phase 2 Architecture initialized')
  }

  /**
   * Register AI commands (integrated with business logic)
   */
  async registerAICommands() {
    const { BaseCommand } = await import('../utils/command-manager.js')
    
    // Provider command with full business logic
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
    
    // Model command with full business logic
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
    
    // Web command (original business logic)
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('web', 'Open link in browser', {
          aliases: ['w'],
          usage: 'web <number>',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        if (args.length === 0) {
          return `${color.yellow}Usage: web <number> or web-<number>${color.reset}\\nExample: web 1 or web-5 - opens link from recent extraction`
        }
        
        let linkNumber
        if (args[0].startsWith('-')) {
          linkNumber = parseInt(args[0].substring(1))
        } else {
          linkNumber = parseInt(args[0])
        }
        
        if (isNaN(linkNumber) || linkNumber < 1) {
          return `${color.red}Error: Please provide a valid link number (1, 2, 3, etc.) or use web-N format${color.reset}`
        }
        
        return await context.app.openLinkInBrowser(linkNumber)
      }
    })
    
    // CMD command (original business logic)
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('cmd', 'Manage custom commands', {
          aliases: ['кмд'],
          usage: 'cmd',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        await context.app.commandEditor.showCommandMenu()
        return ''
      }
    })
  }

  /**
   * Initialize AI components (with original business logic)
   */
  async initializeAI() {
    await this.registerAICommands()
    await cache.initialize()
    await this.initializeMCP()
    await multiProviderTranslator.initialize()
    await multiCommandProcessor.initialize()
    
    // Initialize Phase 2 architecture
    await this.initializePhase2Architecture()
  }

  /**
   * Initialize MCP components (original logic)
   */
  async initializeMCP() {
    try {
      logger.debug('Initializing MCP servers')
      
      const mcpConfigPath = new URL('../config/mcp-servers.json', import.meta.url).pathname
      const mcpConfigContent = await readFile(mcpConfigPath, 'utf-8')
      const mcpConfig = JSON.parse(mcpConfigContent)
      
      mcpConfig.fetch.server = fetchMCPServer
      mcpConfig['web-search'].server = searchMCPServer
      
      await mcpManager.initialize(mcpConfig)
      
      logger.debug('MCP servers initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize MCP servers:', error)
    }
  }

  /**
   * Switch AI model (original business logic)
   */
  async switchModel() {
    const { execModel } = await import('../utils/index.js')
    
    logger.debug('Starting model selection')
    try {
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      const newModel = await execModel(this.aiState.model, this.aiState.models, rl)
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
   * Switch AI provider (original business logic with ServiceManager)
   */
  async switchProvider() {
    const { execProvider } = await import('../utils/provider/execProvider.js')
    
    logger.debug('Starting provider selection')
    try {
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      const aiService = this.serviceManager.getAIProviderService()
      if (!aiService) {
        throw new Error('AI provider service not available')
      }
      
      const availableProviders = aiService.getAvailableProviders()
      const currentProvider = aiService.getCurrentProvider()
      
      if (availableProviders.length === 0) {
        console.log(`${color.yellow}No providers available${color.reset}`)
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }
      
      if (availableProviders.length === 1) {
        console.log(`${color.yellow}Only one provider available: ${availableProviders[0].name}${color.reset}`)
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }

      const selectedProvider = await execProvider(currentProvider.key, availableProviders, rl)
      
      if (!selectedProvider) {
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }
      
      if (selectedProvider.key === currentProvider.key) {
        console.log(`${color.yellow}Already using ${selectedProvider.name}${color.reset}`)
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }

      const switchResult = await this.serviceManager.switchProvider(selectedProvider.key)
      
      const newCurrentProvider = aiService.getCurrentProvider()
      this.aiState.provider = newCurrentProvider.instance
      this.aiState.selectedProviderKey = newCurrentProvider.key
      this.aiState.model = newCurrentProvider.model
      this.aiState.models = switchResult.availableModels || []
      
      process.title = this.aiState.model

      logger.debug(`Provider switched to: ${newCurrentProvider.key} with model: ${newCurrentProvider.model}`)

      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(true)
      }
    } catch (error) {
      errorHandler.handleError(error, { context: 'provider_switch' })
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
    }
  }

  /**
   * Process AI input (original business logic with MCP and streaming)
   */
  async processAIInput(input) {
    // Critical business logic - keep original implementation
    let interval
    let startTime
    const originalInput = input

    this.currentRequestController = new AbortController()
    this.isProcessingRequest = true

    // Check for clipboard content FIRST
    if (input.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      try {
        const buffer = await getClipboardContent()
        const sanitizedBuffer = sanitizeString(buffer)
        validateString(sanitizedBuffer, 'clipboard content', false)
        
        if (sanitizedBuffer.length > configManager.get('maxInputLength')) {
          console.log(`${color.red}Error: Clipboard content too large (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
          return
        }
        
        input = input.replace(new RegExp(APP_CONSTANTS.CLIPBOARD_MARKER.replace(/\\$/g, '\\\\$'), 'g'), sanitizedBuffer)
        console.log(`${color.grey}[Clipboard content inserted (${sanitizedBuffer.length} chars)]${color.reset}`)
      } catch (error) {
        errorHandler.handleError(error, { context: 'clipboard_read' })
        return
      }
    }

    // Check for force flags (SIMPLE STRING VERSION)
    let forceRequest = false
    const forceFlags = ['-f', '--force']
    for (const baseFlag of forceFlags) {
      if (input.endsWith(' ' + baseFlag) || input.endsWith(baseFlag)) {
        forceRequest = true
        input = input.replace(' ' + baseFlag, '').replace(baseFlag, '').trim()
        break
      }
    }

    // Find command
    const command = this.findCommand(input)

    // Handle MCP processing (simplified for Phase 2)
    if (command && command.hasUrl) {
      const mcpResult = await this.processMCPInput(command.targetContent, command)
      if (mcpResult && mcpResult.mcpData) {
        console.log(`\\n${color.cyan}[MCP]${color.reset}`)
        console.log(`${color.grey}Source: ${mcpResult.mcpData.url}${color.reset}`)
        console.log(`${color.grey}Content: ${mcpResult.mcpData.content.length} chars${color.reset}`)
        
        if (command.isTranslation) {
          const webTranslationInstruction = command.instruction.replace('text', 'entire article/webpage content completely')
          input = `${webTranslationInstruction}: ${mcpResult.mcpData.content}`
        } else {
          input = mcpResult.enhancedInput
        }
      } else {
        input = command.fullInstruction
      }
    } else if (command && command.isTranslation) {
      input = command.fullInstruction
    } else {
      const mcpResult = await this.processMCPInput(input, command)
      if (mcpResult) {
        input = mcpResult.enhancedInput
        if (mcpResult.directResponse) {
          console.log(`\\n${color.cyan}[MCP Data]${color.reset}`)
          console.log(mcpResult.directResponse)
          return
        }
        if (mcpResult.showMCPData) {
          console.log(`\\n${color.cyan}[MCP]${color.reset}`)
          console.log(`${color.grey}Source: ${mcpResult.mcpData.url}${color.reset}`)
          console.log(`${color.grey}Content: ${mcpResult.mcpData.content.length} chars${color.reset}`)
        }
      }
    }

    const finalInput = (command && command.isTranslation && command.hasUrl) ? input : 
                      (command ? command.fullInstruction : input)
    
    // Create normalized cache key WITHOUT force flags
    let rawCacheKey = (command && command.isTranslation && command.hasUrl) ? command.originalInput : finalInput
    let cacheKey = rawCacheKey
    // Use already declared forceFlags from above
    for (const flag of forceFlags) {
      cacheKey = cacheKey.replace(' ' + flag, '').replace(flag, '').trim()
    }

    // Handle multi-provider commands
    if (command && command.isMultiProvider && !forceRequest && 
        !(command.models && Array.isArray(command.models) && command.models.length > 1)) {
      if (cache.hasMultipleResponses(cacheKey)) {
        console.log(`${color.yellow}[from cache]${color.reset}`)
        const cachedResponses = cache.getMultipleResponses(cacheKey)
        const formattedResponse = multiProviderTranslator.formatMultiProviderResponse({ 
          translations: cachedResponses.map(r => ({ ...r, emoji: undefined })),
          elapsed: 0,
          successful: cachedResponses.filter(r => r.response && !r.error).length,
          total: cachedResponses.length
        })
        process.stdout.write(formattedResponse + '\\n')
        return
      }
      
      try {
        const result = await multiProviderTranslator.translateMultiple(
          command.commandType,
          command.instruction,
          command.targetContent,
          this.currentRequestController.signal,
          command.models
        )
        
        const formattedResponse = multiProviderTranslator.formatMultiProviderResponse(result)
        process.stdout.write(formattedResponse + '\\n')
        
        await cache.setMultipleResponses(cacheKey, result.translations)
        return
      } catch (error) {
        errorHandler.handleError(error, { context: 'multi_provider_translation' })
        return
      }
    }

    // Standard single-provider translation cache check
    if (command && command.isTranslation && !forceRequest && cache.has(cacheKey)) {
      console.log(`${color.yellow}[from cache]${color.reset}`)
      process.stdout.write(cache.get(cacheKey) + '\\n')
      return
    }

    try {
      let messages = []
      if (command && command.isTranslation) {
        messages = [{ role: 'user', content: finalInput }]
      } else {
        messages = this.state.contextHistory.map(({ role, content }) => ({ role, content }))
        messages.push({ role: 'user', content: finalInput })
      }

      startTime = Date.now()

      let i = 0
      process.stdout.write('\x1B[?25l')
      this.currentSpinnerInterval = setInterval(() => {
        clearTerminalLine()
        const elapsedTime = getElapsedTime(startTime)
        process.stdout.write(
          `${color.reset}${UI_SYMBOLS.SPINNER[i++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s${color.reset}`,
        )
      }, configManager.get('spinnerInterval'))
      interval = this.currentSpinnerInterval

      const stream = await this.aiState.provider.createChatCompletion(this.aiState.model, messages, {
        stream: true,
        signal: this.currentRequestController.signal
      })

      const streamProcessor = new StreamProcessor(this.aiState.selectedProviderKey)
      this.currentStreamProcessor = streamProcessor
      let response = []
      let firstChunk = true
      
      const onChunk = async (content) => {
        if (this.currentRequestController?.signal?.aborted || this.shouldReturnToPrompt) {
          return
        }
        
        if (firstChunk) {
          clearInterval(this.currentSpinnerInterval)
          this.currentSpinnerInterval = null
          
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('success', finalTime)
          
          this.isProcessingRequest = false
          this.isTypingResponse = true
          firstChunk = false
        }
        
        if (this.isTypingResponse) {
          process.stdout.write(content)
        }
      }
      
      try {
        response = await Promise.race([
          streamProcessor.processStream(stream, this.currentRequestController.signal, onChunk),
          new Promise((resolve, reject) => {
            const abortHandler = () => {
              setTimeout(() => reject(new Error('AbortError')), 0)
            }
            
            if (this.currentRequestController && this.currentRequestController.signal) {
              this.currentRequestController.signal.addEventListener('abort', abortHandler, { once: true })
            }
            
            const rapidCheck = () => {
              if (!this.currentRequestController || !this.currentRequestController.signal) {
                return
              }
              
              if (this.currentStreamProcessor?.isTerminated || this.shouldReturnToPrompt) {
                setTimeout(() => reject(new Error('AbortError')), 0)
              } else if (!this.currentRequestController.signal.aborted) {
                setTimeout(rapidCheck, 5)
              }
            }
            rapidCheck()
          })
        ])
      } catch (error) {
        if (error.message === 'AbortError' || error.name === 'AbortError' || error.message.includes('aborted')) {
          response = []
        } else {
          throw error
        }
      }

      clearInterval(interval)

      if (this.currentRequestController.signal.aborted || this.shouldReturnToPrompt) {
        if (firstChunk) {
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('error', finalTime)
        }
        
        this.shouldReturnToPrompt = false
        this.isTypingResponse = false
        return
      } else {
        this.isTypingResponse = false
        
        if (firstChunk) {
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('success', finalTime, 'No content received.')
        } else {
          if (command && command.isTranslation) {
            process.stdout.write('\n')
          }
        }
        
        if (this.shouldReturnToPrompt) {
          this.shouldReturnToPrompt = false
          return
        }

        const fullResponse = response.join('')
        if (command && command.isTranslation) {
          await cache.set(cacheKey, fullResponse)
        } else {
          this.addToContext('user', finalInput)
          this.addToContext('assistant', fullResponse)
          
          const maxHistory = configManager.get('maxContextHistory')
          if (this.state.contextHistory.length > maxHistory) {
            this.state.contextHistory = this.state.contextHistory.slice(-maxHistory)
          }
          
          const historyDots = '.'.repeat(this.state.contextHistory.length)
          process.stdout.write('\n' + color.yellow + historyDots + color.reset + '\n')
        }
      }
    } catch (error) {
      if (interval) clearInterval(interval)
      process.stdout.write('')
      const finalTime = getElapsedTime(startTime)

      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        clearTerminalLine()
        showStatus('error', finalTime)
      } else {
        clearTerminalLine()
        showStatus('error', finalTime)
        errorHandler.handleError(error, { context: 'ai_processing' })
      }
    } finally {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      if (this.currentSpinnerInterval) {
        clearInterval(this.currentSpinnerInterval)
        this.currentSpinnerInterval = null
      }
      
      this.isProcessingRequest = false
      this.currentRequestController = null
      this.currentStreamProcessor = null
      
      process.stdout.write('\x1B[?25h')
    }
  }

  /**
   * Find command in instructions (original logic)
   */
  findCommand(str) {
    const TRANSLATION_KEYS = [
      'RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS'
    ]
    
    const DOC_COMMANDS = ['doc']
    
    const arr = str.trim().split(' ')
    const commandKey = arr.shift()
    
    const INSTRUCTIONS = getInstructionsFromDatabase()
    for (const prop in INSTRUCTIONS) {
      if (INSTRUCTIONS[prop].key.includes(commandKey)) {
        const restString = arr.join(' ')
        const isTranslation = TRANSLATION_KEYS.includes(prop)
        const isDocCommand = prop === 'DOC' || DOC_COMMANDS.includes(commandKey)
        
        const hasMultipleModels = INSTRUCTIONS[prop].models && 
                                  Array.isArray(INSTRUCTIONS[prop].models) && 
                                  INSTRUCTIONS[prop].models.length > 1
        const isMultiProvider = hasMultipleModels
        
        const hasUrl = restString && (restString.startsWith('http') || restString.includes('://'))
        
        return {
          fullInstruction: `${INSTRUCTIONS[prop].instruction}: ${restString}`,
          isTranslation,
          isDocCommand,
          isMultiProvider,
          hasUrl,
          originalInput: str,
          commandKey,
          commandType: prop,
          targetContent: restString,
          instruction: INSTRUCTIONS[prop].instruction,
          models: INSTRUCTIONS[prop].models || null
        }
      }
    }
    return null
  }

  /**
   * Process MCP input (simplified for Phase 2)
   */
  async processMCPInput(input, command = null) {
    try {
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
      
      const mcpData = await this.callMCPServer(routing.server, routing.tool, routing.args)
      
      if (!mcpData) {
        return null
      }
      
      const formattedData = this.formatMCPData(mcpData, intents[0], command)
      
      const isRussianInput = /[а-яё]/i.test(input)
      const language = isRussianInput ? 'русском' : 'English'
      const languageInstruction = isRussianInput 
        ? 'ОБЯЗАТЕЛЬНО отвечай на русском языке!'
        : 'MUST respond in English!'
      
      if ((intents[0].type === 'webpage' || intents[0].type === 'follow_link') && formattedData.content) {
        const enhancedInput = `${input}\\n\\nContent from webpage:\\n${formattedData.text}\\n\\n${languageInstruction}`
        return {
          enhancedInput,
          showMCPData: true,
          mcpData: formattedData
        }
      }
      
      const enhancedInput = `${input}\\n\\n[Additional context from web search/fetch:]\\n${formattedData.text}\\n\\n${languageInstruction}`
      
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
   * Call MCP server (original logic)
   */
  async callMCPServer(serverName, toolName, args) {
    try {
      logger.debug(`Calling MCP: ${serverName}/${toolName}`)
      
      if (serverName === 'fetch') {
        return await fetchMCPServer.callTool(toolName, args)
      } else if (serverName === 'web-search') {
        return await searchMCPServer.callTool(toolName, args)
      }
      
      return await mcpManager.callTool(serverName, toolName, args)
      
    } catch (error) {
      logger.error(`MCP call failed: ${error.message}`)
      throw error
    }
  }

  /**
   * Format MCP data (original logic)
   */
  formatMCPData(mcpData, intent, command = null) {
    switch (intent.type) {
      case 'webpage':
      case 'follow_link':
        let linksText = ''
        if (mcpData.links && mcpData.links.length > 0 && !(command && command.isTranslation)) {
          linksText = '\\n\\nRelated links found in this article:\\n' + 
            mcpData.links.map((link, index) => `${index + 1}. ${link.text} [web]`).join('\\n')
        }
        
        let followedFromText = ''
        if (mcpData.followedFrom) {
          followedFromText = `\\n\\n[Followed from: ${mcpData.followedFrom.linkText}]`
        }
        
        return {
          type: 'webpage',
          url: mcpData.url,
          title: mcpData.title,
          content: mcpData.content,
          links: mcpData.links || [],
          followedFrom: mcpData.followedFrom,
          summary: `${mcpData.title}\\n\\n${mcpData.content.substring(0, 500)}${mcpData.content.length > 500 ? '...' : ''}`,
          text: `Website: ${mcpData.url}\\nTitle: ${mcpData.title}${followedFromText}\\nContent: ${mcpData.content}${linksText}`
        }
      
      case 'search':
        const searchResults = mcpData.results || []
        const searchSummary = searchResults.map(result => 
          `• ${result.title}\\n  ${result.content}\\n  ${result.url}`
        ).join('\\n\\n')
        
        return {
          type: 'search',
          query: mcpData.query,
          results: searchResults,
          summary: `Search Results: ${mcpData.query}\\n\\n${searchSummary}`,
          text: `Search results for "${mcpData.query}":\\n\\n${searchSummary}`
        }
      
      default:
        return {
          type: 'unknown',
          text: JSON.stringify(mcpData, null, 2)
        }
    }
  }

  /**
   * Open link in browser (original logic)
   */
  async openLinkInBrowser(linkNumber) {
    try {
      if (!fetchMCPServer.recentExtractions || fetchMCPServer.recentExtractions.size === 0) {
        return `${color.red}Error: No recent extractions found. Please extract content from a webpage first.${color.reset}`
      }
      
      const entries = Array.from(fetchMCPServer.recentExtractions.entries())
      const mostRecentExtraction = entries[entries.length - 1][1]
      
      if (!mostRecentExtraction.links || mostRecentExtraction.links.length === 0) {
        return `${color.red}Error: No links found in recent extraction.${color.reset}`
      }
      
      if (linkNumber > mostRecentExtraction.links.length) {
        return `${color.red}Error: Link ${linkNumber} does not exist. Available links: 1-${mostRecentExtraction.links.length}${color.reset}`
      }
      
      const link = mostRecentExtraction.links[linkNumber - 1]
      
      await openInBrowser(link.url)
      
      return `${color.green}✓${color.reset} Opened link ${linkNumber} in browser: ${color.cyan}${link.text}${color.reset}\\n${color.grey}URL: ${link.url}${color.reset}`
      
    } catch (error) {
      logger.error(`Failed to open link in browser: ${error.message}`)
      return `${color.red}Error: Failed to open link in browser. ${error.message}${color.reset}`
    }
  }

  /**
   * Check if command is system command
   */
  isSystemCommand(commandName) {
    for (const prop in SYS_INSTRUCTIONS) {
      if (SYS_INSTRUCTIONS[prop].key && SYS_INSTRUCTIONS[prop].key.includes(commandName)) {
        return true
      }
    }
    return false
  }

  /**
   * Main application run loop
   */
  async run() {
    await migrateInstructionsToDatabase()
    
    // Start loading spinner for provider initialization
    let spinnerIndex = 0
    let spinnerInterval = null
    const initStartTime = Date.now()
    
    try {
      // Show loading spinner
      process.stdout.write('\x1B[?25l') // Hide cursor
      spinnerInterval = setInterval(() => {
        clearTerminalLine()
        const elapsedTime = getElapsedTime(initStartTime)
        process.stdout.write(
          `${color.reset}${UI_SYMBOLS.SPINNER[spinnerIndex++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s Loading AI providers...${color.reset}`
        )
      }, APP_CONSTANTS.SPINNER_INTERVAL)
      
      await this.serviceManager.initialize()
      
      // Clear spinner and show cursor
      if (spinnerInterval) {
        clearInterval(spinnerInterval)
        spinnerInterval = null
      }
      clearTerminalLine()
      const finalTime = getElapsedTime(initStartTime)
      process.stdout.write(`✓ ${finalTime}s\n`)
      process.stdout.write('\x1B[?25h') // Show cursor
      
      // Show current model info after spinner cleanup
      const aiService = this.serviceManager.getAIProviderService()
      if (aiService) {
        const currentProvider = aiService.getCurrentProvider()
        if (currentProvider && currentProvider.key) {
          const providerName = API_PROVIDERS[currentProvider.key]?.name || currentProvider.key
          const modelName = currentProvider.model || 'unknown'
          console.log(`current model is ${providerName} ${modelName}`)
        }
      }
      
    } catch (error) {
      // Clear spinner on error
      if (spinnerInterval) {
        clearInterval(spinnerInterval)
        spinnerInterval = null
      }
      clearTerminalLine()
      process.stdout.write('\x1B[?25h') // Show cursor
      console.warn(`${color.yellow}Warning: Service manager initialization failed: ${error.message}${color.reset}`)
      console.log(`${color.grey}Continuing with legacy architecture...${color.reset}`)
    }
    
    process.title = this.aiState.model
    
    let screenWasCleared = false
    
    while (true) {
      const colorInput = color.green
      const prompt = screenWasCleared ? `${colorInput}> ` : `\n${colorInput}> `
      let userInput = await rl.question(prompt)
      userInput = userInput.trim()
      
      // Reset screen cleared flag after prompt is shown
      screenWasCleared = false

      if (!userInput) {
        if (this.state.contextHistory.length) {
          this.clearContext()
          console.log(color.yellow + 'Context history cleared')
        } else {
          await new Promise(resolve => {
            setTimeout(() => {
              process.stdout.write('\x1b[2J\x1b[0;0H')
              screenWasCleared = true
              resolve()
            }, APP_CONSTANTS.CLEAR_TIMEOUT)
          })
        }
        continue
      }

      try {
        userInput = sanitizeString(userInput)
        
        if (userInput.length > configManager.get('maxInputLength')) {
          console.log(`${color.red}Error: Input too long (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
          continue
        }
        
        validateString(userInput, 'user input', true)
        
        const words = userInput.trim().split(' ')
        const commandName = words[0]
        const args = words.slice(1)
        
        if (this.isSystemCommand(commandName)) {
          if (commandName === 'cmd' || commandName === 'кмд') {
            await this.commandEditor.showCommandMenu()
            continue
          }
        }
        
        if (this.commands.hasCommand(commandName) || this.aiCommands.hasCommand(commandName)) {
          const startTime = Date.now()
          try {
            let result
            
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
          await this.processAIInput(userInput)
        }
        
      } catch (error) {
        if (error.message && (error.message.includes('Aborted with Ctrl+C') || 
            error.message === 'AbortError' || error.name === 'AbortError' ||
            error.message.includes('aborted') || error.message.includes('cancelled'))) {
          continue
        }
        errorHandler.handleError(error, { context: 'user_input' })
        continue
      }
    }
  }
}

/**
 * Start the Phase 2 application
 */
async function start() {
  const aiApp = new AIApplication()
  
  try {
    logger.debug('🚀 Starting Phase 2 AI Application')
    await aiApp.initialize()
    await aiApp.initializeAI()
    await aiApp.run()
  } catch (error) {
    errorHandler.handleError(error, { context: 'application_start', fatal: true })
    process.exit(1)
  }
}

start()