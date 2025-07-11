import { logger } from './logger.js'

/**
 * Intent detection system for MCP routing
 */
export class IntentDetector {
  constructor() {
    this.patterns = {
      webpage: {
        urlRegex: /https?:\/\/[^\s]+/g,
        keywords: ['сайт', 'статья', 'прочитай', 'summarize', 'extract', 'website', 'article'],
        weight: 1.0
      },
      
      search: {
        keywords: ['найди', 'find', 'search', 'поиск', 'узнай', 'расскажи', 'tell me about'],
        weight: 0.6
      }
    }
  }

  /**
   * Detect intent from user input
   */
  detectIntent(input) {
    const lowercaseInput = input.toLowerCase()
    const detectedIntents = []
    
    // Check for explicit URL command
    if (input.trim().toLowerCase().startsWith('url ')) {
      const urlPart = input.slice(4).trim() // Remove 'url ' prefix
      const urls = this.extractUrls(urlPart)
      if (urls.length > 0) {
        detectedIntents.push({
          type: 'webpage',
          confidence: 1.0, // Maximum confidence for explicit command
          data: {
            urls: urls,
            action: 'summarize'
          }
        })
        return detectedIntents // Return immediately for explicit command
      }
    }
    
    
    // Check for URLs (webpage intent)
    const urls = this.extractUrls(input)
    if (urls.length > 0) {
      detectedIntents.push({
        type: 'webpage',
        confidence: 0.95,
        data: {
          urls: urls,
          action: this.extractWebAction(input)
        }
      })
    }
    
    
    // Check for general search intent
    const searchScore = this.calculateKeywordScore(lowercaseInput, this.patterns.search.keywords)
    if (searchScore > 0 && detectedIntents.length === 0) {
      detectedIntents.push({
        type: 'search',
        confidence: Math.min(searchScore * this.patterns.search.weight, 0.7),
        data: {
          query: input
        }
      })
    }
    
    // Sort by confidence
    detectedIntents.sort((a, b) => b.confidence - a.confidence)
    
    logger.debug(`Intent detection for "${input}":`, detectedIntents)
    
    return detectedIntents
  }

  /**
   * Extract URLs from input
   */
  extractUrls(input) {
    const urls = input.match(this.patterns.webpage.urlRegex) || []
    return urls.map(url => url.trim())
  }

  /**
   * Extract web action from input (summarize, read, etc.)
   */
  extractWebAction(input) {
    const actions = {
      'summarize': ['summarize', 'суммируй', 'кратко', 'резюме'],
      'read': ['read', 'прочитай', 'читай'],
      'extract': ['extract', 'извлеки', 'выдели'],
      'analyze': ['analyze', 'анализируй', 'разбери']
    }
    
    const lowercaseInput = input.toLowerCase()
    
    for (const [action, keywords] of Object.entries(actions)) {
      if (keywords.some(keyword => lowercaseInput.includes(keyword))) {
        return action
      }
    }
    
    return 'summarize' // default action
  }


  /**
   * Calculate keyword match score
   */
  calculateKeywordScore(input, keywords) {
    let score = 0
    let matches = 0
    
    for (const keyword of keywords) {
      if (input.includes(keyword)) {
        matches++
        // Longer keywords get higher score
        score += keyword.length / 10
      }
    }
    
    // Normalize score
    if (matches > 0) {
      score = Math.min(score / keywords.length + (matches / keywords.length), 1.0)
    }
    
    return score
  }

  /**
   * Determine MCP routing based on intent
   */
  getMCPRouting(intents) {
    if (intents.length === 0) {
      return null
    }
    
    const primaryIntent = intents[0]
    
    switch (primaryIntent.type) {
      case 'webpage':
        return {
          server: 'fetch',
          tool: 'extract_content',
          args: {
            url: primaryIntent.data.urls[0],
            action: primaryIntent.data.action
          }
        }
      
      case 'search':
        return {
          server: 'web-search',
          tool: 'search_web',
          args: {
            query: primaryIntent.data.query,
            limit: 5
          }
        }
      
      default:
        return null
    }
  }

  /**
   * Check if input requires MCP processing
   */
  requiresMCP(input) {
    const trimmed = input.trim().toLowerCase()
    
    // Check for explicit commands
    if (trimmed.startsWith('url ')) {
      return true
    }
    
    const intents = this.detectIntent(input)
    if (intents.length === 0) {
      return false
    }
    
    const primaryIntent = intents[0]
    
    // Lower threshold for search intents
    if (primaryIntent.type === 'search') {
      return primaryIntent.confidence > 0.2
    }
    
    // Higher threshold for other intents
    return primaryIntent.confidence > 0.5
  }
}

// Export singleton instance
export const intentDetector = new IntentDetector()