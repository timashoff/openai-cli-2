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
    
    
    // Check for simple numeric inputs (link selection)
    const trimmedInput = input.trim()
    const linkIndex = parseInt(trimmedInput)
    if (!isNaN(linkIndex) && linkIndex >= 1 && linkIndex <= 20 && trimmedInput === linkIndex.toString()) {
      // This is a pure numeric input for link selection
      detectedIntents.push({
        type: 'follow_link',
        confidence: 1.0,
        data: {
          description: trimmedInput,
          action: 'follow_related_content'
        }
      })
    }
    
    // Check for web-N format (link selection)
    const webLinkMatch = trimmedInput.match(/^web-(\d+)$/i)
    if (webLinkMatch) {
      const linkNumber = parseInt(webLinkMatch[1])
      if (linkNumber >= 1 && linkNumber <= 20) {
        detectedIntents.push({
          type: 'follow_link',
          confidence: 1.0,
          data: {
            description: linkNumber.toString(),
            action: 'follow_related_content'
          }
        })
      }
    }
    
    // Check for contextual requests (полный материал, подробнее, etc.)
    const contextualPatterns = [
      /^(?:полный материал|полная статья|подробнее|детали|больше информации|развернуто|открой полный|покажи полный|дай полный|загрузи полный)$/i,
      /^(?:full article|full material|more details|details|more information|expand|open full|show full|give full|load full)$/i
    ]
    
    for (const pattern of contextualPatterns) {
      if (pattern.test(trimmedInput)) {
        detectedIntents.push({
          type: 'follow_link',
          confidence: 0.9,
          data: {
            description: trimmedInput,
            action: 'follow_related_content'
          }
        })
        break // Only match first pattern
      }
    }
    
    // Check for link following requests (follow_link intent)
    const linkFollowPatterns = [
      /(?:открой|открыть|посмотри|посмотреть|изучи|изучить|покажи|показать|расскажи|рассказать|подробнее|детали|details|about|про|о|можешь открыть|можешь показать|можешь изучить)\s+(.+)/i,
      /(?:перейди|переходи|перейти|follow|go to|check out|переходи на|иди на|зайди на)\s+(.+)/i,
      /(?:что там|а что|расскажи|давай|хочу|хочется|интересно|интересует)\s+(.+)/i,
      /(?:ссылк[уа]|link|линк).+(?:с|about|про|о|на)\s+(.+)/i
    ]
    
    for (const pattern of linkFollowPatterns) {
      const match = input.match(pattern)
      if (match) {
        const description = match[1].trim()
        // Only trigger if it's not a URL itself and we haven't already matched a numeric/contextual intent
        if (!this.extractUrls(description).length && detectedIntents.length === 0) {
          detectedIntents.push({
            type: 'follow_link',
            confidence: 0.8,
            data: {
              description: description,
              action: 'follow_related_content'
            }
          })
        }
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
    
    // Check for "open domain" commands (открой rbc.ru, open google.com)
    const openDomainPattern = /(?:открой|открыть|покажи|показать|зайди|перейди|посети|open|go to|visit)\s+([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/i
    const openDomainMatch = input.match(openDomainPattern)
    if (openDomainMatch && !urls.length) {
      const domain = openDomainMatch[0].replace(/^(?:открой|открыть|покажи|показать|зайди|перейди|посети|open|go to|visit)\s+/i, '')
      detectedIntents.push({
        type: 'webpage',
        confidence: 0.9,
        data: {
          urls: [`https://${domain}`],
          action: 'summarize'
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
    const urls = []
    
    // First, try to match full URLs with protocol
    const fullUrls = input.match(this.patterns.webpage.urlRegex) || []
    urls.push(...fullUrls.map(url => url.trim()))
    
    // Then, try to match domain names without protocol
    const domainRegex = /\b([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g
    const domains = input.match(domainRegex) || []
    
    for (const domain of domains) {
      // Skip if it's already a full URL
      if (!fullUrls.some(url => url.includes(domain))) {
        // Add https:// prefix
        urls.push(`https://${domain}`)
      }
    }
    
    return urls
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
      
      case 'follow_link':
        return {
          server: 'fetch',
          tool: 'follow_related_content',
          args: {
            description: primaryIntent.data.description
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