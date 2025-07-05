
import { initializeApi } from './index.js';
import { createSecureHeaders, validateApiKey } from './security.js';
import { AppError } from './error-handler.js';
import { APP_CONSTANTS } from '../config/constants.js';

/**
 * Base adapter class implementing common functionality
 */
class BaseAdapter {
  constructor(providerKey, provider) {
    this.providerKey = providerKey;
    this.provider = provider;
    this.rateLimiter = null; // Can be added per provider if needed
  }

  /**
   * Validates response and handles common errors
   */
  async handleResponse(response) {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new AppError(error.error?.message || 'API request failed', true, response.status);
    }
    return response;
  }

  /**
   * Create request with timeout and error handling
   */
  async makeRequest(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APP_CONSTANTS.API_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });
      return await this.handleResponse(response);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new AppError('Request timeout', true, 408);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async listModels() {
    throw new Error('listModels() must be implemented by subclasses');
  }

  async createChatCompletion(model, messages, signal) {
    throw new Error('createChatCompletion() must be implemented by subclasses');
  }
}

/**
 * OpenAI-compatible adapter (OpenAI, DeepSeek, etc.)
 */
class OpenAIAdapter extends BaseAdapter {
  constructor(providerKey, provider) {
    super(providerKey, provider);
    this.api = initializeApi(providerKey);
  }

  async listModels() {
    try {
      const list = await this.api.models.list();
      return list.data.sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      throw new AppError(`Failed to list models: ${error.message}`, true, 500);
    }
  }

  async createChatCompletion(model, messages, signal) {
    try {
      return await this.api.chat.completions.create(
        {
          model,
          messages,
          stream: true,
        },
        { signal },
      );
    } catch (error) {
      throw new AppError(`Failed to create chat completion: ${error.message}`, true, 500);
    }
  }
}

/**
 * Anthropic (Claude) adapter
 */
class AnthropicAdapter extends BaseAdapter {
  constructor(providerKey, provider) {
    super(providerKey, provider);
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!this.apiKey) {
      throw new AppError('ANTHROPIC_API_KEY is not set in environment variables.', true, 401);
    }
    
    // Validate API key format
    validateApiKey(this.apiKey, 'anthropic');
  }

  async listModels() {
    try {
      const response = await this.makeRequest('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: createSecureHeaders(this.apiKey, 'anthropic'),
      });
      
      const list = await response.json();
      return list.data.sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      throw new AppError(`Failed to list Anthropic models: ${error.message}`, true, 500);
    }
  }

  async createChatCompletion(model, messages, signal) {
    try {
      const response = await this.makeRequest('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: createSecureHeaders(this.apiKey, 'anthropic'),
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          max_tokens: 4096,
        }),
        signal,
      });
      
      return this.createStreamProcessor(response.body);
    } catch (error) {
      throw new AppError(`Failed to create Anthropic chat completion: ${error.message}`, true, 500);
    }
  }

  /**
   * Create a stream processor for Anthropic SSE format
   */
  createStreamProcessor(stream) {
    return {
      async *[Symbol.asyncIterator]() {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            // Keep the last incomplete line in buffer
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              const trimmedLine = line.trim();
              
              // Skip empty lines and comments
              if (!trimmedLine || trimmedLine.startsWith(':')) {
                continue;
              }
              
              if (trimmedLine.startsWith('data: ')) {
                const data = trimmedLine.substring(6).trim();
                
                // Check for end of stream
                if (data === '[DONE]') {
                  return;
                }
                
                // Skip empty data
                if (!data) {
                  continue;
                }
                
                try {
                  const json = JSON.parse(data);
                  
                  // Handle different event types
                  if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
                    yield { choices: [{ delta: { content: json.delta.text } }] };
                  } else if (json.delta && json.delta.text) {
                    // Fallback for older format
                    yield { choices: [{ delta: { content: json.delta.text } }] };
                  }
                } catch (e) {
                  // Only log if it's not a known non-JSON line
                  if (data !== '[DONE]' && !data.startsWith('event:')) {
                    console.warn('JSON parsing error in Anthropic stream:', e.message);
                  }
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    };
  }
}

/**
 * Factory function to create appropriate adapter
 */
export function createAdapter(providerKey, providers) {
  const provider = providers[providerKey];
  if (!provider) {
    throw new AppError(`Provider ${providerKey} not found.`, true, 404);
  }

  if (provider.isClaude) {
    return new AnthropicAdapter(providerKey, provider);
  } else {
    return new OpenAIAdapter(providerKey, provider);
  }
}

/**
 * Registry for managing adapters
 */
export class AdapterRegistry {
  constructor() {
    this.adapters = new Map();
  }

  registerAdapter(providerKey, adapter) {
    this.adapters.set(providerKey, adapter);
  }

  getAdapter(providerKey) {
    return this.adapters.get(providerKey);
  }

  hasAdapter(providerKey) {
    return this.adapters.has(providerKey);
  }

  clearAdapters() {
    this.adapters.clear();
  }
}
