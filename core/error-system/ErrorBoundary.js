/**
 * Error Boundary - Functional circuit breaker pattern with fault detection
 * Prevents cascading failures and provides automatic recovery mechanisms
 */
import { createBaseError, isBaseError } from './ErrorTypes.js'
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
 * Create circuit breaker state object
 */
const createCircuitBreakerState = (name, config = CircuitConfig.DEFAULT) => ({
  name,
  config,
  state: CircuitState.CLOSED,
  failureCount: 0,
  successCount: 0,
  lastFailureTime: null,
  nextAttemptTime: null,
  requestCount: 0,
  errorHistory: []
})

/**
 * Check if circuit should attempt reset
 */
const shouldAttemptReset = (circuitState) => {
  return circuitState.nextAttemptTime && Date.now() >= circuitState.nextAttemptTime
}

/**
 * Handle successful operation
 */
const onSuccess = (circuitState, startTime) => {
  const duration = Date.now() - startTime
  
  if (circuitState.state === CircuitState.HALF_OPEN) {
    circuitState.successCount++
    
    if (circuitState.successCount >= circuitState.config.successThreshold) {
      // Close circuit - service has recovered
      reset(circuitState)
      logger.info(`Circuit breaker '${circuitState.name}' closed - service recovered`)
    }
  } else if (circuitState.state === CircuitState.CLOSED) {
    // Reset failure count on success
    circuitState.failureCount = Math.max(0, circuitState.failureCount - 1)
  }
  
  circuitState.requestCount++
  logger.debug(`Circuit breaker '${circuitState.name}' - Operation succeeded in ${duration}ms`)
}

/**
 * Handle failed operation
 */
const onFailure = (circuitState, error, startTime) => {
  const duration = Date.now() - startTime
  
  circuitState.failureCount++
  circuitState.lastFailureTime = Date.now()
  circuitState.requestCount++
  
  // Add to error history
  circuitState.errorHistory.push({
    error: error.message,
    timestamp: new Date(),
    duration
  })
  
  // Keep only recent errors
  if (circuitState.errorHistory.length > 20) {
    circuitState.errorHistory = circuitState.errorHistory.slice(-10)
  }
  
  // Check if we should open the circuit
  if (circuitState.state === CircuitState.CLOSED && circuitState.failureCount >= circuitState.config.failureThreshold) {
    open(circuitState)
  } else if (circuitState.state === CircuitState.HALF_OPEN) {
    // Failed during testing - open circuit again
    open(circuitState)
  }
  
  logger.debug(`Circuit breaker '${circuitState.name}' - Operation failed in ${duration}ms (failures: ${circuitState.failureCount})`)
}

/**
 * Open the circuit
 */
const open = (circuitState) => {
  circuitState.state = CircuitState.OPEN
  circuitState.nextAttemptTime = Date.now() + circuitState.config.recoveryTimeout
  
  logger.warn(`Circuit breaker '${circuitState.name}' opened after ${circuitState.failureCount} failures. Next attempt in ${circuitState.config.recoveryTimeout}ms`)
}

/**
 * Reset circuit to closed state
 */
const reset = (circuitState) => {
  circuitState.state = CircuitState.CLOSED
  circuitState.failureCount = 0
  circuitState.successCount = 0
  circuitState.lastFailureTime = null
  circuitState.nextAttemptTime = null
}

/**
 * Get circuit breaker status
 */
const getStatus = (circuitState) => {
  return {
    name: circuitState.name,
    state: circuitState.state,
    failureCount: circuitState.failureCount,
    successCount: circuitState.successCount,
    requestCount: circuitState.requestCount,
    lastFailureTime: circuitState.lastFailureTime,
    nextAttemptTime: circuitState.nextAttemptTime,
    recentErrors: circuitState.errorHistory.slice(-5),
    config: circuitState.config
  }
}

/**
 * Execute operation with circuit breaker protection
 */
const executeWithCircuit = async (operation, context, circuitState) => {
  // Check if circuit is open
  if (circuitState.state === CircuitState.OPEN) {
    if (!shouldAttemptReset(circuitState)) {
      throw createBaseError(`Circuit breaker '${circuitState.name}' is open. Service unavailable.`, true, 503)
    }
    
    // Move to half-open for testing
    circuitState.state = CircuitState.HALF_OPEN
    circuitState.successCount = 0
    logger.info(`Circuit breaker '${circuitState.name}' moved to HALF_OPEN for testing`)
  }

  const startTime = Date.now()
  
  try {
    const result = await operation()
    
    // Record success
    onSuccess(circuitState, startTime)
    return result
    
  } catch (error) {
    // Record failure
    onFailure(circuitState, error, startTime)
    throw error
  }
}

/**
 * Generate circuit name from context
 */
const generateCircuitName = (context) => {
  const operation = context.operation || 'unknown'
  const component = context.component || 'unknown'
  return `${component}:${operation}`
}

/**
 * Get circuit configuration based on context
 */
const getCircuitConfig = (context) => {
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
 * Get or create circuit breaker for context
 */
const getOrCreateCircuit = (name, context, circuits) => {
  if (!circuits.has(name)) {
    const config = getCircuitConfig(context)
    circuits.set(name, createCircuitBreakerState(name, config))
  }
  
  return circuits.get(name)
}

/**
 * Check if batch execution should stop
 */
const shouldStopBatch = (error, errors, totalOperations) => {
  // Stop if more than 50% of operations have failed
  const failureRate = errors.length / totalOperations
  
  // Stop if we have critical errors
  if (isBaseError(error) && !error.isOperational) {
    return true
  }
  
  // Stop if failure rate is too high
  return failureRate > 0.5
}

/**
 * Execute operation with error boundary protection
 */
const execute = async (operation, context = {}, strategy = RecoveryStrategy.RETRY, state) => {
  const circuitName = generateCircuitName(context)
  const circuit = getOrCreateCircuit(circuitName, context, state.circuits)
  
  try {
    // Execute with circuit breaker protection
    return await executeWithCircuit(async () => {
      // Use error recovery for the actual operation
      return await errorRecovery.executeWithRecovery(operation, context, strategy)
    }, context, circuit)
    
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
const executeBatch = async (operations, context = {}, strategy = RecoveryStrategy.RETRY, state) => {
  const results = []
  const errors = []
  
  for (const [index, operation] of operations.entries()) {
    const operationContext = {
      ...context,
      operation: `${context.operation || 'batch'}_${index}`,
      batchIndex: index
    }
    
    try {
      const result = await execute(operation, operationContext, strategy, state)
      results.push(result)
    } catch (error) {
      errors.push({ index, error, context: operationContext })
      
      // Decide whether to continue with batch
      if (shouldStopBatch(error, errors, operations.length)) {
        break
      }
    }
  }
  
  return { results, errors }
}

/**
 * Reset specific circuit
 */
const resetCircuit = (name, circuits) => {
  const circuit = circuits.get(name)
  if (circuit) {
    reset(circuit)
    logger.info(`Circuit breaker '${name}' manually reset`)
  }
}

/**
 * Reset all circuits
 */
const resetAllCircuits = (circuits) => {
  for (const circuit of circuits.values()) {
    reset(circuit)
  }
  logger.info('All circuit breakers reset')
}

/**
 * Get status of all circuits
 */
const getCircuitStatus = (circuits) => {
  const status = {}
  for (const [name, circuit] of circuits) {
    status[name] = getStatus(circuit)
  }
  return status
}

/**
 * Get circuits by state
 */
const getCircuitsByState = (state, circuits) => {
  const circuitsByState = {}
  for (const [name, circuit] of circuits) {
    if (circuit.state === state) {
      circuitsByState[name] = getStatus(circuit)
    }
  }
  return circuitsByState
}

/**
 * Health check for error boundary system
 */
const getHealthCheck = (circuits) => {
  const circuitStatuses = getCircuitStatus(circuits)
  const openCircuits = Object.values(circuitStatuses).filter(c => c.state === CircuitState.OPEN)
  const halfOpenCircuits = Object.values(circuitStatuses).filter(c => c.state === CircuitState.HALF_OPEN)
  
  return {
    healthy: openCircuits.length === 0,
    totalCircuits: Object.keys(circuitStatuses).length,
    openCircuits: openCircuits.length,
    halfOpenCircuits: halfOpenCircuits.length,
    circuits: circuitStatuses,
    timestamp: new Date().toISOString()
  }
}

/**
 * Create error boundary factory function
 */
export const createErrorBoundary = () => {
  const state = {
    circuits: new Map()
  }
  
  return {
    execute: (operation, context, strategy) => execute(operation, context, strategy, state),
    executeBatch: (operations, context, strategy) => executeBatch(operations, context, strategy, state),
    resetCircuit: (name) => resetCircuit(name, state.circuits),
    resetAllCircuits: () => resetAllCircuits(state.circuits),
    getCircuitStatus: () => getCircuitStatus(state.circuits),
    getCircuitsByState: (circuitState) => getCircuitsByState(circuitState, state.circuits),
    getHealthCheck: () => getHealthCheck(state.circuits),
    
    // Utility functions
    generateCircuitName,
    getCircuitConfig,
    shouldStopBatch
  }
}

/**
 * Create circuit breaker factory function
 */
export const createCircuitBreaker = (name, config = CircuitConfig.DEFAULT) => {
  const circuitState = createCircuitBreakerState(name, config)
  
  return {
    execute: (operation, context) => executeWithCircuit(operation, context, circuitState),
    getStatus: () => getStatus(circuitState),
    reset: () => reset(circuitState),
    
    // Circuit state accessors
    getName: () => circuitState.name,
    getState: () => circuitState.state,
    getFailureCount: () => circuitState.failureCount,
    getSuccessCount: () => circuitState.successCount
  }
}

// Global instance for backward compatibility
export const errorBoundary = createErrorBoundary()

// Export individual functions for functional usage
export {
  execute,
  executeBatch,
  executeWithCircuit,
  createCircuitBreakerState,
  generateCircuitName,
  getCircuitConfig,
  getOrCreateCircuit,
  shouldStopBatch,
  resetCircuit,
  resetAllCircuits,
  getCircuitStatus,
  getCircuitsByState,
  getHealthCheck,
  onSuccess,
  onFailure,
  open,
  reset,
  getStatus,
  shouldAttemptReset
}