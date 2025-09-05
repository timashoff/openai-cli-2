/**
 * Error Boundary - Circuit Breaker pattern with automatic fault detection
 * Prevents cascading failures and provides automatic recovery mechanisms
 */
import * as ErrorTypes from './ErrorTypes.js'

const { BaseError } = ErrorTypes
import { errorRecovery, RecoveryStrategy } from './ErrorRecovery.js'
import { logger } from '../../utils/logger.js'

/**
 * Circuit breaker states
 */
export const CircuitState = {
  CLOSED: 'closed',     // Normal operation
  OPEN: 'open',         // Circuit is open, failing fast
  HALF_OPEN: 'half_open' // Testing if service has recovered
}

/**
 * Circuit breaker configuration
 */
export const CircuitConfig = {
  DEFAULT: {
    failureThreshold: 5,        // Open after 5 consecutive failures
    recoveryTimeout: 60000,     // Wait 60s before trying again
    successThreshold: 3,        // Close after 3 consecutive successes in half-open
    monitoringPeriod: 300000    // 5 minutes monitoring window
  },
  CRITICAL: {
    failureThreshold: 2,
    recoveryTimeout: 30000,
    successThreshold: 2,
    monitoringPeriod: 120000
  },
  NETWORK: {
    failureThreshold: 3,
    recoveryTimeout: 45000,
    successThreshold: 2,
    monitoringPeriod: 180000
  }
}

/**
 * Circuit breaker implementation for error boundary protection
 */
class CircuitBreaker {
  constructor(name, config = CircuitConfig.DEFAULT) {
    this.name = name
    this.config = config
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.nextAttemptTime = null
    this.requestCount = 0
    this.errorHistory = []
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute(operation, context = {}) {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (!this.shouldAttemptReset()) {
        throw new BaseError(`Circuit breaker '${this.name}' is open. Service unavailable.`, true, 503)
      }
      
      // Move to half-open for testing
      this.state = CircuitState.HALF_OPEN
      this.successCount = 0
      logger.info(`Circuit breaker '${this.name}' moved to HALF_OPEN for testing`)
    }

    const startTime = Date.now()
    
    try {
      const result = await operation()
      
      // Record success
      this.onSuccess(startTime)
      return result
      
    } catch (error) {
      // Record failure
      this.onFailure(error, startTime)
      throw error
    }
  }

  /**
   * Handle successful operation
   */
  onSuccess(startTime) {
    const duration = Date.now() - startTime
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++
      
      if (this.successCount >= this.config.successThreshold) {
        // Close circuit - service has recovered
        this.reset()
        logger.info(`Circuit breaker '${this.name}' closed - service recovered`)
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = Math.max(0, this.failureCount - 1)
    }
    
    this.requestCount++
    logger.debug(`Circuit breaker '${this.name}' - Operation succeeded in ${duration}ms`)
  }

  /**
   * Handle failed operation
   */
  onFailure(error, startTime) {
    const duration = Date.now() - startTime
    
    this.failureCount++
    this.lastFailureTime = Date.now()
    this.requestCount++
    
    // Add to error history
    this.errorHistory.push({
      error: error.message,
      timestamp: new Date(),
      duration
    })
    
    // Keep only recent errors
    if (this.errorHistory.length > 20) {
      this.errorHistory = this.errorHistory.slice(-10)
    }
    
    // Check if we should open the circuit
    if (this.state === CircuitState.CLOSED && this.failureCount >= this.config.failureThreshold) {
      this.open()
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Failed during testing - open circuit again
      this.open()
    }
    
    logger.debug(`Circuit breaker '${this.name}' - Operation failed in ${duration}ms (failures: ${this.failureCount})`)
  }

  /**
   * Open the circuit
   */
  open() {
    this.state = CircuitState.OPEN
    this.nextAttemptTime = Date.now() + this.config.recoveryTimeout
    
    logger.warn(`Circuit breaker '${this.name}' opened after ${this.failureCount} failures. Next attempt in ${this.config.recoveryTimeout}ms`)
  }

  /**
   * Reset circuit to closed state
   */
  reset() {
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.nextAttemptTime = null
  }

  /**
   * Check if we should attempt to reset the circuit
   */
  shouldAttemptReset() {
    return this.nextAttemptTime && Date.now() >= this.nextAttemptTime
  }

  /**
   * Get circuit breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: this.requestCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      recentErrors: this.errorHistory.slice(-5),
      config: this.config
    }
  }
}

/**
 * Error boundary with circuit breaker protection and recovery strategies
 */
export class ErrorBoundary {
  constructor() {
    this.circuits = new Map()
    this.globalConfig = CircuitConfig.DEFAULT
  }

  /**
   * Execute operation with error boundary protection
   */
  async execute(operation, context = {}, strategy = RecoveryStrategy.RETRY) {
    const circuitName = this.generateCircuitName(context)
    const circuit = this.getOrCreateCircuit(circuitName, context)
    
    try {
      // Execute with circuit breaker protection
      return await circuit.execute(async () => {
        // Use error recovery for the actual operation
        return await errorRecovery.executeWithRecovery(operation, context, strategy)
      }, context)
      
    } catch (error) {
      // Circuit breaker failed or recovery failed
      logger.error(`Error boundary failed for ${circuitName}`, {
        error: error.message,
        context,
        circuitState: circuit.state
      })
      
      // Try last resort recovery
      if (strategy !== RecoveryStrategy.FAIL_GRACEFUL) {
        return await errorRecovery.executeWithRecovery(
          operation, 
          context, 
          RecoveryStrategy.FAIL_GRACEFUL
        )
      }
      
      throw error
    }
  }

  /**
   * Execute multiple operations with coordinated error handling
   */
  async executeBatch(operations, context = {}, strategy = RecoveryStrategy.RETRY) {
    const results = []
    const errors = []
    
    for (const [index, operation] of operations.entries()) {
      const operationContext = {
        ...context,
        operation: `${context.operation || 'batch'}_${index}`,
        batchIndex: index
      }
      
      try {
        const result = await this.execute(operation, operationContext, strategy)
        results.push(result)
      } catch (error) {
        errors.push({ index, error, context: operationContext })
        
        // Decide whether to continue with batch
        if (this.shouldStopBatch(error, errors, operations.length)) {
          break
        }
      }
    }
    
    return { results, errors }
  }

  /**
   * Get or create circuit breaker for context
   */
  getOrCreateCircuit(name, context) {
    if (!this.circuits.has(name)) {
      const config = this.getCircuitConfig(context)
      this.circuits.set(name, new CircuitBreaker(name, config))
    }
    
    return this.circuits.get(name)
  }

  /**
   * Get circuit configuration based on context
   */
  getCircuitConfig(context) {
    const operation = context.operation || ''
    
    if (operation.includes('critical') || context.critical) {
      return CircuitConfig.CRITICAL
    }
    
    if (operation.includes('network') || operation.includes('api') || operation.includes('provider')) {
      return CircuitConfig.NETWORK
    }
    
    return CircuitConfig.DEFAULT
  }

  /**
   * Generate circuit name from context
   */
  generateCircuitName(context) {
    const operation = context.operation || 'unknown'
    const component = context.component || 'unknown'
    return `${component}:${operation}`
  }

  /**
   * Check if batch execution should stop
   */
  shouldStopBatch(error, errors, totalOperations) {
    // Stop if more than 50% of operations have failed
    const failureRate = errors.length / totalOperations
    
    // Stop if we have critical errors
    if (error instanceof BaseError && !error.isOperational) {
      return true
    }
    
    // Stop if failure rate is too high
    return failureRate > 0.5
  }

  /**
   * Reset specific circuit
   */
  resetCircuit(name) {
    const circuit = this.circuits.get(name)
    if (circuit) {
      circuit.reset()
      logger.info(`Circuit breaker '${name}' manually reset`)
    }
  }

  /**
   * Reset all circuits
   */
  resetAllCircuits() {
    for (const circuit of this.circuits.values()) {
      circuit.reset()
    }
    logger.info('All circuit breakers reset')
  }

  /**
   * Get status of all circuits
   */
  getCircuitStatus() {
    const status = {}
    for (const [name, circuit] of this.circuits) {
      status[name] = circuit.getStatus()
    }
    return status
  }

  /**
   * Get circuits by state
   */
  getCircuitsByState(state) {
    const circuits = {}
    for (const [name, circuit] of this.circuits) {
      if (circuit.state === state) {
        circuits[name] = circuit.getStatus()
      }
    }
    return circuits
  }

  /**
   * Health check for error boundary system
   */
  getHealthCheck() {
    const circuits = this.getCircuitStatus()
    const openCircuits = Object.values(circuits).filter(c => c.state === CircuitState.OPEN)
    const halfOpenCircuits = Object.values(circuits).filter(c => c.state === CircuitState.HALF_OPEN)
    
    return {
      healthy: openCircuits.length === 0,
      totalCircuits: Object.keys(circuits).length,
      openCircuits: openCircuits.length,
      halfOpenCircuits: halfOpenCircuits.length,
      circuits: circuits,
      timestamp: new Date().toISOString()
    }
  }
}

// Global instance
export const errorBoundary = new ErrorBoundary()

