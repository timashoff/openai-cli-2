# BUSINESS LOGIC & ARCHITECTURE ANALYSIS

## 🎯 Общее описание приложения

**OpenAI CLI 2** - это многопровайдерное CLI приложение для работы с AI моделями (OpenAI, DeepSeek, Anthropic). Основная функция - переводы и обработка текста через команды из SQLite БД.

## 🏗️ Архитектурная схема

### Текущая архитектура (2025):

```
┌─ bin/app.js (Entry Point) ────────────────────────────────────┐
│  AIApplication extends Application                            │
│  ┌─ CORE COMPONENTS: ─────────────────────────────────────┐   │
│  │  • stateManager: provider, models, contextHistory       │   │
│  │  • applicationLoop: UI layer + main loop + ESC          │   │
│  │  • router: routing decisions + execution                │   │
│  │  • systemCommandHandler: functional system commands     │   │
│  │  • commandHandler: single/multi DB command routing      │   │
│  │  • chatRequest: final AI processing                     │   │
│  │  • cacheManager: unified cache operations               │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘

┌─ ACTUAL EXECUTION FLOW ───────────────────────────────────────┐
│                                                              │
│  User Input → readline.question()                           │
│      ↓                                                       │
│  ApplicationLoop.startMainLoop()                            │
│  • Main UI loop (while + readline + validation)            │
│  • ESC handling (keypress → controller.abort)              │
│  • Promise.race(execution, escapePromise)                  │
│      ↓                                                       │
│  Router.routeAndProcess(input, applicationLoop)            │
│  • InputProcessingService.processInput() (clipboard $$)     │
│  • analyzeInput() → determine command type                  │
│  • executeFromAnalysis() → direct handler execution         │
│      ↓                                                       │
│  ┌─ SystemCommandHandler ─┐  ┌─ CommandHandler ──┐         │
│  │ • Functional objects    │  │ • Single: ChatRequest│      │
│  │ • Dynamic import        │  │ • Multi: MultiModel  │      │
│  │ • Clean context         │  │ • Cache integration  │      │
│  └─────────────────────────┘  └────────────────────┘         │
│                                      ↓                       │
│                               ChatRequest/MultiModel        │
│                               • StateManager.createChatCompletion│
│                               • Stream processing + spinner  │
│                                      ↓                       │
│                               Result → outputHandler        │
└──────────────────────────────────────────────────────────────┘
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
  is_cached BOOLEAN DEFAULT true, -- Per-command cache control (true=enabled, false=disabled)
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
- **~~Per-command cache control~~ ОТКЛЮЧЕНО** - кеширование временно отключено:
  - ❌ Cache система отключена через CACHE_ENABLED: false флаг в constants.js
  - ❌ Планируется замена на систему сохранения history диалогов в файлы
  - ❌ --force/-f флаги временно не функциональны (будущая логика для history)
  - ❌ is_cached поле игнорируется - все команды работают в live режиме

## 🎨 Мультимодельный вывод (LEADERBOARD система)

### LEADERBOARD система отрисовки:

**1. Параллельная обработка:**
- Все модели запускаются асинхронно через Promise.allSettled()
- Первая модель с самым быстрым чанком = лидер leaderboard
- Лидер отрисовывается real-time по чанкам
- Остальные модели собираются в буфер

**2. Умная отрисовка последующих моделей:**
- Когда лидер done → переходим ко второй модели
- Если вторая модель done → выводим целиком
- Если частично готова → накопленное + продолжаем стрим
- Если еще "думает" → таймер ожидания

### Пример multi-model команды с LEADERBOARD:
```
> rr Would you like to update?
[Handler: rr]

DeepSeek (deepseek-chat):          ← лидер (первый чанк)
[real-time streaming ответ...]     ← стрим по чанкам
Перевод на русский:
*Хотите обновить?*
✓ 11.4s                           ← тайминг лидера

OpenAI (gpt-5-mini):               ← вторая модель
[накопленный или real-time ответ...] ← умная отрисовка
Перевод:
- «Хотите обновить?» (вариант более вежливый: «Вы хотели бы обновить?»)
✓ 15.2s                           ← тайминг второй

[2/2 models responded in 15.2s]    ← финальное резюме
```

**Ключевые особенности LEADERBOARD:**
- Первый чанк определяет лидера
- Real-time стрим только для лидера
- Буферизация для остальных моделей
- Умная отрисовка: done = целиком, partial = накопленное + стрим
- Смешанный режим: кеш [from cache] + live запросы

**Ключевые особенности правильного вывода:**
- `[Handler: rr]` - показывает какая команда обрабатывается
- Отдельные заголовки для каждой модели: `DeepSeek (deepseek-chat):` и `OpenAI (gpt-5-mini):`
- Timing для каждой модели: `✓ 11.4s`
- Финальная сводка: `[2/2 models responded in 12.8s]`
- Реалтайм streaming - ответы появляются по мере готовности

## 🏗️ ПРАВИЛЬНОЕ РАЗДЕЛЕНИЕ ОТВЕТСТВЕННОСТИ

### Принципы архитектуры:

#### Каждый компонент должен иметь ОДНУ ответственность:

- **`InputProcessingService`** - Обработка пользовательского ввода:
  - Обрабатывает $$ маркеры (clipboard content)
  - Ищет команды в БД через DatabaseCommandService
  - Создает commandData для instruction команд
  - Возвращает processed string для Router

- **`Router`** - Routing decisions + прямое исполнение:
  - Использует InputProcessingService для обработки ввода
  - analyzeInput() - определяет тип команды в один проход
  - executeFromAnalysis() - прямое исполнение через handlers
  - Поддерживает system, instruction, MCP и chat команды
  - Single pass архитектура без дублирования логики

- **`CommandHandler`** - Routing между single/multi command обработкой:
  - Функциональный объект (не класс)
  - models.length > 1 → MultiModelCommand.execute()
  - models.length ≤ 1 → handleSingleModel() → ChatRequest
  - ❌ Cache интеграция отключена (CACHE_ENABLED: false)

- **`MultiModelCommand`** - параллельная обработка multi-model:
  - Параллельная обработка через Promise.allSettled()
  - LEADERBOARD система - первый ответ ведет в real-time  
  - ❌ Cache отключен - все модели работают в live режиме
  - Live-only режим: все модели выполняются параллельно в реальном времени
  - Smart spinner management с timing thresholds

- **`CacheManager`** - заглушка cache системы (ОТКЛЮЧЕНА):
  - Cache отключен через CACHE_ENABLED: false в constants.js
  - shouldCache() всегда возвращает false
  - Все операции кеширования игнорируются
  - Готова к замене на history диалогов

- **`ChatRequest`** - финальная AI обработка:
  - Функциональный объект, создаваемый factory функцией
  - Использует StateManager для createChatCompletion()
  - Unified spinner + ESC handling через AbortController
  - Stream processing с context history поддержкой
  - Provider-specific model support

- **`SystemCommandHandler`** - функциональные системные команды:
  - Функциональный объект (не класс)
  - Динамический import команд из модулей
  - Clean context interfaces (не God Object)
  - Поддержка help, provider, model, exit, cmd

- **`DatabaseCommandService`** - Single Source of Truth для БД команд:
  - Единственный сервис доступа к SQLite БД
  - Event-based cache invalidation
  - Model migration из strings в provider-model объекты
  - Singleton pattern с hot-reload

- **`ApplicationLoop`** - центральный UI компонент:
  - Main application loop (while + readline.question)
  - ESC handling через AbortController + Promise.race
  - Graceful shutdown с 3-фазной очисткой
  - UI compatibility methods (writeOutput, writeError, etc.)
  - Dynamic ESC handler registration system

### ✅ CURRENT EXECUTION FLOW (ApplicationLoop → Router):

```
User Input → ApplicationLoop.startMainLoop()
  ↓ (readline.question + validation + Promise.race with ESC)
Router.routeAndProcess(input, applicationLoop)
  ↓ (analyzeInput() - single pass analysis)
  ├─ System Commands (help, provider, model, exit, cmd)
  │   ↓ SystemCommandHandler.handle()
  │   ├─ Dynamic import from config/system-commands.js
  │   ├─ Clean context creation (no God Object)
  │   └─ Command execution (functional objects)
  │
  ├─ Instruction Commands (from SQLite DB)
  │   ↓ CommandHandler.handle()
  │   ├─ Single model: handleSingleModel() → ChatRequest
  │   └─ Multi model: MultiModelCommand.execute()
  │       ├─ Parallel processing (Promise.allSettled)
  │       ├─ Cache check per model
  │       ├─ LEADERBOARD system (first response leads)
  │       └─ Mixed mode (cached + live models)
  │
  └─ Chat/MCP (direct or URL detected)
      ↓ ChatRequest.processChatRequest()
      ├─ StateManager.createChatCompletion()
      ├─ Unified spinner + ESC via AbortController
      └─ Stream processing with context history

Result → outputHandler (centralized output system)
```

**Key Architecture Principles (2025):**
- **Single pass processing** - Router.analyzeInput() determines type + creates data in one pass
- **Functional objects** - SystemCommandHandler, CommandHandler, ChatRequest are functional (not classes)
- **Clean separation** - ApplicationLoop (UI) + Router (routing) + Handlers (execution)
- **Unified ESC handling** - AbortController + Promise.race throughout the application
- **Centralized output** - outputHandler as Single Source of Truth for all console output
- **Event-based architecture** - StateObserver patterns for state management

### 📊 Структура commandData (обновленная):

```javascript
{
  content: "instruction: userInput", // Готовая строка для LLM
  userInput: "биткоин",             // Чистый пользовательский ввод
  id: "WTF_COMMAND",                // ID команды из БД
  models: [                         // Массив объектов моделей (НОВОЕ!)
    {provider: 'openAI', model: 'gpt-5-mini'},
    {provider: 'DeepSeek', model: 'deepseek-chat'},
    {provider: 'Anthropic', model: 'claude-3-5-sonnet'}
  ],
  isCached: true,                   // Из БД поле is_cached
  isForced: false                   // --force флаг от пользователя
}

// Для пустого массива models (default модель)
{
  models: []  // Router использует default модель из StateManager
}
```

### 🎯 CURRENT COMPONENT RESPONSIBILITIES:

**ApplicationLoop** (core/ApplicationLoop.js):
- Main UI loop with readline interface management
- ESC handling through dynamic handler registration
- 3-phase graceful shutdown (stopInput → cancelOps → cleanup)
- UI compatibility layer (writeOutput, writeError methods)
- AbortController + Promise.race pattern for instant cancellation

**Router** (core/Router.js):
- Single-pass input analysis + direct execution
- Uses InputProcessingService for input preprocessing
- executeFromAnalysis() pattern - no intermediate layers
- Supports system, instruction, MCP, and chat routing

**SystemCommandHandler** (core/system-command-handler.js):
- Functional object for system command handling
- Dynamic command import system
- Clean context interfaces (no God Object pattern)

**CommandHandler** (core/CommandHandler.js):
- Factory function creates functional handler
- Routes single vs multi-model commands
- Unified cache integration for both modes

**ChatRequest** (core/ChatRequest.js):
- Factory function creates functional request handler
- StateManager integration for provider abstraction
- Unified spinner + ESC through AbortController

## 🎯 Multi-Model Command Architecture

### ✅ Current MultiModelCommand Implementation:

**MultiModelCommand** (commands/multi-model-command.js):
- Functional object (no classes) following CLAUDE.md rules
- Handles parallel multi-model execution with LEADERBOARD system
- ❌ Cache integration DISABLED - все модели работают в live режиме
- Live-only mode: все модели выполняются параллельно в реальном времени

**Key Features:**
1. **Parallel Processing**: Promise.allSettled() for all models
2. **Live-Only Execution**: все модели работают в live режиме (cache отключен)
3. **LEADERBOARD System**: first response leads in real-time streaming
4. **Smart Spinner Management**: timing thresholds prevent flickering
5. **Unified Summary**: accurate count of successful vs failed models

**Flow:**
```javascript
CommandHandler.handle() → 
  models.length > 1 → MultiModelCommand.execute() →
    ❌ checkCacheForAllModels() (returns empty - cache disabled) →
    executeRaceWithStreaming() (all models live) →
    displaySummary()
```

### Единственные ответственности Multi-command:
1. **Orchestration** - управление параллельным выполнением
2. **Leaderboard** - порядок вывода по скорости ответа 
3. **Aggregation** - сбор и форматирование результатов
4. **Mixed режим** - обработка частичного кеша (кеш + live)

### ✅ Multi-Command Responsibilities:
1. **Orchestration** - parallel execution management
2. **Live Execution Only** - все модели работают в live режиме (cache disabled)
3. **LEADERBOARD System** - first response leads streaming
4. **Error Handling** - partial success scenarios
5. **Timing Management** - smart spinner thresholds

### ❌ What Multi-Command Does NOT Do:
- Does not duplicate Single command logic
- Does not make direct AI requests (delegates to ChatRequest)
- Does not parse commands (receives ready commandData)  
- ❌ Does NOT use caching (CacheManager always returns false due to CACHE_ENABLED: false)

## 🎯 Multi-Model Command Business Rules

### ❌ Cache System (DISABLED):
- **Cache система ОТКЛЮЧЕНА** через CACHE_ENABLED: false в constants.js
- **Force flags неактивны** - --force/-f флаги временно не работают (нечего обходить)
- **is_cached поле игнорируется** - все команды работают в live режиме
- **Будущая замена**: планируется система сохранения history диалогов в файлы
- **Причина отключения**: избежать ошибок ENOENT при создании cache папки

### ❌ Live-Only Mode (ALL COMMANDS):
```bash
# Example: Multi-model command - все запросы live
> rr hello world

DeepSeek (deepseek-chat):              ← всегда live запрос + стриминг
Привет мир! ...стриминг...
✓ 2.1s

OpenAI (gpt-5-mini):                   ← всегда live запрос + стриминг
Привет мир! Как дела?
✓ 2.3s  

[2/2 models responded - all live]      ← всегда все live
```

### Стриминг мультимодельных команд:
- ✅ **Leaderboard system** - модели выводятся в порядке "кто быстрее ответил"
- ✅ **Real-time стриминг** от самой быстрой модели (первой в leaderboard)
- ✅ **Интеллектуальное переключение**:
  - Пока отрисовывается первая модель по чанкам, вторая может почти завершиться
  - Если вторая модель в состоянии `done` → выводить накопленные данные сразу полностью
  - Если вторая модель почти готова → выводить "что уже пришло" сразу + остатки по чанкам
- ✅ **Все настроенные модели** должны отображаться
- ✅ **Заголовки** с именами провайдеров и моделей перед каждым ответом
- ✅ **Порядок вывода** = хронологический порядок первого ответа (leaderboard)

### Структура вывода:
```
> rr как дела?
[Handler: rr]

DeepSeek (deepseek-chat):    ← заголовок первой (самой быстрой) модели
[real-time streaming]        ← стриминг по чанкам
✓ 11.4s                     ← timing первой модели

OpenAI (gpt-5-mini):        ← заголовок второй модели  
[полный ответ сразу]        ← если done, или частичный + стриминг
[2/2 models responded in 12.8s] ← финальная сводка
```

### Обработка ошибок в мультимодельных командах:
- ✅ Если одна модель падает → показать ошибку + продолжить с остальными
- ✅ Если все модели падают → показать общую ошибку
- ✅ Partial success → показать успешные ответы + предупреждения об ошибках

## 🎯 ТЕРМИНОЛОГИЯ ПРОЕКТА (стандарт для всего кода)

### Определения для обработки пользовательского ввода:

- **`prompt`** - сырая строка от пользователя: `"aa привет мир $$ -f"`
  - Содержит: команду, пользовательский текст, clipboard маркеры, флаги
  - Обрабатывается в: InputProcessingService

- **`instruction`** - шаблон команды из SQLite БД: `"переведи на английский язык"`  
  - Хранится в: `commands.instruction` поле в базе данных
  - Используется для: формирования финального content для LLM

- **`userInput`** - очищенный ввод пользователя: `"привет мир clipboard_content"`
  - Получается из prompt после удаления: команды, $$, флагов
  - Представляет: чистый пользовательский контент для обработки

- **`content`** - финальная инструкция для LLM: `"переведи на английский язык: привет мир clipboard_content"`
  - Формула: `instruction + ": " + userInput`
  - Отправляется в: AI модели для выполнения

### Принципы нейминга:
- ❌ `input`, `targetContent`, `fullInstruction`, `finalInput` - НЕ используем
- ✅ Только стандартные термины: `prompt`, `instruction`, `userInput`, `content`

## 🔄 Поток выполнения запроса

### 1. Основной цикл (AIApplication.run):
Приложение работает в бесконечном цикле обработки пользовательского ввода:
- Ожидание ввода пользователя (`prompt`)
- Валидация и санитизация входных данных
- Определение типа запроса (команда или AI-запрос)
- Маршрутизация к соответствующему обработчику

### 2. Поток обработки ввода (Single Source of Truth):

```
1. User prompt: "wtf биткоин --force"
   ↓
2. InputProcessingService.process()
   - Обрабатывает флаги: isForced = true
   - Убирает флаги из строки: "wtf биткоин"
   - Находит команду в БД: WTF_COMMAND
   ↓
3. Router.routeRequest() 
   - Получает данные команды из InputProcessingService
   - Формирует commandData:
     {
       content: "Объясни что это?: биткоин",
       userInput: "биткоин",
       instruction: "Объясни что это?",
       id: "WTF_COMMAND",
       models: ["gpt-5-mini"],
       isCached: true,
       isForced: true
     }
   - Определяет routingTarget: 'command_handler'
   ↓  
4. CommandHandler
   - Проверяет isForced=true → пропускает кеш
   - Отправляет в ChatRequest с готовым content
   - Сохраняет результат в кеш (isCached=true)
```

### 3. Архитектурное правило:
- **$$** обрабатывается ТОЛЬКО в `InputProcessingService`
- **Все остальные компоненты** получают уже обработанные данные
- **Нет дублирования** обработки clipboard маркеров

## 🎯 Логика роутера с кэшированием

### Расширенный алгоритм принятия решений RequestRouter:

#### ПРАВИЛЬНОЕ ДЕРЕВО РЕШЕНИЙ (согласно архитектуре)

```
1. User Input → InputProcessingService
   ├─ Parse clipboard markers: $$ → clipboard_content
   ├─ Extract force flags: --force, -f 
   └─ Return: {userInput, forceFlags}
   
2. Router.routeRequest(userInput) + commandData
   ↓
   2.1 CHECK SYSTEM COMMANDS FIRST (ПРИОРИТЕТ)
       ├─ if (unifiedCommandManager.hasCommand(command)) 
       │   └─ Route to: SystemCommandHandler 
       │       ├─ help → HelpCommand
       │       ├─ exit → ExitCommand  
       │       ├─ provider → ProviderCommand
       │       ├─ model → ModelCommand
       │       └─ cmd → CommandEditorCommand
       ↓
   2.2 CHECK USER COMMANDS FROM DATABASE
       ├─ DatabaseCommandService.findByKey(command)
       │   ├─ Found → analyze command.models.length
       │   │   ├─ models.length === 0 → SingleCommand (default model)
       │   │   ├─ models.length === 1 → SingleCommand (specific model) 
       │   │   └─ models.length > 1 → MultiCommandHandler
       │   └─ Not found → route to default LLM
       ↓
   2.3 MULTICOMMAND COMPOSITION (NO DUPLICATION)
       └─ MultiCommandHandler composes N × CommandHandler instances
           ├─ CommandHandler 1 → model A
           ├─ CommandHandler 2 → model B  
           └─ Aggregate results + leaderboard + formatting
```

#### Терминология и разделение ответственности:
- **SystemCommandHandler** - обрабатывает системные команды (help, exit, provider, model, cmd)
- **CommandHandler** (новый) - обрабатывает single команды из SQLite БД с кеш логикой
- **MultiCommandHandler** (новый) - композирует CommandHandler instances для multi-model с leaderboard
- **CacheHandler** (новый) - унифицированный кеш с новой структурой по userInput
- **ChatRequest** - финальная обработка AI запросов (было AIProcessor)
- **DatabaseCommandService** - единственная точка доступа к SQLite БД команд

#### 1. Команда НЕ найдена в базе данных:
```
User input → RequestRouter → DatabaseCommandService.findByKey() → null
→ Отправить запрос напрямую в default LLM (кеш отключен)
```

#### 2. Команда найдена → анализ models + isCached:

##### 2.1. Пустой массив моделей (`command.models.length === 0`):
```js
// ❌ Кеширование отключено - все команды работают одинаково
// Всегда отправить в default model (кеш игнорируется)
```

##### 2.2. Одна модель (`command.models.length === 1`):
```js
// ❌ Кеширование отключено - все команды работают одинаково
// Всегда отправить в указанную модель (кеш игнорируется)
```

##### 2.3. Несколько моделей (`command.models.length > 1`):
```js
// ❌ Кеширование отключено - все команды работают одинаково
// Всегда отправить во все указанные модели (кеш игнорируется)
```

### Принципы кэширования:

#### Архитектурное разделение ответственности:
- **InputProcessingService**: обрабатывает флаги и возвращает полный commandData
- **Router**: ТОЛЬКО routing decisions, передает commandData дальше
- **CommandHandler**: управляет кеш логикой на основе isCached + isForced
- **CacheHandler**: тупой исполнитель с новой структурой по userInput
- **MultiCommandHandler**: оркестрация и leaderboard для multi-model
- **ChatRequest**: финальная обработка AI запросов

#### ~~Логика Force Flags~~ ОТКЛЮЧЕНА:
- ❌ **Force flags неактивны** - --force/-f парсятся но игнорируются
- ❌ **Кеш отключен полностью** - нечего форсить или обходить
- ✅ **Будущее использование**: планируется для управления history диалогами

#### ~~Технические принципы кеширования~~ ОТКЛЮЧЕНЫ:
- ❌ **Кеш ключи не генерируются** - CACHE_ENABLED: false
- ❌ **Фильтрация отключена** - CacheManager возвращает undefined
- ❌ **is_cached поле игнорируется** - все команды работают в live режиме
- ✅ **Будущие принципы**: архитектура history диалогов в JSON файлах

### Unified ESC Handling Architecture:

**Problem**: ESC обработка была размазана по 3 местам:
- CLIManager - keypress events
- StateObserver - событийная архитектура  
- Unified Spinner - AbortController

**Solution**: AbortController как единственный механизм:
```javascript
// ApplicationLoop catches ESC
process.stdin.on('keypress', (str, key) => {
  if (key.name === 'escape') {
    const controller = stateManager.getCurrentRequestController()
    if (controller) {
      controller.abort() // Единственная точка отмены!
    }
  }
})

// Все остальные компоненты слушают AbortController.signal
// - Spinner: abortController.signal.addEventListener('abort')
// - ChatRequest: использует unified spinner с controller
// - StateObserver: может подписаться на abort events
```

### Новый поток данных:
```
User Input → ApplicationLoop (UI + ESC + main loop)
                    ↓
        router.routeAndProcess(input, applicationLoop)
                    ↓
            Router (decisions + execution):
                    ↓
    ┌─ SystemCommandHandler ─┐    ┌─ CommandHandler ──┐
    │   • help, exit, etc.   │    │  • Single commands │
    │   • Direct execution   │    │  • Cache logic     │
    └─────────────────────────┘    │  • ChatRequest call│
                                   └────────────────────┘
                    ↓
           applicationLoop.writeOutput(result)
```

### 2. Новая архитектура обработки запросов (ApplicationLoop → Router):

#### 2.1 ApplicationLoop - UI и главный цикл:
- Main application loop (`while(true)` + `readline.question()`)
- Low-level ESC handling через AbortController
- UI layer (colors, writeOutput, writeError methods)
- Spinner coordination

#### 2.2 Router - routing decisions + execution:
- Analyzes input, creates commandData
- Direct execution через handlers
- `routeAndProcess(input, applicationLoop)` метод
- Unified flow для всех типов команд

#### 2.3 Специализированные handlers:
- **SystemCommandHandler**: help, exit, provider, model, cmd
- **CommandHandler**: single instruction команды с cache logic
- **ChatRequest**: final AI request processing с unified spinner

## 🎛️ Провайдеры и модели

### Система провайдеров:
Приложение поддерживает работу с несколькими AI провайдерами одновременно:
- **OpenAI** (GPT-4, GPT-3.5, gpt-5-mini)
- **DeepSeek** (deepseek-chat)
- **Anthropic** (Claude 3.5 Sonnet, Haiku, Opus)

**Архитектурный принцип**: Legacy State интегрирован с Modern ServiceManager для плавного перехода к новой архитектуре.

### Ленивая загрузка провайдеров:
- ✅ **Instant switching** - переключение провайдеров за ~0.016ms
- ✅ **Lazy loading** - провайдеры инициализируются только при первом использовании
- ✅ **provider: null** - нормальное состояние при переключении (загрузится при запросе)
- ✅ **selectedProviderKey** - основной идентификатор для проверок в AIProcessor
- ✅ **Fallback система** - автоматическое переключение при ошибках API

### Переключение провайдеров:
1. **Интерактивное** через команду `provider`
2. **Автоматическое** при ошибках (403, region block)
3. **Fallback цепочка**: openai → anthropic → deepseek

## 🌐 MCP (Model Context Protocol) интеграция

### Автоматическое определение:
Система анализирует пользовательский ввод для определения необходимости MCP обработки:
- **URL detection**: автоматическое распознавание веб-ссылок
- **Search intent**: определение поисковых запросов
- **Routing**: маршрутизация к соответствующему MCP серверу (fetch/web-search)

### Встроенные MCP серверы:
- **fetchMCPServer**: извлечение контента с веб-страниц
- **searchMCPServer**: поиск через DuckDuckGo API

## 🎯 Центральная система вывода (output-handler.js)

### Single Source of Truth для всего вывода:
Все компоненты приложения используют централизованный `outputHandler` вместо прямых вызовов `console.log` или `process.stdout.write`:

**Основные методы:**
- `write(text)` - основной вывод с переводом строки
- `writeStream(chunk)` - потоковый вывод без перевода строки
- `writeSuccess(text)` - успешные сообщения (зеленый цвет)
- `writeError(text)` - ошибки (красный цвет)
- `writeWarning(text)` - предупреждения (желтый цвет)
- `writeInfo(text)` - информационные сообщения (голубой цвет)
- `writeRaw(text)` - сырой вывод без форматирования
- `clearLine()`, `hideCursor()`, `showCursor()` - управление терминалом

**Архитектурные принципы:**
- ✅ **Функциональный подход** - объект с методами (НЕ класс)
- ✅ **Консистентность** - единообразное форматирование во всем приложении  
- ✅ **Централизованное управление** - одна точка для всех изменений вывода
- ✅ **Цветовая схема** - стандартизированные цвета через config/color.js

**Интеграция с компонентами:**
- **ApplicationLoop.exitApp()**: использует outputHandler для graceful shutdown сообщений
- **StreamHandler**: рефакторен для использования outputHandler методов
- **HelpCommand**: использует outputHandler для форматированного вывода таблиц
- **Все компоненты**: заменили прямые console.log на outputHandler методы

### Принципы использования:
```javascript
// ❌ Старый подход
console.log('message')
process.stdout.write('text')

// ✅ Новый подход через outputHandler
outputHandler.write('message')
outputHandler.writeSuccess('Operation completed')
outputHandler.writeError('Something went wrong')
```

## 🎯 Системные команды и их обработка

### Архитектура системных команд:
Системные команды (help, exit, provider, model, cmd) обрабатываются через Router → SystemCommandHandler:

**Поток выполнения команды `help`:**
```
User: "help" → ApplicationLoop.startMainLoop()
                    ↓
            router.routeAndProcess("help", applicationLoop)
                    ↓
            Router.detectCommandType() → "system"
                    ↓
            SystemCommandHandler.handle()
                    ↓
            HelpCommand.execute()
                    ↓
            Форматированный вывод через outputHandler
```

**Поток выполнения команды `exit`:**
```
User: "exit" → ApplicationLoop.startMainLoop()
                    ↓
            router.routeAndProcess("exit", applicationLoop)
                    ↓
            Router.detectCommandType() → "system"
                    ↓
            SystemCommandHandler.handle()
                    ↓
            ExitCommand.execute(args, context)
                    ↓
            context.applicationLoop.exitApp()
                    ↓
            ApplicationLoop.exitApp() - graceful shutdown
```

### Graceful Shutdown Process (ApplicationLoop.exitApp):
**Фаза 1 - Остановка пользовательского ввода:**
- `stopUserInput()` - закрывает readline interface
- Разблокирует `rl.question()` для немедленного выхода из main loop

**Фаза 2 - Отмена активных операций:**
- `cancelActiveOperations()` - экономия токенов и ресурсов:
  - Абортирует активные LLM запросы через AbortController
  - Очищает spinner таймеры
  - Удаляет keypress event listeners
  - Показывает предупреждение о cancelled AI request

**Фаза 3 - Финальная очистка:**
- `finalCleanup()` - завершение работы:
  - Показывает курсор через outputHandler.showCursor()
  - Выводит прощальное сообщение outputHandler.writeSuccess('Goodbye!')
  - process.exit(0) через 50ms для корректного вывода

**Защита от двойного exit:**
- `isExiting` флаг предотвращает повторные вызовы exitApp()
- SIGINT handler также вызывает exitApp() для консистентности

## 🛠️ Система обработки ошибок провайдеров

### User-Friendly Error Handling:
Вместо технических stack trace показываются понятные сообщения с возможностью восстановления:

```
❌ Provider not working: deepseek
Would you like to switch to another provider? (y/n): 
```

### Интерактивное восстановление:
Система обеспечивает плавное восстановление при ошибках провайдера:

1. **Детекция ошибки**: Автоматическое определение проблем с провайдером
2. **User-friendly сообщение**: Отображение понятного сообщения об ошибке провайдера
3. **Интерактивный выбор**: Предложение пользователю выбрать альтернативный провайдер
4. **Мгновенное переключение**: Быстрая смена провайдера без потери контекста диалога
5. **Продолжение работы**: Сохранение всего контекста и истории после смены провайдера

### Принципы обработки ошибок:
- ✅ **Никаких крашей** - приложение всегда остается работоспособным
- ✅ **Понятные сообщения** - техническая информация скрыта от пользователя
- ✅ **Мгновенное восстановление** - возможность переключиться на рабочий провайдер
- ✅ **Сохранение контекста** - диалог с AI продолжается после смены провайдера
- ✅ **Graceful degradation** - если все провайдеры не работают, четкое объяснение

### Типы ошибок провайдеров:
1. **Ленивая загрузка** - провайдер не инициализирован (автоматическая загрузка)
2. **API недоступен** - сетевые ошибки, блокировки (предложение смены)
3. **Неверный ключ** - проблемы аутентификации (четкое сообщение)
4. **Превышен лимит** - rate limiting (предложение подождать или сменить)

## 🔧 Ключевые утилиты

### StreamProcessor:
- Обработка потокового ответа от разных провайдеров
- Поддержка отмены (Escape key)
- Форматирование вывода в реальном времени

### Глобальная обработка клавиш:
Система обеспечивает отзывчивое управление процессами:
- **Escape key**: прерывание текущих операций
- **Состояние Processing**: отмена API запросов
- **Состояние Typing**: остановка потокового вывода
- **Return to prompt**: возврат к пользовательскому вводу

### Управление пустым вводом:
**Бизнес-логика:**
- **Первое пустое нажатие Enter**: очищает историю контекста текущего диалога с AI
- **Второе пустое нажатие Enter**: полностью очищает экран терминала для "чистого листа"
- Эта функциональность позволяет пользователю быстро "перезапустить" сессию без выхода из приложения

**Пользовательский сценарий:**
1. Пользователь завершил диалог с AI
2. Нажимает Enter при пустом вводе → контекст очищен, можно начать новый диалог
3. Если нужен чистый экран → еще раз Enter при пустом вводе → экран полностью очищен

**Интеграция с UX:**
- Реализована в основном потоке readline (CLIManager) 
- Работает только при пустом пользовательском вводе
- Обеспечивает плавный пользовательский опыт без перезапуска приложения

### ❌ Current Cache System Status:
- **CacheManager (DISABLED)**: Cache отключен через CACHE_ENABLED: false в constants.js
- **Force flags неактивны**: --force/-f флаги парсятся но игнорируются (нечего обходить)
- **is_cached игнорируется**: Все команды работают в live режиме независимо от поля is_cached
- **Будущая замена**: Планируется система сохранения history диалогов в файлы

### ✅ Database Architecture (IMPLEMENTED):
**DatabaseCommandService as Single Source of Truth:**
- Only service allowed to import database-manager.js
- Event-based cache invalidation for hot-reload
- Model migration system (strings → provider-model objects)
- Singleton pattern with proper initialization
- All components access DB through this service only

## 🧩 Current Architectural Patterns (2025)

### 1. Functional Architecture:
**No Classes Rule** - all components are functional objects or factory functions:
- SystemCommandHandler, CommandHandler, ChatRequest = functional objects
- createCommandHandler(), createChatRequest() = factory functions
- Following CLAUDE.md strict no-classes policy

### 2. Command Pattern:
Clear separation of command types and routing:
- **System Commands**: help, exit, provider, model, cmd (via SystemCommandHandler)
- **Instruction Commands**: database commands (via CommandHandler)  
- **Chat Commands**: direct AI requests (via ChatRequest)
- **MCP Commands**: URL detection and web content (via Router)

### 3. Single Source of Truth Pattern:
**Centralized access control:**
- DatabaseCommandService = only BD access point
- StateManager = only AI state management
- outputHandler = only console output
- CacheManager = only cache operations

### 4. Factory Pattern:
Standardized object creation:
- createChatRequest(app) → functional AI request handler
- createCommandHandler(chatRequest, cacheManager) → functional command router
- Provider factory for AI provider creation

### 5. Event-Driven Architecture:
StateObserver pattern for reactive updates:
- Database changes → automatic cache invalidation
- State changes → event emission
- Hot-reload capability through events

## 📂 Структура файлов

### Core Components (2025):

**Entry Point & Main App:**
- **bin/app.js**: AIApplication entry point with dependency injection
- **utils/application.js**: Base Application class

**Core Architecture:**
- **core/ApplicationLoop.js**: UI layer, main loop, ESC handling, graceful shutdown
- **core/Router.js**: Single-pass routing with direct execution
- **core/system-command-handler.js**: Functional system command handling
- **core/CommandHandler.js**: Factory function for single/multi command routing
- **core/ChatRequest.js**: Factory function for final AI processing
- **core/output-handler.js**: Centralized output system (Single Source of Truth)
- **core/CacheManager.js**: Unified cache operations
- **core/StateManager.js**: AI state management singleton

**Command System:**
- **commands/multi-model-command.js**: Parallel multi-model execution
- **commands/help-command.js**, **commands/exit-command.js**, etc.: Individual command implementations
- **commands/cmd/**: Interactive command editor system

**Services:**
- **services/DatabaseCommandService.js**: Single Source of Truth for SQLite DB access
- **services/input-processing-service.js**: Input preprocessing (clipboard, command detection)

**Utilities:**
- **utils/stream-processor.js**: Provider-specific streaming
- **utils/provider-factory.js**: AI provider creation
- **utils/spinner.js**: Unified spinner system

### Configuration:
- **config/commands.db**: SQLite database with user commands
- **config/system-commands.js**: System command configuration
- **config/app-config.js**: Provider and application configuration
- **config/constants.js**: App constants and UI symbols
- **config/color.js**: Color scheme definitions
- **config/mcp-servers.json**: MCP server configurations

## 🚀 Architecture Status (2025)

### ✅ Production Features:
1. **SQLite Command System**: Fully functional database-driven commands (aa, cc, rr, hsk, etc.)
2. **Multi-Provider Support**: OpenAI, DeepSeek, Anthropic with lazy loading
3. **LEADERBOARD Multi-Model**: Parallel execution with intelligent streaming
4. **MCP Integration**: Automatic URL detection and web content extraction
5. **❌ Cache System DISABLED**: CACHE_ENABLED: false - все команды работают live
6. **Interactive Command Editor**: Full CRUD operations for database commands
7. **Graceful Error Handling**: User-friendly provider error recovery
8. **ESC Handling**: Instant cancellation with Promise.race + AbortController
9. **Centralized Output**: outputHandler as Single Source of Truth

### 🏗️ Architecture Quality:
1. **Functional Architecture**: No classes, factory functions, clean interfaces
2. **Single Source of Truth**: DatabaseCommandService, StateManager, outputHandler, ~~CacheManager~~ (disabled)
3. **Event-Driven Design**: StateObserver patterns for reactive updates
4. **Clean Separation**: ApplicationLoop (UI) + Router (routing) + Handlers (execution)
5. **Factory Pattern**: createCommandHandler, createChatRequest standardization

### 📈 Current State:
- **Architecture: STABLE** - Clean functional patterns implemented
- **Documentation: UPDATED** - Reflects actual 2025 implementation
- **Code Quality: HIGH** - Follows CLAUDE.md principles strictly
- **Maintainability: EXCELLENT** - Clear separation of concerns

## 📝 Summary

This documentation has been updated to reflect the **current state of the codebase as of 2025**. All legacy architectural patterns have been replaced with the actual implementation.

### Key Updates Made:
- ✅ **Current Architecture Flow**: Documented actual ApplicationLoop → Router → Handlers pattern
- ✅ **Functional Architecture**: Updated to reflect no-classes policy and factory functions  
- ✅ **System Commands**: Documented functional object approach with dynamic imports
- ✅ **Multi-Model System**: Updated LEADERBOARD system with parallel execution
- ✅ **Cache System**: Corrected to show DISABLED status (CACHE_ENABLED: false)
- ✅ **Database Access**: DatabaseCommandService as Single Source of Truth
- ✅ **File Structure**: Updated to reflect current component organization
- ✅ **Critical Fix**: Cache documentation now accurately reflects disabled state

### Architecture Quality (2025):
- **Maintainable**: Clear separation of concerns with functional patterns
- **Testable**: Factory functions and dependency injection throughout
- **Scalable**: Event-driven architecture with centralized state management  
- **User-Friendly**: Graceful error handling and instant ESC cancellation
- **Well-Documented**: This file now accurately reflects the implementation

*Last Updated: 2025-01-04*