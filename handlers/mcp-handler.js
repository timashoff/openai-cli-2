import { BaseRequestHandler } from './base-handler.js'
import { AppError } from '../utils/error-handler.js'
import { color } from '../config/color.js'

/**
 * Handler for Model Context Protocol (MCP) operations
 * Processes inputs that require web content extraction or search
 */
export class MCPHandler extends BaseRequestHandler {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Object} */
    this.mcpService = dependencies.mcpService
    /** @type {Map<string, number>} */
    this.mcpStats = new Map()
    /** @type {Date} */
    this.lastMCPOperation = null
  }

  /**
   */
  async canHandle(context) {
    if (!this.mcpService) {
      return false
    }
    
    // Check if MCP service can process this input
    try {
      // Use intent detector through MCP service to check if processing is needed
      const mcpResult = await this.mcpService.processMCPInput(context.processedInput, context.command)
      
      // Store result for process() method to avoid duplicate work
      context.processingData = context.processingData || new Map()
      context.processingData.set('mcpResult', mcpResult)
      
      return mcpResult !== null
      
    } catch (error) {
      this.log('debug', `MCP availability check failed: ${error.message}`)
      return false
    }
  }

  /**
   */
  async process(context) {
    try {
      // Get pre-computed result from canHandle if available
      let mcpResult = context.processingData?.get('mcpResult')
      
      // If not available, process now
      if (!mcpResult) {
        mcpResult = await this.mcpService.processMCPInput(context.processedInput, context.command)
      }
      
      if (!mcpResult) {
        this.log('warn', 'MCP service returned no result')
        return this.createPassThrough(context.processedInput, {
          mcpProcessed: false,
          reason: 'no_mcp_result'
        })
      }
      
      this.log('info', `MCP operation completed: ${mcpResult.type}`)
      
      // Update statistics
      this.updateMCPStats(mcpResult.type, true)
      this.lastMCPOperation = new Date()
      
      // Handle different MCP result types
      return this.handleMCPResult(mcpResult, context)
      
    } catch (error) {
      this.log('error', `MCP processing failed: ${error.message}`)
      
      // Update error statistics
      this.updateMCPStats('error', false, error.message)
      
      // Emit error event
      this.emitEvent('mcp:error', {
        error: error.message,
        input: context.processedInput.substring(0, 100)
      })
      
      // Show user-friendly error
      console.log(`${color.red}MCP error: ${this.getUserFriendlyError(error)}${color.reset}`)
      
      // Continue chain on MCP errors - input might be processable by AI directly
      return this.createPassThrough(context.processedInput, {
        mcpProcessed: false,
        mcpError: error.message
      })
    }
  }

  /**
   * Handle different types of MCP results



   */
  handleMCPResult(mcpResult, context) {
    // Add MCP data to context for other handlers
    context.mcpData = mcpResult.data
    context.metadata.mcpProcessed = true
    context.metadata.mcpType = mcpResult.type
    
    // Handle direct response (no AI processing needed)
    if (mcpResult.directResponse) {
      console.log(`\n${color.cyan}[MCP Response]${color.reset}`)
      console.log(mcpResult.directResponse)
      
      this.emitEvent('mcp:direct-response', {
        type: mcpResult.type,
        responseLength: mcpResult.directResponse.length
      })
      
      return this.createResult(mcpResult.directResponse, { stopChain: true })
    }
    
    // Show MCP data summary to user if requested
    if (mcpResult.showMCPData && mcpResult.data) {
      this.showMCPDataSummary(mcpResult)
    }
    
    // Continue chain with enhanced input for AI processing
    if (mcpResult.enhancedInput) {
      this.log('info', 'Passing enhanced input to next handler')
      
      this.emitEvent('mcp:enhanced-input', {
        type: mcpResult.type,
        originalLength: context.processedInput.length,
        enhancedLength: mcpResult.enhancedInput.length
      })
      
      return this.createPassThrough(mcpResult.enhancedInput, {
        mcpProcessed: true,
        mcpType: mcpResult.type,
        mcpEnhanced: true,
        originalLength: context.processedInput.length,
        enhancedLength: mcpResult.enhancedInput.length
      })
    }
    
    // Fallback - continue with original input
    return this.createPassThrough(context.processedInput, {
      mcpProcessed: true,
      mcpType: mcpResult.type,
      mcpEnhanced: false
    })
  }

  /**
   * Show MCP data summary to user

   */
  showMCPDataSummary(mcpResult) {
    console.log(`\n${color.cyan}[MCP Data]${color.reset}`)
    
    const data = mcpResult.data
    
    switch (mcpResult.type) {
      case 'webpage_extract':
      case 'follow_link':
        if (data.url) {
          console.log(`${color.grey}Source: ${data.url}${color.reset}`)
        }
        if (data.title) {
          console.log(`${color.grey}Title: ${data.title}${color.reset}`)
        }
        if (data.content) {
          console.log(`${color.grey}Content: ${data.content.length} characters${color.reset}`)
        }
        if (data.links && data.links.length > 0) {
          console.log(`${color.grey}Links: ${data.links.length} found${color.reset}`)
        }
        break
        
      case 'web_search':
        if (data.query) {
          console.log(`${color.grey}Query: ${data.query}${color.reset}`)
        }
        if (data.results) {
          console.log(`${color.grey}Results: ${data.results.length} found${color.reset}`)
        }
        break
        
      default:
        console.log(`${color.grey}Type: ${mcpResult.type}${color.reset}`)
        if (data && typeof data === 'object') {
          const keys = Object.keys(data)
          console.log(`${color.grey}Data: ${keys.length} fields${color.reset}`)
        }
    }
  }

  /**
   * Update MCP operation statistics



   */
  updateMCPStats(operationType, success, error = null) {
    const key = success ? operationType : `${operationType}:error`
    const current = this.mcpStats.get(key) || {
      count: 0,
      lastOperation: null,
      errors: []
    }
    
    current.count++
    current.lastOperation = new Date()
    
    if (!success && error && current.errors.length < 3) {
      current.errors.push({
        error,
        timestamp: new Date()
      })
    }
    
    this.mcpStats.set(key, current)
  }

  /**
   * Convert technical errors to user-friendly messages


   */
  getUserFriendlyError(error) {
    if (error.message.includes('timeout')) {
      return 'Web operation timed out. Please try again.'
    }
    
    if (error.message.includes('not found') || error.message.includes('404')) {
      return 'Webpage not found or not accessible.'
    }
    
    if (error.message.includes('network') || error.message.includes('fetch failed')) {
      return 'Network error. Please check your connection.'
    }
    
    if (error.message.includes('blocked') || error.message.includes('403')) {
      return 'Access to webpage is restricted or blocked.'
    }
    
    if (error.message.includes('invalid URL')) {
      return 'Invalid or malformed web address.'
    }
    
    // Default fallback
    return 'Unable to process web content. Continuing with text input.'
  }

  /**
   * Get MCP operation statistics

   */
  getMCPStats() {
    const stats = {
      totalOperations: 0,
      totalSuccesses: 0,
      totalErrors: 0,
      lastOperation: this.lastMCPOperation,
      operationBreakdown: {},
      errorBreakdown: {}
    }
    
    for (const [key, data] of this.mcpStats) {
      if (key.includes(':error')) {
        stats.totalErrors += data.count
        stats.errorBreakdown[key.replace(':error', '')] = data.count
      } else {
        stats.totalSuccesses += data.count
      }
      
      stats.totalOperations += data.count
      stats.operationBreakdown[key] = { ...data }
    }
    
    stats.successRate = stats.totalOperations > 0 ? 
      (stats.totalSuccesses / stats.totalOperations) * 100 : 0
    
    return stats
  }

  /**
   * Get MCP service status

   */
  getMCPServiceStatus() {
    if (!this.mcpService) {
      return {
        available: false,
        reason: 'MCP service not available'
      }
    }
    
    try {
      const status = this.mcpService.getMCPServerStatus()
      const stats = this.mcpService.getMCPStats()
      
      return {
        available: true,
        servers: stats.servers,
        totalOperations: stats.totalOperations,
        errors: stats.errors,
        serverStatus: status
      }
    } catch (error) {
      return {
        available: false,
        reason: error.message
      }
    }
  }

  /**
   */
  getStats() {
    const baseStats = super.getStats()
    const mcpStats = this.getMCPStats()
    const serviceStatus = this.getMCPServiceStatus()
    
    return {
      ...baseStats,
      mcpOperations: mcpStats,
      mcpService: serviceStatus
    }
  }

  /**
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus()
    const mcpStats = this.getMCPStats()
    const serviceStatus = this.getMCPServiceStatus()
    
    return {
      ...baseHealth,
      mcpHealth: {
        hasMCPService: !!this.mcpService,
        isServiceAvailable: serviceStatus.available,
        totalOperations: mcpStats.totalOperations,
        successRate: mcpStats.successRate,
        recentErrors: mcpStats.totalErrors,
        lastOperation: this.lastMCPOperation,
        isHealthy: serviceStatus.available && mcpStats.successRate > 70
      }
    }
  }

  /**
   * Test MCP service connectivity

   */
  async testMCPConnectivity() {
    if (!this.mcpService) {
      return {
        success: false,
        reason: 'MCP service not available'
      }
    }
    
    try {
      // Try a simple test operation
      const testResult = await this.mcpService.getMCPServerStatus()
      
      return {
        success: true,
        servers: Object.keys(testResult).length,
        details: testResult
      }
    } catch (error) {
      return {
        success: false,
        reason: error.message
      }
    }
  }

  /**
   */
  dispose() {
    super.dispose()
    this.mcpStats.clear()
    this.lastMCPOperation = null
  }
}