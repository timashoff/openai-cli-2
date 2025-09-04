import { BaseService } from './base-service.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { AppError } from '../utils/error-handler.js'
import { UI_SYMBOLS } from '../config/constants.js'
import { getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'

/**
 * Service responsible for handling streaming responses from AI providers
 * - Real-time stream processing
 * - Escape key cancellation
 * - Response chunking and formatting
 * - Stream state management
 */
export class StreamingService extends BaseService {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {StreamProcessor|null} */
    this.currentStreamProcessor = null
    /** @type {AbortController|null} */
    this.currentAbortController = null
    /** @type {boolean} */
    this.isStreaming = false
    /** @type {boolean} */
    this.shouldStop = false
    /** @type {number|null} */
    this.startTime = null
    /** @type {Map<string, StreamSession>} */
    this.activeSessions = new Map()
    
    this.setupKeyHandlers()
  }

  /**
   */
  getRequiredDependencies() {
    return ['eventBus', 'logger']
  }

  /**
   */
  async onInitialize() {
    this.setupEventListeners()
    this.log('info', 'StreamingService initialized')
  }

  /**
   */
  async onDispose() {
    await this.stopAllStreams()
    this.activeSessions.clear()
    this.log('info', 'StreamingService disposed')
  }

  /**
   * Start streaming response from provider







   */
  async startStream(options) {
    this.ensureReady()
    
    const {
      stream,
      providerKey,
      model,
      onChunk,
      signal
    } = this.validateStreamOptions(options)

    const sessionId = this.generateSessionId()
    const session = this.createStreamSession(sessionId, providerKey, model)
    
    this.log('debug', `Starting stream session ${sessionId}`, { providerKey, model })

    try {
      this.currentStreamProcessor = new StreamProcessor(providerKey)
      this.currentAbortController = new AbortController()
      this.isStreaming = true
      this.startTime = Date.now()
      this.shouldStop = false

      // Emit stream started event
      this.emitEvent('stream:started', {
        sessionId,
        providerKey,
        model,
        timestamp: new Date()
      })

      // Process stream with enhanced chunk handling
      const response = await this.processStreamWithErrorHandling(
        stream,
        signal || this.currentAbortController.signal,
        (chunk) => this.handleChunk(sessionId, chunk, onChunk),
        session
      )

      this.log('info', `Stream session ${sessionId} completed successfully`, {
        duration: Date.now() - this.startTime,
        chunks: response.length
      })

      return response

    } catch (error) {
      this.handleStreamError(sessionId, error)
      throw error
    } finally {
      this.cleanupStream(sessionId)
    }
  }

  /**
   * Stop current streaming operation

   */
  async stopCurrentStream(reason = 'user_request') {
    if (!this.isStreaming) return

    this.log('info', `Stopping current stream: ${reason}`)
    
    this.shouldStop = true
    
    // Abort current stream processor
    if (this.currentStreamProcessor) {
      this.currentStreamProcessor.forceTerminate()
    }

    // Abort current request
    if (this.currentAbortController) {
      this.currentAbortController.abort()
    }

    // Emit stop event
    this.emitEvent('stream:stopped', {
      reason,
      timestamp: new Date()
    })
  }

  /**
   * Stop all active streaming sessions
   */
  async stopAllStreams() {
    const sessions = Array.from(this.activeSessions.keys())
    
    for (const sessionId of sessions) {
      await this.stopStreamSession(sessionId, 'service_shutdown')
    }
  }

  /**
   * Get current streaming status

   */
  getStreamingStatus() {
    return {
      isStreaming: this.isStreaming,
      activeSessions: this.activeSessions.size,
      currentSession: this.getCurrentSession(),
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      shouldStop: this.shouldStop
    }
  }

  /**
   * Process stream with comprehensive error handling





   */
  async processStreamWithErrorHandling(stream, signal, onChunk, session) {
    const response = []
    
    try {
      // Use Promise.race for immediate cancellation
      const result = await Promise.race([
        this.currentStreamProcessor.processStream(stream, signal, onChunk),
        this.createAbortPromise(signal)
      ])
      
      response.push(...result)
      
      // Update session with successful completion
      session.status = 'completed'
      session.endTime = Date.now()
      session.responseLength = response.join('').length
      
      this.emitEvent('stream:completed', {
        sessionId: session.id,
        duration: session.endTime - session.startTime,
        responseLength: session.responseLength
      })
      
      return response
      
    } catch (error) {
      session.status = 'error'
      session.error = error.message
      session.endTime = Date.now()
      
      if (this.isAbortError(error)) {
        session.status = 'aborted'
        this.log('info', `Stream session ${session.id} aborted`)
        return response // Return partial response
      }
      
      throw error
    }
  }

  /**
   * Handle individual stream chunk



   */
  async handleChunk(sessionId, chunk, onChunk) {
    const session = this.activeSessions.get(sessionId)
    if (!session) return

    // Update session stats
    session.chunks++
    session.totalBytes += chunk.length

    // Check if we should stop
    if (this.shouldStop) {
      throw new Error('Stream stopped by user')
    }

    // Call external chunk handler
    try {
      if (onChunk && typeof onChunk === 'function') {
        await onChunk(chunk)
      }
    } catch (error) {
      this.log('error', `Error in chunk handler: ${error.message}`)
    }

    // Emit chunk event for monitoring
    this.emitEvent('stream:chunk', {
      sessionId,
      chunk,
      chunkNumber: session.chunks,
      totalBytes: session.totalBytes
    })
  }

  /**
   * Handle stream errors


   */
  handleStreamError(sessionId, error) {
    const session = this.activeSessions.get(sessionId)
    
    this.log('error', `Stream session ${sessionId} error: ${error.message}`, {
      session: session ? {
        providerKey: session.providerKey,
        model: session.model,
        duration: Date.now() - session.startTime
      } : null
    })

    this.emitEvent('stream:error', {
      sessionId,
      error: error.message,
      timestamp: new Date()
    })
  }

  /**
   * Create abort promise for immediate cancellation


   */
  createAbortPromise(signal) {
    return new Promise((_, reject) => {
      const checkAbort = () => {
        if (signal.aborted || this.shouldStop) {
          reject(new Error('AbortError'))
        } else {
          setTimeout(checkAbort, 5) // Check every 5ms for responsive cancellation
        }
      }
      checkAbort()
    })
  }

  /**
   * Create new stream session




   */
  createStreamSession(sessionId, providerKey, model) {
    const session = {
      id: sessionId,
      providerKey,
      model,
      startTime: Date.now(),
      endTime: null,
      status: 'streaming',
      chunks: 0,
      totalBytes: 0,
      responseLength: 0,
      error: null
    }
    
    this.activeSessions.set(sessionId, session)
    return session
  }

  /**
   * Cleanup stream resources

   */
  cleanupStream(sessionId) {
    this.activeSessions.delete(sessionId)
    
    if (this.activeSessions.size === 0) {
      this.isStreaming = false
      this.currentStreamProcessor = null
      this.currentAbortController = null
      this.startTime = null
      this.shouldStop = false
    }
  }

  /**
   * Stop specific stream session


   */
  async stopStreamSession(sessionId, reason) {
    const session = this.activeSessions.get(sessionId)
    if (!session || session.status !== 'streaming') return

    session.status = 'stopped'
    session.endTime = Date.now()
    
    this.emitEvent('stream:session:stopped', {
      sessionId,
      reason,
      duration: session.endTime - session.startTime
    })
    
    this.cleanupStream(sessionId)
  }

  /**
   * Setup keyboard event handlers
   */
  setupKeyHandlers() {
    // This will be handled by the main application
    // We just provide the stop method
  }

  /**
   * Setup event listeners for service communication
   */
  setupEventListeners() {
    // ESC handling removed - ApplicationLoop is Single Source of Truth for ESC
    // StreamingService will be stopped via AbortController, not direct event listening

    this.eventBus?.on('application:shutdown', () => {
      this.stopAllStreams()
    })
  }

  /**
   * Generate unique session ID

   */
  generateSessionId() {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get current active session

   */
  getCurrentSession() {
    for (const session of this.activeSessions.values()) {
      if (session.status === 'streaming') {
        return session
      }
    }
    return null
  }

  /**
   * Validate stream options


   */
  validateStreamOptions(options) {
    if (!options) {
      throw new AppError('Stream options are required', true, 400)
    }

    const { stream, providerKey, model } = options
    
    if (!stream) {
      throw new AppError('Stream is required', true, 400)
    }

    if (!providerKey || typeof providerKey !== 'string') {
      throw new AppError('Provider key must be a non-empty string', true, 400)
    }

    if (!model || typeof model !== 'string') {
      throw new AppError('Model must be a non-empty string', true, 400)
    }

    return options
  }

  /**
   * Check if error is an abort error


   */
  isAbortError(error) {
    return error.name === 'AbortError' || 
           error.message === 'AbortError' ||
           error.message.includes('aborted') ||
           error.message.includes('cancelled')
  }

  /**
   */
  getCustomMetrics() {
    return {
      activeSessions: this.activeSessions.size,
      isStreaming: this.isStreaming,
      currentUptime: this.startTime ? Date.now() - this.startTime : 0,
      sessionsToday: this.getSessionStats()
    }
  }

  /**
   * Get session statistics

   */
  getSessionStats() {
    const sessions = Array.from(this.activeSessions.values())
    
    return {
      total: sessions.length,
      completed: sessions.filter(s => s.status === 'completed').length,
      error: sessions.filter(s => s.status === 'error').length,
      aborted: sessions.filter(s => s.status === 'aborted').length,
      streaming: sessions.filter(s => s.status === 'streaming').length
    }
  }
}