import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawn } from 'node:child_process'
import { logger } from './logger.js'
import { errorHandler } from './error-handler.js'

/**
 * MCP Manager for handling server lifecycle and client connections
 */
export class MCPManager {
  constructor() {
    this.servers = new Map()
    this.clients = new Map()
    this.isInitialized = false
  }

  /**
   * Initialize MCP manager with server configurations
   */
  async initialize(serverConfigs) {
    try {
      logger.debug('Initializing MCP Manager')
      
      for (const [serverName, config] of Object.entries(serverConfigs)) {
        await this.startServer(serverName, config)
      }
      
      this.isInitialized = true
      logger.debug(`MCP Manager initialized with ${this.servers.size} servers`)
    } catch (error) {
      errorHandler.handleError(error, { context: 'mcp_initialization' })
      throw error
    }
  }

  /**
   * Start an MCP server
   */
  async startServer(serverName, config) {
    try {
      logger.debug(`Starting MCP server: ${serverName}`)
      
      // For built-in servers, we don't spawn external processes
      if (config.type === 'builtin') {
        const client = new Client(
          {
            name: "openai-cli-client",
            version: "3.0.0",
          },
          {
            capabilities: {
              tools: {},
              resources: {},
            },
          }
        )
        
        // Store server config for later use
        this.servers.set(serverName, {
          type: 'builtin',
          config,
          status: 'running'
        })
        
        this.clients.set(serverName, client)
        logger.debug(`Built-in MCP server started: ${serverName}`)
        return
      }
      
      // For external servers, spawn process
      const serverProcess = spawn(config.command, config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...config.env }
      })
      
      const transport = new StdioClientTransport({
        stdin: serverProcess.stdin,
        stdout: serverProcess.stdout,
        stderr: serverProcess.stderr,
      })
      
      const client = new Client(
        {
          name: "openai-cli-client",
          version: "3.0.0",
        },
        {
          capabilities: {
            tools: {},
            resources: {},
          },
        }
      )
      
      await client.connect(transport)
      
      // Store server info
      this.servers.set(serverName, {
        type: 'external',
        process: serverProcess,
        transport,
        config,
        status: 'running'
      })
      
      this.clients.set(serverName, client)
      
      // Handle process events
      serverProcess.on('error', (error) => {
        logger.error(`MCP server ${serverName} error:`, error)
        this.servers.get(serverName).status = 'error'
      })
      
      serverProcess.on('exit', (code) => {
        logger.debug(`MCP server ${serverName} exited with code ${code}`)
        this.servers.get(serverName).status = 'stopped'
      })
      
      logger.debug(`MCP server started: ${serverName}`)
      
    } catch (error) {
      logger.error(`Failed to start MCP server ${serverName}:`, error)
      this.servers.set(serverName, {
        config,
        status: 'error',
        error: error.message
      })
      throw error
    }
  }

  /**
   * Get MCP client for a server
   */
  getClient(serverName) {
    return this.clients.get(serverName)
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(serverName, toolName, args = {}) {
    try {
      const client = this.getClient(serverName)
      if (!client) {
        throw new Error(`MCP server not found: ${serverName}`)
      }
      
      const result = await client.callTool({
        name: toolName,
        arguments: args
      })
      
      return result
    } catch (error) {
      logger.error(`Failed to call tool ${toolName} on server ${serverName}:`, error)
      throw error
    }
  }


  /**
   * Get server status
   */
  getServerStatus(serverName) {
    const server = this.servers.get(serverName)
    return server ? server.status : 'not_found'
  }

  /**
   * Stop all servers
   */
  async cleanup() {
    logger.debug('Cleaning up MCP servers')
    
    for (const [serverName, server] of this.servers) {
      try {
        if (server.type === 'external' && server.process) {
          server.process.kill()
        }
        
        const client = this.clients.get(serverName)
        if (client) {
          await client.close()
        }
        
      } catch (error) {
        logger.error(`Error cleaning up server ${serverName}:`, error)
      }
    }
    
    this.servers.clear()
    this.clients.clear()
    this.isInitialized = false
  }
}

// Export singleton instance
export const mcpManager = new MCPManager()