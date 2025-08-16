# BUSINESS LOGIC & ARCHITECTURE ANALYSIS

## 🎯 Общее описание приложения

**OpenAI CLI 2** - это многопровайдерное CLI приложение для работы с AI моделями (OpenAI, DeepSeek, Anthropic). Основная функция - переводы и обработка текста через команды из SQLite БД.

## 🏗️ Архитектурная схема

```
┌─ bin/app.js (1660 строк) ─────────────────────────────────────┐
│  AIApplication extends Application                            │
│  ┌─ ОСНОВНЫЕ КОМПОНЕНТЫ: ─────────────────────────────────┐   │
│  │  • aiState: provider, models, model, selectedProviderKey │   │
│  │  • commandEditor: CommandEditor для управления командами │   │
│  │  • serviceManager: современная архитектура сервисов      │   │
│  │  • simpleCommandHandler: обработка простых команд        │   │
│  │  • Handlers Chain (DISABLED) - новая архитектура        │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘

┌─ LEGACY COMMAND SYSTEM ──────────┐    ┌─ MODERN ARCHITECTURE ─────────┐
│  config/instructions.js          │    │  services/                    │
│  ↓ migration.js                  │    │  ├─ service-manager.js         │
│  ↓ database-manager.js           │    │  ├─ ai-provider-service.js     │
│  ↓ SQLite БД                     │    │  ├─ command-processing-service │
│  ↓ commands.db                   │    │  └─ input-processing-service   │
│  ↓ getInstructionsFromDatabase() │    └───────────────────────────────┘
└───────────────────────────────────┘
```

## 📊 Система команд (SQLite-based)

### Структура команд в БД:
```sql
CREATE TABLE commands (
  id TEXT PRIMARY KEY,           -- ENGLISH, RUSSIAN, HSK, etc.
  key TEXT NOT NULL,            -- JSON array: ["aa", "аа"]
  description TEXT NOT NULL,    -- "translate into English"
  instruction TEXT NOT NULL,    -- "please provide multiple English..."
  models TEXT DEFAULT NULL,     -- JSON array опциональных моделей
  created_at INTEGER,
  updated_at INTEGER
)
```

### Ключевые команды:
- **aa/аа** → ENGLISH: множественные варианты перевода на английский
- **cc/сс** → CHINESE: перевод на китайский
- **rr** → RUSSIAN: перевод на русский
- **hsk** → HSK: перевод на Eng+Ru+Pinyin для изучения китайского
- **hskss** → HSK_SS: создание предложений на китайском + перевод
- **gg** → GRAMMAR: проверка грамматики
- **pp/пп** → PINYIN: транскрипция пиньинь
- **tr** → TRANSCRIPTION: английская транскрипция

### Управление командами:
- **cmd/кмд** → CommandEditor меню для добавления/редактирования команд
- Команды хранятся в `/config/commands.db` (SQLite)
- Миграция из `config/instructions.js` при первом запуске

## 🔄 Поток выполнения запроса

### 1. Основной цикл (AIApplication.run):
```javascript
while (true) {
  userInput = await rl.question('> ')
  
  // Валидация и санитизация
  userInput = sanitizeString(userInput)
  validateString(userInput)
  
  // Обработка команд vs AI запросов
  if (isCommand) {
    await executeCommand()
  } else {
    await processAIInput(userInput)
  }
}
```

### 2. Обработка AI запросов (processAIInput):

#### 2.1 Обработка буфера обмена:
```javascript
if (input.includes('$$')) {
  const buffer = await getClipboardContent()
  input = input.replace(/\$\$/g, buffer)
}
```

#### 2.2 Обработка force flags:
```javascript
const forceFlags = ['--force', '-f']
for (flag of forceFlags) {
  if (input.endsWith(flag)) {
    forceRequest = true
    input = input.replace(flag, '').trim()
  }
}
```

#### 2.3 Поиск команды в БД:
```javascript
const command = this.findCommand(input) // → getInstructionsFromDatabase()
```

#### 2.4 MCP обработка (если есть URL):
```javascript
if (command?.hasUrl || needsMCP) {
  const mcpResult = await this.processMCPInput(input, command)
  // Извлечение контента с веб-страниц
  // Поиск в интернете
}
```

#### 2.5 Кэш проверка:
```javascript
// Multi-provider commands
if (command.isMultiProvider && cache.hasMultipleResponses(cacheKey)) {
  return cached
}

// Translation commands  
if (command.isTranslation && cache.has(cacheKey)) {
  return cached
}
```

#### 2.6 Выполнение запроса:
```javascript
// Multi-model processing (новая архитектура)
if (command.models?.length > 1) {
  await multiCommandProcessor.executeMultiple()
}

// Single provider
const stream = await provider.createChatCompletion(model, messages)
const response = await streamProcessor.processStream(stream)
```

## 🎛️ Провайдеры и модели

### Система провайдеров:
```javascript
// Legacy (переходит на новую архитектуру)
aiState = {
  provider: provider_instance,
  models: ['gpt-4', 'gpt-3.5-turbo'],
  model: 'gpt-4',
  selectedProviderKey: 'openai'
}

// Modern (ServiceManager)
serviceManager.getAIProviderService()
  .switchProvider(providerKey)
  .getCurrentProvider()
```

### Переключение провайдеров:
1. **Интерактивное** через команду `provider`
2. **Автоматическое** при ошибках (403, region block)
3. **Fallback цепочка**: openai → anthropic → deepseek

## 🌐 MCP (Model Context Protocol) интеграция

### Автоматическое определение:
```javascript
// Intent detection для URL и поисковых запросов
if (intentDetector.requiresMCP(input)) {
  const routing = intentDetector.getMCPRouting()
  // routing.server: 'fetch' | 'web-search'
  // routing.tool: 'fetch_url' | 'search'
}
```

### Встроенные MCP серверы:
- **fetchMCPServer**: извлечение контента с веб-страниц
- **searchMCPServer**: поиск через DuckDuckGo API

## 🔧 Ключевые утилиты

### StreamProcessor:
- Обработка потокового ответа от разных провайдеров
- Поддержка отмены (Escape key)
- Форматирование вывода в реальном времени

### Глобальная обработка клавиш:
```javascript
// bin/app.js:191-224
process.stdin.on('keypress', (str, key) => {
  if (key.name === 'escape') {
    if (isProcessingRequest) {
      currentRequestController.abort()
    } else if (isTypingResponse) {
      shouldReturnToPrompt = true
    }
  }
})
```

### Система кэширования:
- **Переводы**: по ключу запроса
- **Multi-provider**: множественные ответы
- **Документы**: сохранение в файлы
- **TTL caching** с автоочисткой

## 🧩 Архитектурные паттерны

### 1. Dual Architecture (Legacy + Modern):
```javascript
// Legacy: прямые вызовы aiState
this.aiState.provider.createChatCompletion()

// Modern: через ServiceManager
this.serviceManager.getAIProviderService().createChatCompletion()
```

### 2. Command Pattern:
```javascript
// Core commands (help, exit)
this.commands = new CommandManager()

// AI commands (provider, model)  
this.aiCommands = new CommandManager()

// Instruction commands (aa, cc, rr) from SQLite
const command = this.findCommand(input)
```

### 3. Factory Pattern:
```javascript
// utils/provider-factory.js
const provider = createProvider(providerKey, config)
```

### 4. Chain of Responsibility (DISABLED):
```javascript
// handlers/handler-chain-factory.js
// Современная архитектура с обработчиками
// ОТКЛЮЧЕНА для изучения текущей архитектуры
```

## 📂 Структура файлов

### Основные компоненты:
```
bin/app.js                 # Главное приложение (1660 строк)
utils/application.js       # Базовый класс Application
utils/command-manager.js   # Система команд
utils/provider-factory.js  # Создание провайдеров
utils/stream-processor.js  # Обработка потоков
utils/database-manager.js  # SQLite БД для команд
utils/migration.js         # Миграция команд в БД
utils/command-editor.js    # Редактор команд через SQLite
services/service-manager.js # Современная архитектура
config/instructions.js     # Legacy команды (мигрируются в БД)
config/api_providers.js    # Конфигурация провайдеров
```

### Конфигурация:
```
config/commands.db         # SQLite БД с командами
config/mcp-servers.json    # MCP серверы
config/default_models.js   # Предпочтительные модели
config/constants.js        # Константы приложения
```

## 🚀 Состояние архитектуры

### ✅ Что работает:
1. **SQLite команды**: aa, cc, rr, hsk полностью из БД
2. **Multi-provider поддержка**: OpenAI, DeepSeek, Anthropic
3. **MCP интеграция**: автоматическое извлечение веб-контента
4. **Streaming**: потоковый вывод с возможностью отмены
5. **Кэширование**: переводы и множественные ответы
6. **CommandEditor**: полнофункциональное управление командами

### 🔄 Переходное состояние:
1. **Dual architecture**: Legacy + Modern сервисы работают параллельно
2. **Handler Chain**: подготовлен, но отключен
3. **ServiceManager**: частично интегрирован

### 🎯 Готовность к рефакторингу:
- **Фаза 1 завершена**: мертвый код удален, тесты организованы
- **Фаза 2 готова**: архитектура изучена, точки декомпозиции определены
- **Core понимание**: бизнес-логика задокументирована

## 🔍 Ключевые точки для Фазы 2

### Файлы для декомпозиции:
1. **bin/app.js:549-1129** → `processAIInput` (580 строк)
2. **bin/app.js:44-85** → `AIApplication constructor` 
3. **bin/app.js:246-327** → `registerAICommands`
4. **bin/app.js:1541-1641** → `main run loop`

### Кандидаты на выделение:
- `core/StateManager.js` ← aiState + contextHistory
- `core/CLIInterface.js` ← readline, terminal, keypress  
- `core/RequestRouter.js` ← processAIInput логика
- `commands/CommandExecutor.js` ← command execution logic

Архитектура хорошо подготовлена для рефакторинга благодаря четкому разделению ответственности и наличию современных сервисов.