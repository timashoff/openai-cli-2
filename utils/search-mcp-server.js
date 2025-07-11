import { logger } from './logger.js'
import { fetchMCPServer } from './fetch-mcp-server.js'

/**
 * Simple built-in search MCP server using DuckDuckGo
 */
export class SearchMCPServer {
  constructor() {
    this.name = 'web-search'
    this.tools = [
      {
        name: 'search_web',
        description: 'Search the web using DuckDuckGo',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            },
            region: {
              type: 'string',
              description: 'Region code (us-en, ru-ru, cn-zh)',
              default: 'us-en'
            },
            limit: {
              type: 'number',
              description: 'Number of results to return',
              default: 5
            }
          },
          required: ['query']
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
      case 'search_web':
        return await this.searchWeb(args.query, args.region, args.limit)
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * Search web using DuckDuckGo
   */
  async searchWeb(query, region = 'us-en', limit = 5) {
    try {
      logger.debug(`Searching web: ${query}`)
      
      // Use DuckDuckGo instant answer API
      const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&region=${region}&safesearch=moderate&no_html=1`
      
      const result = await fetchMCPServer.fetchUrl(searchUrl)
      const data = JSON.parse(result.text)
      
      const results = []
      
      // Add instant answer if available
      if (data.Abstract) {
        results.push({
          title: data.Heading || 'Instant Answer',
          content: data.Abstract,
          url: data.AbstractURL,
          type: 'instant_answer'
        })
      }
      
      // Add related topics
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, limit - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || 'Related',
              content: topic.Text,
              url: topic.FirstURL,
              type: 'related_topic'
            })
          }
        }
      }
      
      // If no results, provide fallback
      if (results.length === 0) {
        results.push({
          title: 'Search suggestion',
          content: `No direct results found for "${query}". Try searching on major search engines.`,
          url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          type: 'suggestion'
        })
      }
      
      return {
        query,
        region,
        results: results.slice(0, limit),
        total: results.length,
        source: 'DuckDuckGo'
      }
      
    } catch (error) {
      throw new Error(`Web search failed: ${error.message}`)
    }
  }
}

// Export instance
export const searchMCPServer = new SearchMCPServer()