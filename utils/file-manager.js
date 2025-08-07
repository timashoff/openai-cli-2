import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { color } from '../config/color.js'
import { logger } from './logger.js'
import { multiProviderTranslator } from './multi-provider-translator.js'

// Directory for saving document translations
const DOCS_DIR = path.join(os.homedir(), 'AI_responses', 'documents')

/**
 * File manager for document translations
 */
export class FileManager {
  constructor() {
    this.docsDir = DOCS_DIR
  }

  /**
   * Ensure documents directory exists
   */
  async ensureDocsDir() {
    try {
      await fs.mkdir(this.docsDir, { recursive: true })
      
      // Set secure permissions (owner read/write/execute only)
      try {
        await fs.chmod(this.docsDir, 0o700)
      } catch (chmodError) {
        logger.warn('Could not set secure permissions on documents directory')
      }
    } catch (error) {
      logger.error('Error creating documents directory:', error)
      throw error
    }
  }

  /**
   * Generate filename using Claude Sonnet
   */
  async generateFilename(content, originalText = '') {
    try {
      // Initialize multi-provider translator if needed
      if (!multiProviderTranslator.isInitialized) {
        await multiProviderTranslator.initialize()
      }

      // Use Claude Sonnet to generate filename
      const instruction = 'Generate a short, descriptive filename (without extension) for this translated document. Use only alphanumeric characters, hyphens, and underscores. Maximum 50 characters. Focus on the main topic or title'
      
      const contextText = originalText ? 
        `Original text: ${originalText.substring(0, 200)}...\n\nTranslated text: ${content.substring(0, 200)}...` :
        content.substring(0, 400) + '...'

      const signal = new AbortController().signal
      const result = await multiProviderTranslator.translateSingle(instruction, contextText, signal)
      
      const claudeResponse = result.result
      
      if (claudeResponse && claudeResponse.response) {
        // Clean and sanitize filename
        let filename = claudeResponse.response.trim()
          .replace(/[^a-zA-Z0-9а-яё\-_\s]/g, '') // Remove special chars
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .toLowerCase()
          .substring(0, 50) // Max 50 chars
        
        // Remove trailing hyphens
        filename = filename.replace(/-+$/, '')
        
        if (filename.length < 3) {
          filename = 'document-translation'
        }
        
        return filename
      }
    } catch (error) {
      logger.error('Failed to generate filename using Claude:', error)
    }
    
    // Fallback to timestamp-based filename
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
    return `document-${timestamp}`
  }

  /**
   * Save document translation to file
   */
  async saveDocumentTranslation(content, originalText = '', metadata = {}) {
    try {
      await this.ensureDocsDir()
      
      // Generate filename
      const baseFilename = await this.generateFilename(content, originalText)
      const timestamp = new Date().toISOString()
      
      // Create full content with metadata
      const fullContent = this.formatDocumentContent(content, originalText, metadata, timestamp)
      
      // Find available filename (handle duplicates)
      let counter = 0
      let filename = `${baseFilename}.md`
      let filePath = path.join(this.docsDir, filename)
      
      while (await this.fileExists(filePath)) {
        counter++
        filename = `${baseFilename}-${counter}.md`
        filePath = path.join(this.docsDir, filename)
      }
      
      // Save file
      await fs.writeFile(filePath, fullContent, 'utf-8')
      
      // Set secure permissions
      try {
        await fs.chmod(filePath, 0o600)
      } catch (chmodError) {
        logger.warn('Could not set secure permissions on document file')
      }
      
      logger.debug(`Document saved: ${filename}`)
      
      return {
        filename,
        filepath: filePath,
        size: fullContent.length
      }
    } catch (error) {
      logger.error('Failed to save document translation:', error)
      throw error
    }
  }

  /**
   * Format document content with metadata
   */
  formatDocumentContent(content, originalText, metadata, timestamp) {
    let formatted = `# Document Translation\n\n`
    
    // Add metadata
    formatted += `**Generated:** ${timestamp}\n`
    formatted += `**Provider:** Claude Sonnet\n`
    
    if (metadata.url) {
      formatted += `**Source URL:** ${metadata.url}\n`
    }
    
    if (metadata.title) {
      formatted += `**Original Title:** ${metadata.title}\n`
    }
    
    formatted += `**Content Length:** ${content.length} characters\n\n`
    formatted += `---\n\n`
    
    // Add original text if provided (truncated)
    if (originalText && originalText.length > 100) {
      formatted += `## Original Text (Preview)\n\n`
      formatted += `${originalText.substring(0, 500)}${originalText.length > 500 ? '...' : ''}\n\n`
      formatted += `---\n\n`
    }
    
    // Add translation
    formatted += `## Translation\n\n`
    formatted += content
    
    return formatted
  }

  /**
   * Check if file exists
   */
  async fileExists(filepath) {
    try {
      await fs.access(filepath)
      return true
    } catch {
      return false
    }
  }

  /**
   * List saved documents
   */
  async listDocuments() {
    try {
      await this.ensureDocsDir()
      const files = await fs.readdir(this.docsDir)
      
      const documents = []
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filepath = path.join(this.docsDir, file)
          const stats = await fs.stat(filepath)
          
          documents.push({
            filename: file,
            filepath,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          })
        }
      }
      
      // Sort by creation time (newest first)
      documents.sort((a, b) => b.created - a.created)
      
      return documents
    } catch (error) {
      logger.error('Failed to list documents:', error)
      return []
    }
  }

  /**
   * Show success message after saving
   */
  showSaveSuccess(fileInfo) {
    console.log(`\n${color.green}✓ Document saved${color.reset}`)
    console.log(`${color.grey}File: ${fileInfo.filename}${color.reset}`)
    console.log(`${color.grey}Location: ${fileInfo.filepath}${color.reset}`)
    console.log(`${color.grey}Size: ${Math.round(fileInfo.size / 1024 * 100) / 100} KB${color.reset}`)
  }
}

// Export singleton instance
export const fileManager = new FileManager()