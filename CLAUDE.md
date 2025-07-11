# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Run the application:**
```bash
npm start
# or
node bin/app.js
# or (if globally installed)
ai
```

**Development with auto-reload:**
```bash
npm run dev
```

**Utility commands:**
```bash
npm run clean-cache    # Clear translation cache
npm run check-env      # Validate environment setup
```

**Installation:**
```bash
npm i -g              # Global installation
```

## Development Principles

**⚠️ CRITICAL RULE: NO HARDCODING!**
- **Never hardcode** specific names, URLs, organizations, or domain-specific content
- Use **universal patterns, algorithms, and configuration** instead
- Examples of violations:
  - ❌ `if (text.includes('Putin'))` - specific person name
  - ❌ `if (url === 'https://rbc.ru')` - specific website
  - ❌ `const companies = ['Apple', 'Google']` - specific company names
- Examples of correct approaches:
  - ✅ `if (newsPatterns.some(pattern => pattern.test(text)))` - universal patterns
  - ✅ `if (isGovernmentTerm(text))` - generic categorization
  - ✅ `if (hasMultipleCapitalizedWords(text))` - structural analysis

**Why this matters:**
- Ensures code works universally across different languages, regions, and domains
- Prevents maintenance nightmares when specific entities change
- Keeps algorithms flexible and extensible
- Maintains the principle of separation of concerns

## Project Architecture

This is a multi-provider AI CLI tool with a modern OOP architecture designed for terminal-based AI interactions.

### Core Architecture Patterns

**Provider Factory Pattern:** The application uses a factory pattern to create AI providers (OpenAI, DeepSeek, Anthropic). Each provider implements the `BaseProvider` interface with standardized methods for `listModels()`, `createChatCompletion()`, and `initializeClient()`.

**Command Pattern:** Two separate command systems:
- Core commands (help, exit) via `CommandManager` in `utils/command-manager.js`
- AI commands (provider, model switching) via `AIApplication.aiCommands`
- Instruction-based commands (translation, grammar) via `INSTRUCTIONS` config

**Streaming Architecture:** Real-time response streaming with escape key cancellation:
- `StreamProcessor` handles different provider response formats
- Global keypress handler for immediate escape response
- State management for `isProcessingRequest` vs `isTypingResponse`

**Application Inheritance:** `AIApplication` extends base `Application` class, adding AI-specific functionality while maintaining core application features.

### Key Components

**State Management:**
- `Application.state` - Core app state (context history, user session)
- `AIApplication.aiState` - AI-specific state (provider, models, selected model)
- Context history for multi-turn conversations (non-translation queries only)

**Provider System:**
- `provider-factory.js` - Creates provider instances
- `config/api_providers.js` - Provider configurations
- Each provider handles its own API client initialization and model listing

**Caching System:**
- Translation requests cached in user's home directory
- Cache bypass with `--force` or `-f` flags
- Automatic cache cleanup utilities

**Security Features:**
- Input validation and sanitization (`utils/validation.js`)
- Rate limiting per provider
- CSP checking for security
- Error message sanitization

### Configuration System

**Environment Variables:**
- `OPENAI_API_KEY` - OpenAI API key
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `ANTHROPIC_API_KEY` - Anthropic API key (optional)

**Config Files:**
- `config/instructions.js` - Translation and task commands
- `config/api_providers.js` - Provider configurations
- `config/default_models.js` - Preferred model selection
- `config/constants.js` - App constants (symbols, timeouts)

### Special Features

**Command Detection:** Input is processed in order:
1. System commands (help, exit)
2. AI commands (provider, model)
3. Instruction commands (translation/grammar via INSTRUCTIONS)
4. General chat (sent to AI with context)

**Escape Key Handling:** Global keypress handler provides immediate cancellation:
- During API requests: Aborts request and shows cancellation
- During response streaming: Stops output immediately
- Uses multiple timeout strategies for guaranteed responsiveness

**Clipboard Integration:** `$$` token in input gets replaced with clipboard content, with length validation and sanitization.

**MCP (Model Context Protocol) Integration:** Automatic intent detection for web content extraction:
- URL detection for webpage content extraction
- Web search capabilities for general queries
- Built-in MCP servers for fetch and search operations
- Language detection for consistent response formatting

### MCP System Architecture

**Intent Detection:** `utils/intent-detector.js` analyzes input to determine if MCP processing is needed:
- URL pattern matching for webpage extraction
- Search keyword detection for web search
- Confidence scoring for routing decisions

**MCP Manager:** `utils/mcp-manager.js` handles MCP server lifecycle:
- Built-in server initialization and management
- Tool calling interface for MCP operations
- Server configuration from `config/mcp-servers.json`

**Built-in MCP Servers:**
- `utils/fetch-mcp-server.js` - Advanced webpage content extraction with article detection
- `utils/search-mcp-server.js` - Web search using DuckDuckGo API
- Custom HTML parsing with multiple content selectors and cleanup

**MCP Processing Flow:**
1. Input analyzed by intent detector
2. Appropriate MCP server called with routing parameters
3. Response formatted and enhanced with language detection
4. Content passed to AI model with additional context

## Key Files to Understand

- `bin/app.js` - Main application entry point with AIApplication class
- `utils/application.js` - Base application class with core functionality
- `utils/provider-factory.js` - AI provider creation and management
- `utils/stream-processor.js` - Response streaming with provider-specific parsing
- `config/instructions.js` - Translation and task command definitions
- `utils/command-manager.js` - Command registration and execution system
- `utils/mcp-manager.js` - MCP server lifecycle management
- `utils/intent-detector.js` - Automatic intent detection for MCP routing
- `utils/fetch-mcp-server.js` - Built-in webpage content extraction server
- `utils/search-mcp-server.js` - Built-in web search server
- `config/mcp-servers.json` - MCP server configuration