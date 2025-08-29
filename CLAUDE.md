# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Global Development Rules

## General Principles
- Never hardcode!
- Avoid complex regexp, use dictionaries/arrays/slices instead
- Minimize regexp usage
- Maintain a separate file for project-wide constants
- Always follow KISS, DRY, YAGNI principles
- Strictly follow Single Source of Truth principle
- Implement new features modularly for easy improvement/removal
- ALL comments in code EXCLUSIVELY in English
- ALL logs and technical messages EXCLUSIVELY in English
- ALL user messages EXCLUSIVELY in English
- Design for i18n from the start, prepare architecture for multilingual support
- NEVER LOG sensitive information (passwords, API keys, secrets)

## JavaScript Project Rules
- Always check for dead code before preparing commit messages
- Use ESM modules, no require!
- Remove unused imports and their source files/code
- **FORBIDDEN to use classes!** Code must be written in functional paradigm:
  - Factory functions
  - Objects with methods
  - Function composition
  - Modules with exported functions
  - Example: instead of `class User {}` use `const createUser = () => ({})`
- Always write async code for I/O operations, HTTP requests etc. No event loop blocking! Use async/await instead of .then()
- Minimal external dependencies! Use built-in Node.js capabilities when available
- Never use express.js framework! Only fastify!
- Don't replace original error messages with generic ones. Always show error.message for real error reasons. EXCEPTION: sanitize if error.message contains sensitive info
- SQLite support is built into Node.js! Use node:sqlite instead of external dependencies
- NEVER use optional chaining operator "?."
- No legacy approaches like `const __dirname = path.dirname(fileURLToPath(import.meta.url))` - use modern `import.meta.dirname`
- NO JSDoc comments! Don't clutter projects with this garbage

## Git Commit Rules
- DON'T add AI-generated lines like "🤖 Generated with [Claude Code](https://claude.ai/code)" to commit messages

## Git Workflow and Branching
- Using **Enhanced GitFlow** for development team
- **Branch Structure**:
  ```
  master     ──●────●────●────●──  (releases only with tags)
                │    │    │    │
                v1.0 v1.1 v1.2 v2.0
                │    │    │    │
  develop    ──●────●────●────●──  (integration branch)
              ╱ ╲  ╱ ╲  ╱ ╲  ╱ ╲
  feature/A  ●───●╱   ╲╱   ╲╱   ╲
  feature/B     ●─────●╱   ╲╱
  feature/C          ●─────●╱
  ```

- **Workflow**:
  1. **feature → develop**: Squash merge (clean history)
  2. **develop → master**: Squash merge + manual version tags

- **Commands for development**:
  ```bash
  # Feature development
  git checkout -b feature/my-feature
  git commit -m "feat: implement awesome feature"
  
  # Merge to develop (squash)
  git checkout develop
  git merge --squash feature/my-feature
  git commit -m "feat: implement user authentication system"
  
  # Release to master (when ready)
  git checkout master
  git merge --squash develop
  git commit -m "release: v1.1.0 - description"
  git tag -s v1.1.0 -m "Release v1.1.0"
  git push origin master --tags
  
  # Sync develop with master after release
  git checkout develop
  git reset --hard master
  git push origin develop --force
  ```

- **Advantages**:
  - Simplicity: only basic git commands
  - Flexibility: versions assigned manually when ready
  - Cleanliness: squash merge gives clean history in develop
  - Maximum clean history: each commit in master = release
  - GPG signatures: use -s flag for verified tags
  - Control: full control over releases
  - Minimalism: no external dependencies

- **Commit types** (conventional commits):
  - `feat:` - new functionality
  - `fix:` - bug fix
  - `docs:` - documentation changes
  - `style:` - formatting, no code changes
  - `refactor:` - code refactoring
  - `test:` - adding tests (only when app is production-stable)
  - `chore:` - build updates, auxiliary tools

## Code Refactoring Rules

### Basic Principles:
- **DELETE** old code immediately after replacement - no deprecated, legacy or fallback!
- Create git branch `refactor/feature-name` for each major refactoring
- Git is the only backup, no additional backups in code

### Legacy File Handling Rules:
- When asked to **mark file as legacy** - means file is marked obsolete and **MUST NOT be used under any circumstances**!
- Legacy files are kept for reference - to "remember" old logic and possibly transfer solutions to new code after updating
- Renaming by adding `_legacy` suffix:
  - `UnifiedCommandManager.js` → `UnifiedCommandManager_legacy.js`
  - `UserService.ts` → `UserService_legacy.ts`
- **NEVER import or use legacy files in new code!**
- Legacy files are deleted only by explicit instruction

### Major Refactoring Planning:
1. **Create REFACTOR-ROADMAP.md** with detailed plan:
   ```markdown
   # Refactor Roadmap: [Feature Name]
   
   ## Current State Analysis
   - Code locations to refactor
   - Dependencies mapping
   - Risk assessment
   
   ## Refactoring Steps
   - [ ] Step 1: Implement new solution
   - [ ] Step 2: Replace old code
   - [ ] Step 3: Delete old code immediately
   - [ ] Step 4: Test new implementation
   
   ## Business Logic Documentation
   - Critical business rules that MUST be preserved
   - Edge cases handling
   - Expected behavior descriptions
   ```

2. **Create BUSINESS-LOGIC.md** to preserve critical logic:
   ```markdown
   # Business Logic Documentation
   
   ## Core Rules
   - Rule 1: Description and implementation details
   - Rule 2: Edge cases and expected behavior
   
   ## Test Cases
   - Input/Output examples
   - Edge case scenarios
   ```

### Checkpoints:
- Ensure program starts, then contact user for full testing
- Performance must not degrade
- API compatibility must be maintained
- Documentation updates synchronized with code

---

# Project-Specific Configuration

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

**ES-модули только:**
- Используй только `import/export`, никогда не используй `require()`
- Проект использует `"type": "module"` в package.json
- Все импорты должны быть статическими в начале файла

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