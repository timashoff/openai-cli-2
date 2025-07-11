import { logger } from './logger.js'
import { errorHandler } from './error-handler.js'

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
   * Extract readable content from HTML
   */
  async extractContent(url, selector = null) {
    try {
      const fetchResult = await this.fetchUrl(url)
      
      if (!fetchResult.contentType.includes('text/html')) {
        return {
          url,
          content: fetchResult.text,
          type: 'non-html'
        }
      }
      
      // Advanced content extraction with better article detection
      let html = fetchResult.text
      
      // Remove script and style tags
      html = html.replace(/<script[^>]*>.*?<\/script>/gis, '')
      html = html.replace(/<style[^>]*>.*?<\/style>/gis, '')
      html = html.replace(/<noscript[^>]*>.*?<\/noscript>/gis, '')
      
      // Extract title
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'No title'
      
      // Try to find main content using common article selectors
      const articleContent = this.extractArticleContent(html)
      
      if (articleContent) {
        return {
          url,
          title,
          content: articleContent,
          length: articleContent.length,
          type: 'article-extracted'
        }
      }
      
      // Fallback to general content extraction
      const generalContent = this.extractGeneralContent(html)
      
      return {
        url,
        title,
        content: generalContent,
        length: generalContent.length,
        type: 'general-extracted'
      }
      
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