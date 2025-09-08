import { logger } from './logger.js'
import { errorHandler } from '../core/error-system/index.js'
import { APP_CONSTANTS } from '../config/constants.js'

/**
 * Simple built-in fetch MCP server
 */
export class FetchMCPServer {
  constructor() {
    this.name = 'fetch'
    this.tools = [
      {
        name: 'fetch_url',
        description: 'Fetch content from a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch'
            },
            options: {
              type: 'object',
              description: 'Fetch options',
              properties: {
                method: { type: 'string', default: 'GET' },
                headers: { type: 'object' },
                timeout: { type: 'number', default: 10000 }
              }
            }
          },
          required: ['url']
        }
      },
      {
        name: 'extract_content',
        description: 'Extract readable content from HTML',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to extract content from'
            },
            selector: {
              type: 'string',
              description: 'CSS selector for specific content (optional)'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'follow_related_content',
        description: 'Follow a link from previously extracted content based on description',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Description of the link to follow (e.g., "IBM processor details", "expert opinions")'
            },
            sourceUrl: {
              type: 'string',
              description: 'Original URL where the links were found'
            }
          },
          required: ['description']
        }
      }
    ]
  }

  /**
   * List available tools
   */
  async listTools() {
    return this.tools
  }

  /**
   * Call a tool
   */
  async callTool(toolName, args) {
    switch (toolName) {
      case 'fetch_url':
        return await this.fetchUrl(args.url, args.options)
      case 'extract_content':
        return await this.extractContent(args.url, args.selector)
      case 'follow_related_content':
        return await this.followRelatedContent(args.description, args.sourceUrl)
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * Fetch URL content
   */
  async fetchUrl(url, options = {}) {
    try {
      logger.debug(`Fetching URL: ${url}`)
      
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), options.timeout || 10000)
      
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'OpenAI-CLI/3.0.0 (Web Content Fetcher)',
          ...options.headers
        },
        signal: controller.signal
      })
      
      clearTimeout(timeout)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const contentType = response.headers.get('content-type') || ''
      
      if (contentType.includes('application/json')) {
        const data = await response.json()
        return {
          url,
          status: response.status,
          contentType,
          data,
          text: JSON.stringify(data, null, 2)
        }
      } else {
        const text = await response.text()
        return {
          url,
          status: response.status,
          contentType,
          text,
          length: text.length
        }
      }
      
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout for URL: ${url}`)
      }
      throw new Error(`Failed to fetch ${url}: ${error.message}`)
    }
  }

  /**
   * Follow a related link based on description
   */
  async followRelatedContent(description, sourceUrl = null) {
    try {
      // For now, we'll need to maintain a simple cache of recent extractions
      // In a real implementation, you'd want a proper session store
      if (!this.recentExtractions) {
        this.recentExtractions = new Map()
      }
      
      // Find the most recent extraction or the one from sourceUrl
      let extraction = null
      if (sourceUrl && this.recentExtractions.has(sourceUrl)) {
        extraction = this.recentExtractions.get(sourceUrl)
      } else {
        // Get the most recent extraction
        const entries = Array.from(this.recentExtractions.entries())
        if (entries.length > 0) {
          extraction = entries[entries.length - 1][1]
        }
      }
      
      if (!extraction || !extraction.links) {
        throw new Error('No recent extractions with links found. Please extract content from a URL first.')
      }
      
      // Check if description is a number (link selection by index)
      const linkIndex = parseInt(description.trim())
      let matchingLink = null
      
      if (!isNaN(linkIndex) && linkIndex >= 1 && linkIndex <= extraction.links.length) {
        // Select link by number (1-indexed)
        matchingLink = extraction.links[linkIndex - 1]
        logger.debug(`Following link by number: ${linkIndex} -> ${matchingLink.text}`)
      } else {
        // Handle contextual requests
        let targetDescription = description
        if (this.isContextualRequest(description)) {
          // If it's a contextual request like "полный материал", try to find the most relevant link
          targetDescription = this.resolveContextualRequest(description, extraction)
        }
        
        // Find the best matching link
        matchingLink = this.findBestMatchingLink(extraction.links, targetDescription)
      }
      
      if (!matchingLink) {
        // Return available links if no match found
        const availableLinks = extraction.links.map((link, index) => 
          `${index + 1}. ${link.text}`
        ).join('\n')
        
        throw new Error(`No link found matching "${description}". Available links:\n${availableLinks}`)
      }
      
      logger.debug(`Following link: ${matchingLink.text} -> ${matchingLink.url}`)
      
      // Extract content from the matched link
      const result = await this.extractContent(matchingLink.url)
      
      // Add context about the link we followed
      return {
        ...result,
        followedFrom: {
          sourceUrl: extraction.url,
          linkText: matchingLink.text,
          linkUrl: matchingLink.url
        }
      }
      
    } catch (error) {
      throw new Error(`Failed to follow related content: ${error.message}`)
    }
  }

  /**
   * Check if request is contextual (refers to previous discussion)
   */
  isContextualRequest(description) {
    const lowerDesc = description.toLowerCase()
    
    // Simple string matching for contextual phrases
    const contextualPhrases = [
      // Russian phrases
      'полный материал', 'полная статья', 'подробнее', 'детали', 'больше информации', 'развернуто',
      'открой полный', 'покажи полный', 'дай полный', 'загрузи полный',
      // English phrases
      'full article', 'full material', 'more details', 'details', 'more information', 'expand',
      'open full', 'show full', 'give full', 'load full'
    ]
    
    return contextualPhrases.some(phrase => lowerDesc.includes(phrase))
  }
  
  /**
   * Resolve contextual request to actual link description
   */
  resolveContextualRequest(description, extraction) {
    // For "полный материал" type requests, try to find the main article link
    // Priority: longest link text (usually main articles have longer titles)
    if (!extraction.links || extraction.links.length === 0) {
      return description
    }
    
    // Find the link with the longest text (likely the main article)
    let longestLink = extraction.links[0]
    for (const link of extraction.links) {
      if (link.text.length > longestLink.text.length) {
        longestLink = link
      }
    }
    
    // Return the text of the most substantial link
    return longestLink.text
  }
  
  /**
   * Find the best matching link based on description
   */
  findBestMatchingLink(links, description) {
    const searchTerms = description.toLowerCase().split(' ')
    let bestMatch = null
    let bestScore = 0
    
    for (const link of links) {
      const linkText = link.text.toLowerCase()
      let score = 0
      
      // Check for exact phrase match
      if (linkText.includes(description.toLowerCase())) {
        score += 10
      }
      
      // Check for reverse substring match (минвестиции -> инвестиции)
      if (description.toLowerCase().includes(linkText)) {
        score += 8
      }
      
      // Enhanced name matching (Чичваркин, Трамп, etc.)
      const nameScore = this.calculateNameMatchScore(linkText, description.toLowerCase())
      score += nameScore
      
      // Check for partial matches with edit distance
      const partialScore = this.calculatePartialMatchScore(linkText, description.toLowerCase())
      score += partialScore
      
      // Check for individual word matches
      for (const term of searchTerms) {
        if (linkText.includes(term)) {
          score += 1
        }
        
        // Check reverse - if link text contains parts of search term
        if (term.includes(linkText)) {
          score += 2
        }
      }
      
      // Check for common substring matches
      const commonSubstring = this.findLongestCommonSubstring(linkText, description.toLowerCase())
      if (commonSubstring.length > 3) {
        score += commonSubstring.length / 2
      }
      
      // Special handling for common abbreviations and transformations
      const abbreviationScore = this.checkAbbreviationMatch(linkText, description.toLowerCase())
      score += abbreviationScore
      
      // Enhanced topic matching
      const topicScore = this.calculateTopicMatchScore(linkText, description.toLowerCase())
      score += topicScore
      
      // Bonus for longer matches
      if (score > 0) {
        score += linkText.length / 100
      }
      
      if (score > bestScore) {
        bestScore = score
        bestMatch = link
      }
    }
    
    return bestMatch
  }
  
  /**
   * Calculate partial match score using simple string similarity
   */
  calculatePartialMatchScore(text1, text2) {
    const shorter = text1.length < text2.length ? text1 : text2
    const longer = text1.length >= text2.length ? text1 : text2
    
    let score = 0
    
    // Check for substring matches of at least 3 characters
    for (let i = 0; i <= shorter.length - 3; i++) {
      const substring = shorter.substring(i, i + 3)
      if (longer.includes(substring)) {
        score += 0.5
      }
    }
    
    return score
  }
  
  /**
   * Find longest common substring
   */
  findLongestCommonSubstring(str1, str2) {
    let longest = ''
    
    for (let i = 0; i < str1.length; i++) {
      for (let j = i + 1; j <= str1.length; j++) {
        const substring = str1.substring(i, j)
        if (str2.includes(substring) && substring.length > longest.length) {
          longest = substring
        }
      }
    }
    
    return longest
  }
  
  /**
   * Check for abbreviation and transformation matches
   */
  checkAbbreviationMatch(linkText, query) {
    let score = 0
    
    // Common transformations
    const transformations = [
      // Russian abbreviations
      { pattern: /телеканал/i, abbrev: /тв/i },
      { pattern: /автомобиль/i, abbrev: /авто/i },
      { pattern: /autonews/i, abbrev: /авто/i },
      { pattern: /компании/i, abbrev: /комп/i },
      { pattern: /мероприятия/i, abbrev: /событи/i },
      { pattern: /недвижимость/i, abbrev: /недвиж/i },
      { pattern: /инвестиции/i, abbrev: /инвест/i },
      { pattern: /инвестиции/i, abbrev: /вклад/i },
      { pattern: /спорт/i, abbrev: /спорт/i },
      { pattern: /новости/i, abbrev: /новост/i }
    ]
    
    for (const transform of transformations) {
      if (transform.pattern.test(linkText) && transform.abbrev.test(query)) {
        score += 3
      }
      if (transform.abbrev.test(linkText) && transform.pattern.test(query)) {
        score += 3
      }
    }
    
    return score
  }

  /**
   * Calculate name matching score (for names like Чичваркин, Трамп, etc.)
   */
  calculateNameMatchScore(linkText, query) {
    let score = 0
    
    // Extract potential names from query (capitalized words or in quotes)
    const namePatterns = [
      // Names in quotes
      /[«»""''](.*?)[«»""'']/g,
      // Capitalized words that might be names
      /[А-ЯЁ][а-яё]+|[A-Z][a-z]+/g
    ]
    
    const queryNames = []
    for (const pattern of namePatterns) {
      const matches = query.match(pattern)
      if (matches) {
        queryNames.push(...matches.map(m => m.toLowerCase().replace(/[«»""'']/g, '')))
      }
    }
    
    // Also check for common prepositions that indicate names
    const namePrepositions = ['про', 'о', 'about']
    for (const prep of namePrepositions) {
      if (query.includes(prep)) {
        // Extract words after prepositions as potential names
        const parts = query.split(prep)
        if (parts.length > 1) {
          const potentialNames = parts[1].trim().split(' ')
          queryNames.push(...potentialNames.filter(name => name.length > 2))
        }
      }
    }
    
    // Check if any names from query appear in link text
    for (const name of queryNames) {
      if (linkText.includes(name)) {
        score += 5
      }
    }
    
    return score
  }

  /**
   * Calculate topic matching score
   */
  calculateTopicMatchScore(linkText, query) {
    let score = 0
    
    // Common topic keywords
    const topicKeywords = {
      'экономика': ['экономик', 'деньги', 'рубл', 'доллар', 'инвестиц', 'банк', 'биржа', 'курс'],
      'политика': ['политик', 'власт', 'правительств', 'президент', 'министр', 'депутат', 'парламент'],
      'военное': ['военн', 'армия', 'войск', 'оружие', 'конфликт', 'война', 'удар', 'атак'],
      'технологии': ['технолог', 'компьютер', 'интернет', 'программ', 'данн', 'цифров', 'ai', 'бот'],
      'культура': ['культур', 'искусств', 'театр', 'кино', 'музык', 'фестивал', 'концерт', 'выставк'],
      'спорт': ['спорт', 'футбол', 'хоккей', 'теннис', 'олимпиад', 'чемпионат', 'матч', 'игра'],
      'наука': ['наук', 'исследован', 'ученый', 'открыт', 'изобретен', 'технолог', 'медицин']
    }
    
    // Check which topic the query belongs to
    let queryTopic = null
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      for (const keyword of keywords) {
        if (query.includes(keyword)) {
          queryTopic = topic
          break
        }
      }
      if (queryTopic) break
    }
    
    // If we found a topic, check if the link matches it
    if (queryTopic && topicKeywords[queryTopic]) {
      for (const keyword of topicKeywords[queryTopic]) {
        if (linkText.includes(keyword)) {
          score += 2
        }
      }
    }
    
    return score
  }

  /**
   * Extract readable content from HTML
   */
  async extractContent(url, selector = null) {
    try {
      const fetchResult = await this.fetchUrl(url)
      
      if (!fetchResult.contentType.includes('text/html')) {
        // Limit content to configured maximum length
        const limitedContent = fetchResult.text.length > APP_CONSTANTS.MAX_CONTENT_LENGTH ? 
          fetchResult.text.substring(0, APP_CONSTANTS.MAX_CONTENT_LENGTH) + '...' : 
          fetchResult.text
          
        return {
          url,
          content: limitedContent,
          length: limitedContent.length,
          originalLength: fetchResult.text.length,
          type: 'non-html'
        }
      }
      
      // Advanced content extraction with better article detection
      let html = fetchResult.text
      
      // Extract links before removing HTML tags
      const extractedLinks = this.extractLinks(html, url)
      
      // Remove script and style tags
      html = html.replace(/<script[^>]*>.*?<\/script>/gis, '')
      html = html.replace(/<style[^>]*>.*?<\/style>/gis, '')
      html = html.replace(/<noscript[^>]*>.*?<\/noscript>/gis, '')
      
      // Extract title
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'No title'
      
      // Try to find main content using common article selectors
      const articleContent = this.extractArticleContent(html)
      
      let result
      if (articleContent) {
        // Limit content to configured maximum length
        const limitedContent = articleContent.length > APP_CONSTANTS.MAX_CONTENT_LENGTH ? 
          articleContent.substring(0, APP_CONSTANTS.MAX_CONTENT_LENGTH) + '...' : 
          articleContent
          
        result = {
          url,
          title,
          content: limitedContent,
          length: limitedContent.length,
          originalLength: articleContent.length,
          type: 'article-extracted',
          links: extractedLinks
        }
      } else {
        // Fallback to general content extraction
        const generalContent = this.extractGeneralContent(html)
        
        // Limit content to configured maximum length
        const limitedContent = generalContent.length > APP_CONSTANTS.MAX_CONTENT_LENGTH ? 
          generalContent.substring(0, APP_CONSTANTS.MAX_CONTENT_LENGTH) + '...' : 
          generalContent
        
        result = {
          url,
          title,
          content: limitedContent,
          length: limitedContent.length,
          originalLength: generalContent.length,
          type: 'general-extracted',
          links: extractedLinks
        }
      }
      
      // Cache the result for follow_related_content
      if (!this.recentExtractions) {
        this.recentExtractions = new Map()
      }
      this.recentExtractions.set(url, result)
      
      // Keep only the last 5 extractions to prevent memory issues
      if (this.recentExtractions.size > 5) {
        const firstKey = this.recentExtractions.keys().next().value
        this.recentExtractions.delete(firstKey)
      }
      
      return result
      
    } catch (error) {
      throw new Error(`Failed to extract content from ${url}: ${error.message}`)
    }
  }

  /**
   * Extract article content using common patterns
   */
  extractArticleContent(html) {
    // Common article content selectors (ordered by priority)
    const articleSelectors = [
      'article',
      '[role="main"]',
      '.article-content',
      '.article-body',
      '.post-content',
      '.content-body',
      '.entry-content',
      '.news-content',
      '.story-content',
      '.article-text',
      '.content-text',
      '.post-body',
      '.text-content',
      '.article__content',
      '.js-mediator-article',
      '.article__text',
      '.article-detail__content'
    ]
    
    for (const selector of articleSelectors) {
      const content = this.extractBySelector(html, selector)
      if (content && content.length > 200) {
        return content
      }
    }
    
    return null
  }

  /**
   * Extract content by CSS selector
   */
  extractBySelector(html, selector) {
    try {
      // Simple selector matching for common patterns
      let regex
      
      if (selector.startsWith('.')) {
        // Class selector
        const className = selector.substring(1)
        regex = new RegExp(`<[^>]*class[^>]*=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>(.*?)</[^>]*>`, 'gis')
      } else if (selector.startsWith('[')) {
        // Attribute selector
        const attrMatch = selector.match(/\[([^=]+)=["']([^"']+)["']\]/)
        if (attrMatch) {
          const attrName = attrMatch[1]
          const attrValue = attrMatch[2]
          regex = new RegExp(`<[^>]*${attrName}[^>]*=["'][^"']*\\b${attrValue}\\b[^"']*["'][^>]*>(.*?)</[^>]*>`, 'gis')
        }
      } else {
        // Tag selector
        regex = new RegExp(`<${selector}[^>]*>(.*?)</${selector}>`, 'gis')
      }
      
      if (regex) {
        const match = html.match(regex)
        if (match) {
          const content = match[1]
          return this.cleanHtmlContent(content)
        }
      }
      
      return null
    } catch (error) {
      return null
    }
  }

  /**
   * Extract general content when article detection fails
   */
  extractGeneralContent(html) {
    // Remove navigation, header, footer, ads, etc.
    const removeSelectors = [
      'nav', 'header', 'footer', 'aside', 'menu',
      '.nav', '.header', '.footer', '.sidebar', '.advertisement',
      '.ads', '.social', '.comments', '.related', '.popular'
    ]
    
    let content = html
    
    for (const selector of removeSelectors) {
      if (selector.startsWith('.')) {
        const className = selector.substring(1)
        content = content.replace(new RegExp(`<[^>]*class[^>]*=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>.*?</[^>]*>`, 'gis'), '')
      } else {
        content = content.replace(new RegExp(`<${selector}[^>]*>.*?</${selector}>`, 'gis'), '')
      }
    }
    
    // Try to find main content area
    const mainContent = this.extractBySelector(content, 'main') || 
                       this.extractBySelector(content, '.main') ||
                       this.extractBySelector(content, '#main') ||
                       this.extractBySelector(content, '.content') ||
                       this.extractBySelector(content, '#content')
    
    if (mainContent && mainContent.length > 100) {
      return mainContent
    }
    
    // Fallback: clean entire body
    return this.cleanHtmlContent(content)
  }

  /**
   * Extract links from HTML content
   */
  extractLinks(html, baseUrl) {
    const links = []
    
    try {
      // First, try to extract links from main content areas
      const contentAreas = [
        'article', 'main', '.content', '.article-content', '.post-content', 
        '.entry-content', '.story-content', '.article-body', '.text-content'
      ]
      
      let contentHtml = html
      
      // Try to find main content area
      for (const selector of contentAreas) {
        const content = this.extractBySelector(html, selector)
        if (content && content.length > 200) {
          contentHtml = content
          break
        }
      }
      
      // Extract all anchor tags with href attributes
      const linkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis
      let match
      
      while ((match = linkRegex.exec(contentHtml)) !== null) {
        const href = this.decodeHtmlEntities(match[1])
        const text = match[2]
        
        // Clean the anchor text
        const cleanText = text
          .replace(/<[^>]+>/g, '') // Remove HTML tags
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim()
        
        // Skip empty links or very short ones
        if (!cleanText || cleanText.length < 3) continue
        
        // Skip common navigation links
        if (this.isNavigationLink(cleanText)) continue
        
        // Skip links that are just numbers or single words that look like navigation
        if (/^\d+$/.test(cleanText) || /^(edit|source|cite|references?)$/i.test(cleanText)) continue
        
        // Convert relative URLs to absolute
        let absoluteUrl = href
        if (href.startsWith('/')) {
          const baseUrlObj = new URL(baseUrl)
          absoluteUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`
        } else if (href.startsWith('./') || href.startsWith('../')) {
          try {
            absoluteUrl = new URL(href, baseUrl).href
          } catch (e) {
            continue // Skip invalid URLs
          }
        } else if (!href.startsWith('http')) {
          continue // Skip non-HTTP links (mailto, tel, etc.)
        }
        
        // Skip links to the same page or just anchors
        if (absoluteUrl === baseUrl || href.startsWith('#')) continue
        
        links.push({
          url: absoluteUrl,
          text: cleanText,
          context: this.extractLinkContext(contentHtml, match.index)
        })
      }
      
      // If no links found in content, fallback to all HTML but with stricter filtering
      if (links.length === 0) {
        const allLinkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis
        let fallbackMatch
        
        while ((fallbackMatch = allLinkRegex.exec(html)) !== null) {
          const href = this.decodeHtmlEntities(fallbackMatch[1])
          const text = fallbackMatch[2]
          
          const cleanText = text
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
          
          // More strict filtering for fallback
          if (!cleanText || cleanText.length < 5) continue
          if (this.isNavigationLink(cleanText)) continue
          if (/^\d+$/.test(cleanText)) continue
          
          // Only accept links that seem like content (longer text, specific patterns)
          if (cleanText.length > 10 || /^[A-Z][a-z]/.test(cleanText)) {
            let absoluteUrl = href
            if (href.startsWith('/')) {
              const baseUrlObj = new URL(baseUrl)
              absoluteUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`
            } else if (!href.startsWith('http')) {
              continue
            }
            
            if (absoluteUrl !== baseUrl && !href.startsWith('#')) {
              links.push({
                url: absoluteUrl,
                text: cleanText,
                context: this.extractLinkContext(html, fallbackMatch.index)
              })
            }
          }
        }
      }
      
      // Always search for news headlines and article titles across the entire page
      const newsLinks = this.extractNewsLinks(html, baseUrl)
      links.push(...newsLinks)
      
      // Remove duplicates and prioritize content links
      const uniqueLinks = this.deduplicateLinks(links)
      
      // Separate content links from navigation links
      const contentLinks = uniqueLinks.filter(link => 
        link.type === 'news' || this.isContentLink(link.text)
      )
      const navigationLinks = uniqueLinks.filter(link => 
        link.type !== 'news' && !this.isContentLink(link.text)
      )
      
      // Prioritize content links - show them first, then navigation if needed
      const prioritizedLinks = [
        ...contentLinks,
        ...navigationLinks.slice(0, Math.max(0, 20 - contentLinks.length))
      ]
      
      return prioritizedLinks.slice(0, APP_CONSTANTS.MAX_LINKS_TO_DISPLAY)
      
    } catch (error) {
      logger.debug(`Failed to extract links: ${error.message}`)
      return []
    }
  }
  
  /**
   * Extract news links and headlines from HTML
   */
  extractNewsLinks(html, baseUrl) {
    const newsLinks = []
    
    try {
      // Look for common news headline patterns
      const newsSelectors = [
        // Common news headline selectors
        '.news-feed__item a', '.news-item a', '.article-item a',
        '.headline a', '.title a', '.story-title a',
        '.news-title a', '.article-title a', '.post-title a',
        // RBC specific patterns
        '.js-news-feed-item a', '.news-feed-item a', '.rubric-item a',
        '.js-topline-item a', '.topline-item a'
      ]
      
      for (const selector of newsSelectors) {
        const selectorLinks = this.extractLinksBySelector(html, selector, baseUrl)
        newsLinks.push(...selectorLinks)
      }
      
      // Also look for links that contain typical news keywords
      const allLinkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis
      let match
      
      while ((match = allLinkRegex.exec(html)) !== null) {
        const href = this.decodeHtmlEntities(match[1])
        const text = match[2]
        
        const cleanText = text
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
        
        // Skip if already processed or too short
        if (!cleanText || cleanText.length < 10) continue
        if (this.isNavigationLink(cleanText)) continue
        
        // Look for content-like patterns (instead of strict news patterns)
        if (this.isContentLink(cleanText)) {
          let absoluteUrl = href
          if (href.startsWith('/')) {
            const baseUrlObj = new URL(baseUrl)
            absoluteUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`
          } else if (!href.startsWith('http')) {
            continue
          }
          
          if (absoluteUrl !== baseUrl && !href.startsWith('#')) {
            newsLinks.push({
              url: absoluteUrl,
              text: cleanText,
              context: this.extractLinkContext(html, match.index),
              type: 'news'
            })
          }
        }
      }
      
    } catch (error) {
      logger.debug(`Failed to extract news links: ${error.message}`)
    }
    
    return newsLinks
  }
  
  /**
   * Extract links by CSS selector
   */
  extractLinksBySelector(html, selector, baseUrl) {
    const links = []
    
    try {
      // Simple selector parsing for common patterns
      if (selector.includes(' a')) {
        const containerSelector = selector.replace(' a', '')
        const containerContent = this.extractBySelector(html, containerSelector)
        
        if (containerContent) {
          const linkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis
          let match
          
          while ((match = linkRegex.exec(containerContent)) !== null) {
            const href = this.decodeHtmlEntities(match[1])
            const text = match[2]
            
            const cleanText = text
              .replace(/<[^>]+>/g, '')
              .replace(/\s+/g, ' ')
              .trim()
            
            if (cleanText && cleanText.length > 5 && !this.isNavigationLink(cleanText)) {
              let absoluteUrl = href
              if (href.startsWith('/')) {
                const baseUrlObj = new URL(baseUrl)
                absoluteUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`
              } else if (!href.startsWith('http')) {
                continue
              }
              
              if (absoluteUrl !== baseUrl && !href.startsWith('#')) {
                links.push({
                  url: absoluteUrl,
                  text: cleanText,
                  context: '',
                  type: 'news'
                })
              }
            }
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to extract links by selector: ${error.message}`)
    }
    
    return links
  }
  
  /**
   * Check if text looks like a news title
   */
  isNewsLikeTitle(text) {
    // Must be reasonable length for a title
    if (text.length < 15 || text.length > 200) return false
    
    // Skip obvious navigation links
    if (this.isNavigationLink(text)) return false
    
    // Universal approach: check for news-like patterns WITHOUT hardcoded names
    const newsIndicators = [
      // News action verbs pattern
      /\b(сообщил|заявил|объявил|предложил|ответил|рассказал|похоронили|упали|сообщило|конфисковал|announced|said|reported|revealed|proposed|responded|buried|fell|confiscated)\b/i,
      // Legal/conflict terms
      /\b(суд|дело|конфликт|самоубийство|акции|активы|court|case|conflict|suicide|shares|assets)\b/i,
      // Currency/percentage patterns
      /\b(\d+)\s*(рубл|dollar|евро|процент|млн|млрд|тыс|billion|million|thousand|%)\b/i,
      // Government/organization terms
      /\b(Кремль|Минобороны|ВТБ|Kremlin|Pentagon|Ministry|Department)\b/i,
      // Geographic terms (without specific names)
      /\b(Россия|России|Москва|Москве|Украина|Украине|США|Европ|Китай|Китае|Russia|Moscow|Ukraine|USA|Europe|China)\b/i
    ]
    
    // Check for news indicators
    for (const pattern of newsIndicators) {
      if (pattern.test(text)) {
        return true
      }
    }
    
    // Check for multiple capitalized words (typical for news with names)
    const capitalizedWords = text.match(/\b[А-ЯA-Z][а-яёa-zA-Z]+/g)
    if (capitalizedWords && capitalizedWords.length >= 3) {
      return true
    }
    
    return false
  }
  
  /**
   * Check if link text represents meaningful content rather than navigation
   */
  isContentLink(text) {
    // Content links typically have:
    // - Longer descriptive text
    // - Specific topics or names
    // - Not generic navigation terms
    
    // Too short - probably navigation
    if (text.length < 10) return false
    
    // Skip navigation links
    if (this.isNavigationLink(text)) return false
    
    // Simple heuristic: if it's longer than 20 characters and not navigation, it's likely content
    if (text.length > 20) return true
    
    // Contains specific indicators of content
    const contentIndicators = [
      // Contains specific actions or events
      /\b(произошло|случилось|состоялось|началось|завершилось|объявил|заявил|сообщил|ответил|предложил|рухнули|упали|снял|конфисковал|гибель|власти|суд|банки)\b/i,
      // Contains specific numbers or percentages
      /\b\d+\s*(%|процент|рубл|доллар|евро|млн|млрд|тыс)\b/i,
      // Contains quotes or specific references
      /[«»""'']/,
      // Contains multiple capitalized words (proper nouns)
      /\b[А-ЯA-Z][а-яa-z]+\s+[А-ЯA-Z][а-яa-z]+/,
      // Contains question or explanatory format
      /\b(как|что|где|когда|почему|зачем|who|what|where|when|why|how)\b/i,
      // Contains specific technical or professional terms
      /\b(активы|акции|курс|цена|стоимость|процент|рубл|доллар|евро|shares|price|cost|percent|dollar|euro|бригада|командир|арест|требования|дивидендный|гэп)\b/i,
      // Contains government/organization terms (generic patterns only)
      /\b(Кремль|Минобороны|суд|власти|банки|министерство|ведомство|Kremlin|Ministry|Court|Bank|Department|Agency)\b/i
    ]
    
    return contentIndicators.some(pattern => pattern.test(text))
  }
  
  /**
   * Check if link text indicates navigation
   */
  isNavigationLink(text) {
    const navPatterns = [
      /^(home|главная|начало)$/i,
      /^(about|о нас|контакты|contact)$/i,
      /^(menu|меню|навигация)$/i,
      /^(login|войти|регистрация|sign up)$/i,
      /^(next|prev|previous|далее|назад|подробнее)$/i,
      /^(search|поиск|найти)$/i,
      /^(share|поделиться|отправить)$/i,
      /^(subscribe|подписаться|подписка)$/i,
      /^(download|скачать|загрузить)$/i,
      /^(click here|нажмите здесь|читать далее)$/i,
      // Wikipedia navigation patterns
      /^(main page|contents|current events|random article|about wikipedia|contact us|help|learn to edit|community portal|recent changes)$/i,
      /^(главная страница|содержание|случайная статья|справка|обсуждение|вклад|создать учётную запись|войти)$/i,
      // Habr navigation patterns
      /^(хабр|как стать автором|моя лента|все потоки|разработка|администрирование|дизайн|менеджмент|маркетинг|научпоп|блоги|qa|события|карьера)$/i,
      // Generic navigation patterns
      /^(privacy|terms|cookies|disclaimer|sitemap|rss|feed|archive|tags|categories)$/i,
      /^(конфиденциальность|условия|карта сайта|архив|теги|категории|подписка|реклама)$/i,
      // Short generic links
      /^(more|read|view|see|all|list|index|back|top)$/i,
      /^(ещё|читать|смотреть|все|список|назад|вверх)$/i
    ]
    
    return navPatterns.some(pattern => pattern.test(text))
  }
  
  /**
   * Decode HTML entities in URLs
   */
  decodeHtmlEntities(str) {
    const htmlEntities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&#x27;': "'",
      '&#x2F;': '/',
      '&#x60;': '`',
      '&#x3D;': '='
    }
    
    return str.replace(/&[#\w]+;/g, (entity) => {
      return htmlEntities[entity] || entity
    })
  }
  
  /**
   * Extract context around a link
   */
  extractLinkContext(html, linkIndex) {
    const contextLength = 100
    const start = Math.max(0, linkIndex - contextLength)
    const end = Math.min(html.length, linkIndex + contextLength)
    
    return html.substring(start, end)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  
  /**
   * Remove duplicate links
   */
  deduplicateLinks(links) {
    const seen = new Set()
    const unique = []
    
    for (const link of links) {
      const key = `${link.url}|${link.text}`
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(link)
      }
    }
    
    return unique
  }

  /**
   * Clean HTML content
   */
  cleanHtmlContent(html) {
    // Remove remaining HTML tags
    let content = html.replace(/<[^>]+>/g, ' ')
    
    // Decode HTML entities
    content = content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '...')
    
    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
    
    return content
  }
}

// Export instance
export const fetchMCPServer = new FetchMCPServer()