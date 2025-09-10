import { BaseService } from './base-service.js'
import { createBaseError } from '../core/error-system/index.js'

/**
 * MCP operation types
 */
export const MCPOperationType = {
  /** Extract content from webpage */
  WEBPAGE_EXTRACT: 'webpage_extract',
  /** Search the web */
  WEB_SEARCH: 'web_search',
  /** Follow a link */
  FOLLOW_LINK: 'follow_link',
  /** Generic MCP tool call */
  TOOL_CALL: 'tool_call'
}

/**
 * MCP processing result
 */

/**
 * Service responsible for Model Context Protocol integration
 * - Intent detection for MCP routing
 * - Web content extraction and search
 * - MCP server lifecycle management
 * - Response formatting and enhancement
 */
export class MCPService extends BaseService {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Object} */
    this.mcpManager = dependencies.mcpManager
    /** @type {Object} */
    this.intentDetector = dependencies.intentDetector
    /** @type {Object} */
    this.fetchServer = dependencies.fetchServer
    /** @type {Object} */
    this.searchServer = dependencies.searchServer
    /** @type {Map<string, Object>} */
    this.serverInstances = new Map()
    /** @type {Object} */
    this.serverConfigurations = {}
    /** @type {Map<string, number>} */
    this.operationStats = new Map()
    /** @type {Map<string, Date>} */
    this.lastOperations = new Map()
  }

  /**
   */
  getRequiredDependencies() {
    return ['eventBus', 'logger', 'mcpManager', 'intentDetector']
  }

  /**
   */
  async onInitialize() {
    await this.initializeMCPServers()
    this.log('info', 'MCPService initialized')
  }

  /**
   */
  async onDispose() {
    await this.shutdownMCPServers()
    this.log('info', 'MCPService disposed')
  }

  /**
   * Process input through MCP if applicable



   */
  async processMCPInput(input, command = null) {
    this.ensureReady()
    
    if (!input || typeof input !== 'string') {
      return null
    }

    try {
      // Detect if input requires MCP processing
      if (!this.intentDetector.requiresMCP(input)) {
        this.log('debug', 'Input does not require MCP processing')
        return null
      }
      
      const intents = this.intentDetector.detectIntent(input)
      if (intents.length === 0) {
        this.log('debug', 'No MCP intents detected')
        return null
      }
      
      const routing = this.intentDetector.getMCPRouting(intents)
      if (!routing) {
        this.log('debug', 'No MCP routing found')
        return null
      }
      
      this.log('info', `Processing MCP operation: ${routing.server}/${routing.tool}`)
      
      // Execute MCP operation
      const mcpData = await this.callMCPServer(routing.server, routing.tool, routing.args)
      
      if (!mcpData) {
        this.log('warn', 'MCP operation returned no data')
        return null
      }
      
      // Format the result
      const result = await this.formatMCPResult(mcpData, intents[0], command, input)
      
      // Update statistics
      this.updateOperationStats(routing.server, routing.tool, true)
      
      // Emit success event
      this.emitMCPEvent('operation:completed', {
        server: routing.server,
        tool: routing.tool,
        intent: intents[0].type,
        success: true
      })
      
      return result
      
    } catch (error) {
      this.log('error', `MCP processing failed: ${error.message}`)
      
      // Update statistics
      this.updateOperationStats('unknown', 'unknown', false, error.message)
      
      // Emit error event
      this.emitMCPEvent('operation:failed', {
        error: error.message,
        input: input.substring(0, 100)
      })
      
      return null
    }
  }

  /**
   * Extract content from webpage



   */
  async extractWebpage(url, options = {}) {
    this.ensureReady()
    
    this.log('info', `Extracting webpage content: ${url}`)
    
    try {
      const result = await this.callMCPServer('fetch', 'extract_content', { url, ...options })
      
      this.updateOperationStats('fetch', 'extract_content', true)
      this.emitMCPEvent('webpage:extracted', { url, success: true })
      
      return result
    } catch (error) {
      this.updateOperationStats('fetch', 'extract_content', false, error.message)
      this.emitMCPEvent('webpage:extraction_failed', { url, error: error.message })
      throw error
    }
  }

  /**
   * Search the web



   */
  async searchWeb(query, options = {}) {
    this.ensureReady()
    
    this.log('info', `Performing web search: ${query}`)
    
    try {
      const result = await this.callMCPServer('web-search', 'search', { query, ...options })
      
      this.updateOperationStats('web-search', 'search', true)
      this.emitMCPEvent('search:completed', { query, success: true })
      
      return result
    } catch (error) {
      this.updateOperationStats('web-search', 'search', false, error.message)
      this.emitMCPEvent('search:failed', { query, error: error.message })
      throw error
    }
  }

  /**
   * Follow a link from previous extraction



   */
  async followLink(linkNumber, options = {}) {
    this.ensureReady()
    
    this.log('info', `Following link: ${linkNumber}`)
    
    try {
      const result = await this.callMCPServer('fetch', 'follow_link', { linkNumber, ...options })
      
      this.updateOperationStats('fetch', 'follow_link', true)
      this.emitMCPEvent('link:followed', { linkNumber, success: true })
      
      return result
    } catch (error) {
      this.updateOperationStats('fetch', 'follow_link', false, error.message)
      this.emitMCPEvent('link:follow_failed', { linkNumber, error: error.message })
      throw error
    }
  }

  /**
   * Get MCP server status


   */
  getMCPServerStatus(serverName = null) {
    if (serverName) {
      const instance = this.serverInstances.get(serverName)
      return {
        name: serverName,
        isRunning: !!instance,
        lastOperation: this.lastOperations.get(serverName),
        operationCount: this.operationStats.get(`${serverName}:*`) || 0
      }
    }
    
    // Return all servers status
    const status = {}
    for (const [name] of this.serverInstances) {
      status[name] = this.getMCPServerStatus(name)
    }
    
    return status
  }

  /**
   * Get MCP operation statistics

   */
  getMCPStats() {
    const stats = {
      servers: this.serverInstances.size,
      totalOperations: 0,
      operationsByServer: {},
      recentOperations: [],
      errors: 0
    }
    
    for (const [key, count] of this.operationStats) {
      if (key.includes(':error')) {
        stats.errors += count
      } else {
        stats.totalOperations += count
        
        const [server, tool] = key.split(':')
        if (!stats.operationsByServer[server]) {
          stats.operationsByServer[server] = {}
        }
        stats.operationsByServer[server][tool] = count
      }
    }
    
    // Get recent operations (last 10)
    const recentEntries = Array.from(this.lastOperations.entries())
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .slice(0, 10)
    
    stats.recentOperations = recentEntries.map(([operation, timestamp]) => ({
      operation,
      timestamp
    }))
    
    return stats
  }

  /**
   * Call MCP server with error handling




   */
  async callMCPServer(serverName, toolName, args) {
    this.log('debug', `Calling MCP: ${serverName}/${toolName}`, { args })
    
    try {
      let result
      
      // Handle built-in servers
      if (serverName === 'fetch' && this.fetchServer) {
        result = await this.fetchServer.callTool(toolName, args)
      } else if (serverName === 'web-search' && this.searchServer) {
        result = await this.searchServer.callTool(toolName, args)
      } else if (this.mcpManager) {
        // Use MCP manager for external servers
        result = await this.mcpManager.callTool(serverName, toolName, args)
      } else {
        throw createBaseError(`MCP server not available: ${serverName}`, true, 503)
      }
      
      // Record successful operation
      this.recordOperation(serverName, toolName)
      
      return result
      
    } catch (error) {
      this.log('error', `MCP call failed: ${serverName}/${toolName} - ${error.message}`)
      throw createBaseError(`MCP operation failed: ${error.message}`, true, 500)
    }
  }

  /**
   * Format MCP result for AI consumption





   */
  async formatMCPResult(mcpData, intent, command, originalInput) {
    const result = {
      success: true,
      type: intent.type,
      data: mcpData,
      enhancedInput: originalInput,
      showMCPData: false,
      directResponse: null,
      metadata: {
        timestamp: new Date(),
        intent: intent.type,
        hasCommand: !!command
      }
    }
    
    switch (intent.type) {
      case 'webpage':
      case 'follow_link':
        return this.formatWebpageResult(mcpData, intent, command, originalInput, result)
        
      case 'search':
        return this.formatSearchResult(mcpData, intent, command, originalInput, result)
        
      default:
        result.enhancedInput = `${originalInput}\n\n[MCP Data:]\n${JSON.stringify(mcpData, null, 2)}`
        return result
    }
  }

  /**
   * Format webpage extraction result
   */
  formatWebpageResult(mcpData, intent, command, originalInput, result) {
    // Detect language preferences
    const isRussianInput = /[а-яё]/i.test(originalInput)
    const isForeignContent = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u0600-\u06ff]/i.test(mcpData.content || '')
    
    const language = isRussianInput ? 'русском' : 'English'
    const languageInstruction = isRussianInput 
      ? 'ОБЯЗАТЕЛЬНО отвечай на русском языке!'
      : 'MUST respond in English!'
    
    const contentLanguageInfo = isForeignContent
      ? (isRussianInput
        ? '\n\nВАЖНО: Контент на иностранном языке - переведи основную информацию на русский язык.'
        : '\n\nIMPORTANT: Content is in a foreign language - translate the main information to English.')
      : ''
    
    // Add link instructions if links are present (but not for translation commands)
    let linkInstructions = ''
    if (mcpData.links && mcpData.links.length > 0 && !(command && command.isTranslation)) {
      linkInstructions = isRussianInput 
        ? '\n\nОБЯЗАТЕЛЬНО отвечай на русском языке!\n\nВАЖНО: Умный вывод контента:\n' +
          '• Если это ГЛАВНАЯ СТРАНИЦА новостного сайта и контент состоит только из списка заголовков без статей, покажи заголовки как список ссылок в формате "• Название новости [web-N]".\n' +
          '• Если это ОТДЕЛЬНАЯ СТАТЬЯ, покажи полное содержимое статьи, а затем релевантные ссылки отдельно.\n' +
          '• Для ВСЕХ остальных сайтов показывай содержимое + ссылки отдельно.\n' +
          '• ОБЯЗАТЕЛЬНО добавь в конце понятные инструкции для пользователя на русском языке\n\n' +
          'Пользователь может:\n' +
          '- Написать "web-N" для получения содержимого ссылки (например, "web-5")\n' +
          '- Описать нужную ссылку ("открой новость про туризм")\n' +
          '- Использовать команду "web-N" чтобы открыть ссылку в браузере'
        : '\n\nMUST respond in English language!\n\nIMPORTANT: Smart content output:\n' +
          '• If this is a MAIN PAGE of a news website and content consists only of headlines list without articles, show headlines as links list in format "• Headline title [web-N]".\n' +
          '• If this is an INDIVIDUAL ARTICLE, show full article content, then relevant links separately.\n' +
          '• For ALL other websites show content + links separately.\n' +
          '• ALWAYS add clear instructions for the user in English at the end\n\n' +
          'Users can:\n' +
          '- Type "web-N" to get link content (e.g., "web-5")\n' +
          '- Describe the desired link ("open news about tourism")\n' +
          '- Use "web-N" command to open the link in browser'
    }
    
    // Format the enhanced input
    const contentText = `Website: ${mcpData.url}\nTitle: ${mcpData.title}\nContent: ${mcpData.content}`
    
    result.enhancedInput = `${originalInput}\n\nContent from webpage:\n${contentText}\n\n${languageInstruction}${contentLanguageInfo}${linkInstructions}`
    result.showMCPData = true
    result.metadata.url = mcpData.url
    result.metadata.title = mcpData.title
    result.metadata.linksCount = mcpData.links ? mcpData.links.length : 0
    
    return result
  }

  /**
   * Format search result
   */
  formatSearchResult(mcpData, intent, command, originalInput, result) {
    const searchResults = mcpData.results || []
    const searchSummary = searchResults.map(r => 
      `• ${r.title}\n  ${r.content}\n  ${r.url}`
    ).join('\n\n')
    
    result.enhancedInput = `${originalInput}\n\n[Web search results for "${mcpData.query}":]\n${searchSummary}`
    result.metadata.query = mcpData.query
    result.metadata.resultsCount = searchResults.length
    
    return result
  }

  /**
   * Initialize MCP servers
   */
  async initializeMCPServers() {
    try {
      // Load MCP server configuration if available
      if (this.mcpManager) {
        await this.mcpManager.initialize(this.serverConfigurations)
      }
      
      // Register built-in servers
      if (this.fetchServer) {
        this.serverInstances.set('fetch', this.fetchServer)
        this.log('debug', 'Registered built-in fetch server')
      }
      
      if (this.searchServer) {
        this.serverInstances.set('web-search', this.searchServer)
        this.log('debug', 'Registered built-in search server')
      }
      
      this.log('info', `Initialized ${this.serverInstances.size} MCP servers`)
      
    } catch (error) {
      this.log('error', `Failed to initialize MCP servers: ${error.message}`)
      // Continue without MCP - not critical for basic operation
    }
  }

  /**
   * Shutdown MCP servers
   */
  async shutdownMCPServers() {
    for (const [name, server] of this.serverInstances) {
      try {
        if (server && typeof server.dispose === 'function') {
          await server.dispose()
        }
        this.log('debug', `Shutdown MCP server: ${name}`)
      } catch (error) {
        this.log('warn', `Error shutting down MCP server ${name}: ${error.message}`)
      }
    }
    
    this.serverInstances.clear()
  }

  /**
   * Record operation for statistics


   */
  recordOperation(serverName, toolName) {
    const key = `${serverName}:${toolName}`
    const count = this.operationStats.get(key) || 0
    this.operationStats.set(key, count + 1)
    this.lastOperations.set(key, new Date())
  }

  /**
   * Update operation statistics




   */
  updateOperationStats(serverName, toolName, success, error = null) {
    const key = success ? `${serverName}:${toolName}` : `${serverName}:${toolName}:error`
    const count = this.operationStats.get(key) || 0
    this.operationStats.set(key, count + 1)
    this.lastOperations.set(key, new Date())
    
    if (error) {
      this.log('debug', `Recorded MCP operation error: ${serverName}:${toolName} - ${error}`)
    }
  }

  /**
   * Emit MCP-related event


   */
  emitMCPEvent(eventName, data = {}) {
    this.emitEvent(`mcp:${eventName}`, {
      ...data,
      timestamp: new Date()
    })
  }

  /**
   */
  getCustomMetrics() {
    const stats = this.getMCPStats()
    
    return {
      mcpServers: stats.servers,
      totalOperations: stats.totalOperations,
      errors: stats.errors,
      successRate: stats.totalOperations > 0 ? 
        ((stats.totalOperations - stats.errors) / stats.totalOperations) * 100 : 0,
      operationsByServer: stats.operationsByServer,
      hasIntentDetector: !!this.intentDetector,
      hasMCPManager: !!this.mcpManager
    }
  }
}