import { BaseRequestHandler } from './base-handler.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { color } from '../config/color.js'

/**
 * Handler for processing command flags (--force, -f, etc.)
 * Extracts flags from input and adds them to processing context
 */
export class FlagHandler extends BaseRequestHandler {
  constructor(dependencies) {
    super(dependencies)
    
    // Safe access to constants with fallbacks
    const forceFlags = APP_CONSTANTS?.FORCE_FLAGS || [' --force', ' -f']
    
    /** @type {string[]} */
    this.supportedFlags = forceFlags
    /** @type {Map<string, FlagDefinition>} */
    this.flagDefinitions = new Map()
    
    this.initializeFlagDefinitions()
  }

  /**
   */
  async canHandle(context) {
    return this.hasFlags(context.processedInput)
  }

  /**
   */
  async process(context) {
    const input = context.processedInput
    const extractedFlags = this.extractAllFlags(input)
    const cleanInput = this.removeFlags(input, extractedFlags)
    
    this.log('info', `Extracted flags: ${Object.keys(extractedFlags).join(', ')}`)
    
    // Add flags to context for other handlers
    context.flags = { ...context.flags, ...extractedFlags }
    
    // Show debug info if verbose flag is set
    if (extractedFlags.verbose) {
      console.log(`${color.grey}[Flags processed: ${Object.keys(extractedFlags).join(', ')}]${color.reset}`)
    }
    
    // Emit flag processing event
    this.emitEvent('flags:processed', {
      flagCount: Object.keys(extractedFlags).length,
      flags: Object.keys(extractedFlags)
    })
    
    return this.createPassThrough(cleanInput, {
      flagsProcessed: true,
      extractedFlags,
      flagCount: Object.keys(extractedFlags).length
    })
  }

  /**
   * Initialize flag definitions
   */
  initializeFlagDefinitions() {
    // Force flag
    this.flagDefinitions.set('force', {
      patterns: [' --force', ' -f'],
      description: 'Force operation bypassing cache and validation',
      type: 'boolean',
      defaultValue: false
    })
    
    // Verbose flag
    this.flagDefinitions.set('verbose', {
      patterns: [' --verbose', ' -v'],
      description: 'Enable verbose output and debugging',
      type: 'boolean',
      defaultValue: false
    })
    
    // Quiet flag
    this.flagDefinitions.set('quiet', {
      patterns: [' --quiet', ' -q'],
      description: 'Suppress non-essential output',
      type: 'boolean',
      defaultValue: false
    })
    
    // Timeout flag (with value)
    this.flagDefinitions.set('timeout', {
      patterns: [' --timeout=', ' -t='],
      description: 'Set operation timeout in seconds',
      type: 'number',
      defaultValue: null,
      hasValue: true
    })
    
    // Output format flag
    this.flagDefinitions.set('format', {
      patterns: [' --format=', ' --output='],
      description: 'Specify output format (json, text, markdown)',
      type: 'string',
      defaultValue: 'text',
      hasValue: true,
      validValues: ['json', 'text', 'markdown', 'raw']
    })
    
    // Debug flag
    this.flagDefinitions.set('debug', {
      patterns: [' --debug'],
      description: 'Enable debug mode with detailed logging',
      type: 'boolean',
      defaultValue: false
    })
  }

  /**
   * Check if input contains any flags


   */
  hasFlags(input) {
    return Array.from(this.flagDefinitions.values()).some(flagDef =>
      flagDef.patterns.some(pattern => 
        flagDef.hasValue ? 
          input.includes(pattern) : 
          input.endsWith(pattern) || input.includes(pattern + ' ')
      )
    )
  }

  /**
   * Extract all flags from input


   */
  extractAllFlags(input) {
    const extractedFlags = {}
    
    for (const [flagName, flagDef] of this.flagDefinitions) {
      const flagValue = this.extractFlag(input, flagName, flagDef)
      if (flagValue !== null) {
        extractedFlags[flagName] = flagValue
      }
    }
    
    return extractedFlags
  }

  /**
   * Extract specific flag from input




   */
  extractFlag(input, flagName, flagDef) {
    for (const pattern of flagDef.patterns) {
      if (flagDef.hasValue) {
        // Flag with value (--timeout=30)
        const match = input.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\s]+)'))
        if (match) {
          return this.parseValue(match[1], flagDef)
        }
      } else {
        // Boolean flag (--force)
        if (input.endsWith(pattern) || input.includes(pattern + ' ')) {
          return true
        }
      }
    }
    
    return null
  }

  /**
   * Parse flag value according to type



   */
  parseValue(value, flagDef) {
    switch (flagDef.type) {
      case 'number':
        const num = parseInt(value, 10)
        if (isNaN(num)) {
          this.log('warn', `Invalid number value for flag: ${value}`)
          return flagDef.defaultValue
        }
        return num
        
      case 'string':
        // Validate against allowed values if specified
        if (flagDef.validValues && !flagDef.validValues.includes(value)) {
          this.log('warn', `Invalid value '${value}' for flag. Valid values: ${flagDef.validValues.join(', ')}`)
          return flagDef.defaultValue
        }
        return value
        
      case 'boolean':
        return value.toLowerCase() === 'true' || value === '1'
        
      default:
        return value
    }
  }

  /**
   * Remove all flags from input



   */
  removeFlags(input, extractedFlags) {
    let cleanInput = input
    
    // Remove each flag from input
    for (const [flagName, flagDef] of this.flagDefinitions) {
      if (extractedFlags.hasOwnProperty(flagName)) {
        for (const pattern of flagDef.patterns) {
          if (flagDef.hasValue) {
            // Remove pattern with value
            const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\s]+', 'g')
            cleanInput = cleanInput.replace(regex, '')
          } else {
            // Remove boolean pattern
            const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            cleanInput = cleanInput.replace(new RegExp(escapedPattern + '$'), '').replace(new RegExp(escapedPattern + '\\s+'), ' ')
          }
        }
      }
    }
    
    return cleanInput.trim()
  }

  /**
   * Get flag definition by name


   */
  getFlagDefinition(flagName) {
    return this.flagDefinitions.get(flagName) || null
  }

  /**
   * Get all supported flags

   */
  getSupportedFlags() {
    return Array.from(this.flagDefinitions.entries()).map(([name, def]) => ({
      name,
      ...def
    }))
  }

  /**
   * Add custom flag definition


   */
  addFlag(flagName, flagDefinition) {
    const requiredFields = ['patterns', 'description', 'type']
    const missing = requiredFields.filter(field => !flagDefinition[field])
    
    if (missing.length > 0) {
      throw new Error(`Missing required flag definition fields: ${missing.join(', ')}`)
    }
    
    this.flagDefinitions.set(flagName, {
      defaultValue: null,
      hasValue: false,
      validValues: null,
      ...flagDefinition
    })
    
    this.log('debug', `Added custom flag: ${flagName}`)
  }

  /**
   * Remove flag definition


   */
  removeFlag(flagName) {
    const removed = this.flagDefinitions.delete(flagName)
    if (removed) {
      this.log('debug', `Removed flag: ${flagName}`)
    }
    return removed
  }

  /**
   */
  getStats() {
    const baseStats = super.getStats()
    
    // Count flag usage statistics
    const flagUsage = {}
    for (const [flagName] of this.flagDefinitions) {
      flagUsage[flagName] = 0 // Would need to track actual usage
    }
    
    return {
      ...baseStats,
      flagOperations: {
        supportedFlags: this.flagDefinitions.size,
        flagDefinitions: Object.fromEntries(this.flagDefinitions),
        flagUsage
      }
    }
  }

  /**
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus()
    
    return {
      ...baseHealth,
      flagHealth: {
        definitionsLoaded: this.flagDefinitions.size,
        supportedFlagTypes: ['boolean', 'string', 'number'],
        hasCustomFlags: this.flagDefinitions.size > 6 // More than built-in flags
      }
    }
  }
}