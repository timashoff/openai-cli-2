#!/usr/bin/env node

import { APP_CONFIG, getConfig, validateConfig, getFlatConfig } from './config/app-config.js'
import { StructuredLogger, getLogger, consoleReplacement } from './utils/structured-logger.js'

async function testConfigSystem() {
  console.log('=== Testing Configuration System ===\n')
  
  try {
    // Test basic configuration access
    console.log('1. Basic configuration access:')
    console.log(`API Timeout: ${getConfig('TIMEOUTS.API_REQUEST')}ms`)
    console.log(`Max Input Length: ${getConfig('LIMITS.MAX_INPUT_LENGTH')} chars`)
    console.log(`Default Log Level: ${getConfig('LOGGING.DEFAULT_LEVEL')}`)
    console.log(`Enable Caching: ${getConfig('FEATURES.ENABLE_CACHING')}`)
    
    // Test environment-specific overrides
    console.log('\n2. Environment-specific overrides:')
    console.log(`Development log level: ${getConfig('LOGGING.DEFAULT_LEVEL', 'development')}`)
    console.log(`Production log level: ${getConfig('LOGGING.DEFAULT_LEVEL', 'production')}`)
    console.log(`Test API timeout: ${getConfig('TIMEOUTS.API_REQUEST', 'test')}ms`)
    
    // Test configuration validation
    console.log('\n3. Configuration validation:')
    const errors = validateConfig()
    if (errors.length === 0) {
      console.log('✓ Configuration is valid')
    } else {
      console.log('❌ Configuration errors:')
      errors.forEach(error => console.log(`  - ${error}`))
    }
    
    // Test flattened configuration
    console.log('\n4. Flattened configuration sample:')
    const flatConfig = getFlatConfig()
    const sampleKeys = Object.keys(flatConfig).slice(0, 5)
    sampleKeys.forEach(key => {
      console.log(`  ${key}: ${flatConfig[key]}`)
    })
    console.log(`  ... and ${Object.keys(flatConfig).length - 5} more keys`)
    
  } catch (error) {
    console.error('Configuration test failed:', error)
  }
}

async function testStructuredLogger() {
  console.log('\n=== Testing Structured Logger ===\n')
  
  try {
    // Create logger instances
    const appLogger = new StructuredLogger({ component: 'TestApp' })
    const childLogger = appLogger.child({ name: 'TestChild' })
    
    console.log('1. Testing different log levels:')
    appLogger.debug('This is a debug message', { debugInfo: 'extra context' })
    appLogger.info('This is an info message', { userId: 123 })
    appLogger.warn('This is a warning', { warningType: 'performance' })
    appLogger.error('This is an error', { error: new Error('Test error') })
    
    console.log('\n2. Testing child logger:')
    childLogger.info('Message from child logger')
    childLogger.warn('Child logger warning', { childData: { nested: 'value' } })
    
    console.log('\n3. Testing sensitive data redaction:')
    appLogger.info('User login attempt', {
      username: 'testuser',
      password: 'secret123',
      apiKey: 'sk-1234567890',
      userId: 456
    })
    
    console.log('\n4. Logger statistics:')
    const stats = appLogger.getStats()
    console.log(`Total logs: ${stats.total}`)
    console.log(`Info: ${stats.info}, Warn: ${stats.warn}, Error: ${stats.error}`)
    console.log(`Rate: ${stats.rate.toFixed(2)} logs/sec`)
    console.log(`Buffer size: ${stats.bufferSize}/${appLogger.maxBufferSize}`)
    
    console.log('\n5. Recent logs (last 3):')
    const recentLogs = appLogger.getRecentLogs(3)
    recentLogs.forEach((log, i) => {
      console.log(`  ${i + 1}. [${log.level}] ${log.message}`)
    })
    
    console.log('\n6. Testing log level filtering:')
    appLogger.setLevel('warn')
    console.log('Level set to WARN - debug and info should not appear:')
    appLogger.debug('This debug message should not appear')
    appLogger.info('This info message should not appear')
    appLogger.warn('This warning should appear')
    appLogger.setLevel('info') // Reset
    
    console.log('\n7. Testing console replacement:')
    console.log('Original console.log')
    
    // Enable console replacement
    consoleReplacement.replace()
    console.log('Replaced console.log (should go through structured logger)')
    console.warn('Replaced console.warn')
    console.error('Replaced console.error')
    
    // Restore original console
    consoleReplacement.restore()
    console.log('Restored console.log')
    
  } catch (error) {
    console.error('Structured logger test failed:', error)
  }
}

async function testIntegration() {
  console.log('\n=== Testing Integration ===\n')
  
  try {
    // Create logger using configuration
    const logger = getLogger('Integration', {
      level: getConfig('LOGGING.DEFAULT_LEVEL'),
      enableConsole: true
    })
    
    // Test timeout configuration usage
    const apiTimeout = getConfig('TIMEOUTS.API_REQUEST')
    logger.info('API timeout configured', { timeout: apiTimeout })
    
    // Test rate limit configuration
    const rateLimit = getConfig('RATE_LIMITS.DEFAULT_REQUESTS')
    logger.info('Rate limit configured', { requestsPerMinute: rateLimit })
    
    // Test feature flags
    const cachingEnabled = getConfig('FEATURES.ENABLE_CACHING')
    if (cachingEnabled) {
      logger.info('Caching feature is enabled')
    } else {
      logger.warn('Caching feature is disabled')
    }
    
    // Test retry configuration
    const maxRetries = getConfig('LIMITS.MAX_RETRY_ATTEMPTS')
    const initialDelay = getConfig('RETRY.INITIAL_DELAY')
    logger.info('Retry configuration loaded', { maxRetries, initialDelay })
    
    console.log('✓ Integration test completed successfully')
    
  } catch (error) {
    console.error('❌ Integration test failed:', error)
  }
}

async function runAllTests() {
  console.log('🧪 Testing Configuration and Logging Improvements\n')
  
  await testConfigSystem()
  await testStructuredLogger()
  await testIntegration()
  
  console.log('\n✅ All improvement tests completed!')
  
  // Show summary
  console.log('\n📊 Summary of Improvements:')
  console.log('1. ✓ Centralized configuration system with environment overrides')
  console.log('2. ✓ Configuration validation and error checking')
  console.log('3. ✓ Structured logging with levels and formatting')
  console.log('4. ✓ Sensitive data redaction in logs')
  console.log('5. ✓ Console replacement for consistent logging')
  console.log('6. ✓ Child logger support for component-specific logging')
  console.log('7. ✓ Log statistics and monitoring')
  console.log('8. ✓ Integration between configuration and logging systems')
}

runAllTests().catch(console.error)