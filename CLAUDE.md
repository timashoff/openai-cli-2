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

## Key Files to Understand

- `bin/app.js` - Main application entry point with AIApplication class
- `utils/application.js` - Base application class with core functionality
- `utils/provider-factory.js` - AI provider creation and management
- `utils/stream-processor.js` - Response streaming with provider-specific parsing
- `config/instructions.js` - Translation and task command definitions
- `utils/command-manager.js` - Command registration and execution system