# BUSINESS LOGIC & ARCHITECTURE ANALYSIS

## 🎯 Общее описание приложения

**OpenAI CLI 2** - это многопровайдерное CLI приложение для работы с AI моделями (OpenAI, DeepSeek, Anthropic). Основная функция - переводы и обработка текста через команды из SQLite БД.

## 🏗️ Архитектурная схема

```
┌─ bin/app.js (Simple Bootstrapper) ────────────────────────────┐
│  AIApplication extends Application                            │
│  ┌─ ОСНОВНЫЕ КОМПОНЕНТЫ: ─────────────────────────────────┐   │
│  │  • stateManager: provider, models, contextHistory       │   │
│  │  • serviceManager: современная архитектура сервисов     │   │
│  │  • applicationLoop: UI layer + main loop + ESC          │   │
│  │  • router: routing decisions + execution                │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘

┌─ CLEAN ARCHITECTURE FLOW ────────────────────────────────────┐
│                                                              │
│  User Input                                                  │
│      ↓                                                       │
│  ApplicationLoop (core/ApplicationLoop.js)                  │
│  • Main loop (while + readline.question)                    │
│  • ESC handling (keypress → AbortController.abort)          │
│  • UI methods (writeOutput, colors, spinner coordination)   │
│      ↓                                                       │
│  Router (core/Router.js)                                    │
│  • router.routeAndProcess(input, applicationLoop)           │
│  • Decision making + direct execution                       │
│  • switch(commandType) → Handler.handle()                   │
│      ↓                                                       │
│  ┌─ SystemCommandHandler ─┐  ┌─ CommandHandler ──┐         │
│  │ • help, exit, provider │  │ • Single commands  │         │
│  │ • model, cmd commands  │  │ • Cache logic      │         │
│  └─────────────────────────┘  │ • ChatRequest call │         │
│                               └────────────────────┘         │
│                                      ↓                       │
│                               ChatRequest                    │
│                               • Final AI requests           │
│                               • Unified spinner + ESC       │
│                                      ↓                       │
│                               Result → ApplicationLoop      │
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
- **Per-command cache control** - индивидуальное управление кешированием через CommandEditor:
  - Cache enabled/disabled опция в field selection menu
  - Команды по умолчанию создаются с включенным кешем
  - Возможность включить/отключить кеш для любой команды (не только переводов)

## 🎨 Мультимодельный вывод (правильный формат)

### Команды с несколькими моделями (например, `rr` с 2 моделями):
```
> rr Would you like to update?
[Handler: rr]

DeepSeek (deepseek-chat):
Перевод на русский:
*Хотите обновить?*

Идиоматические выражения / устойчивые словосочетания:
1. "Would you like to..." – вежливая форма предложения или вопроса (*хотели бы вы...*).
   - Транскрипция: /wʊd ju laɪk tu/
   - Аналог в русском: *"Не хотите ли...?"*, *"Вам не хочется...?"* (менее буквальный, но естественный вариант).

*(Текст короткий, поэтому выделено только основное выражение.)*
✓ 11.4s

OpenAI (gpt-5-mini):
Перевод:
- «Хотите обновить?» (вариант более вежливый: «Вы хотели бы обновить?»)

Идиоматическое выражение:
- "Would you like to..." — устойчивое вежливое оборотное выражение для предложения или приглашения что‑либо сделать/получить. Перевод: «Хотите...», «Вы хотели бы...».
  Транскрипция (разговорная/свободная): /wʊd jə laɪk tə/
  Транскрипция (чистая форма): /wʊd juː laɪk tuː/

Отдельно слово:
- "update" — глагол «обновить».
  Транскрипция: /ʌpˈdeɪt/

[2/2 models responded in 12.8s]
```

**Ключевые особенности правильного вывода:**
- `[Handler: rr]` - показывает какая команда обрабатывается
- Отдельные заголовки для каждой модели: `DeepSeek (deepseek-chat):` и `OpenAI (gpt-5-mini):`
- Timing для каждой модели: `✓ 11.4s`
- Финальная сводка: `[2/2 models responded in 12.8s]`
- Реалтайм streaming - ответы появляются по мере готовности

## 🏗️ ПРАВИЛЬНОЕ РАЗДЕЛЕНИЕ ОТВЕТСТВЕННОСТИ

### Принципы архитектуры:

#### Каждый компонент должен иметь ОДНУ ответственность:

- **`InputProcessingService`** - Single Source of Truth для обработки ввода:
  - Парсит пользовательский ввод и обрабатывает флаги
  - Ищет команды в SQLite БД через DatabaseCommandService
  - Возвращает стандартизированный объект commandData
  - НЕ занимается кешированием, стримингом, AI запросами

- **`Router`** (было RequestRouter) - ТОЛЬКО routing decisions:
  - Определяет тип команды и routing target
  - Передает полный commandData объект со всеми данными
  - Возвращает: `{success, routingTarget, commandData}`
  - НЕ выполняет бизнес-логику, только принимает решения

- **`CommandHandler`** (новый) - обработка single команд:
  - Получает commandData от Router
  - Управляет кеш логикой (проверка isCached && isForced)
  - Делегирует в CacheHandler или ChatRequest
  - Сохраняет результаты в кеш если isCached=true

- **`MultiCommandHandler`** (новый) - оркестрация multi-model:
  - Композиция через CommandHandler instances
  - LEADERBOARD система - вывод по скорости ответа
  - Mixed режим (кеш + live запросы)
  - Агрегация и форматирование результатов

- **`CacheHandler`** (было CacheManager) - унифицированный кеш:
  - НОВАЯ структура: ключ по userInput
  - Фильтрация по commandId + model + provider
  - Техническое выполнение операций: get/store
  - НЕ принимает решения, получает готовые инструкции

- **`ChatRequest`** (было AIProcessor) - ТОЛЬКО финальные AI запросы:
  - Получает: `content` (готовая LLM инструкция) + `model`
  - Управляет стримингом и AbortController
  - Возвращает: ответ от AI
  - НЕ парсит команды, НЕ управляет кешем

- **`StreamHandler`** - стриминг и форматирование:
  - Получает готовые данные для стриминга
  - Форматирует вывод пользователю
  - НЕ принимает решения о логике

### ❌ АРХИТЕКТУРНЫЕ НАРУШЕНИЯ (которые исправляем):

#### AIProcessor делал ВСЕ (монолит):
- ❌ Парсил команды (должен CommandProcessingService)
- ❌ Принимал решения о кеше (должен CacheManager)
- ❌ Форматировал вывод (должен StreamHandler)
- ❌ Создавал команды (дублирование с CommandProcessingService)
- ❌ Observer метрики (не его ответственность)

#### Дублирование логики:
- ❌ 3 места создания команд: CommandProcessingService, RequestRouter, AIProcessor
- ❌ Обработка $$ в 3 местах вместо одного InputProcessingService
- ❌ Проверки force flags в нескольких местах (должно быть только в InputProcessingService)
- ❌ Проверки типа команд в cache handlers (должно быть только в RequestRouter)

#### Антипаттерны кеширования:
- ❌ **"Умные" проверки в CacheManager**: `const isMultiModel = command?.models && Array.isArray(command.models)`
- ❌ **Дублирование логики force flags**: каждый компонент сам проверяет `--force`
- ❌ **Принятие решений в handlers**: cache/stream handlers не должны решать, что делать
- ❌ **Сложные объекты возвратов**: `{shouldUse, shouldStore, reason}` вместо простого boolean

### ✅ ПРАВИЛЬНАЯ АРХИТЕКТУРА (ApplicationLoop → Router):

```
User Input → ApplicationLoop.startMainLoop()
                    ↓
        router.routeAndProcess(input, applicationLoop)
                    ↓
            Router internal logic:
                    ↓
     ┌─ SYSTEM commands → SystemCommandHandler
     │   ├─ help → HelpCommand
     │   ├─ exit → ExitCommand.execute() → applicationLoop.exitApp()
     │   ├─ provider → ProviderCommand
     │   ├─ model → ModelCommand
     │   └─ cmd → CommandEditorCommand
     │
     ├─ INSTRUCTION commands → CommandHandler
     │   ├─ Create commandData from DatabaseCommandService
     │   ├─ Check cache: isCached && !isForced
     │   ├─ Cache hit → return cached result
     │   ├─ Cache miss → ChatRequest with prepared content
     │   └─ Store result if isCached=true
     │
     └─ CHAT (not found) → ChatRequest (direct)
         └─ commandData: {content: input, isForced: false}

           ↓ (all paths)
    outputHandler methods (writeOutput, writeError, etc.)
```

**Key changes:**
- **No RequestProcessor/CommandDispatcher** - YAGNI principle
- **Router handles both decisions AND execution** - Single responsibility
- **ApplicationLoop focuses on UI concerns** - Clean separation
- **Unified ESC handling** through AbortController everywhere

### 📊 Структура commandData (стандартизированный объект):

```javascript
{
  success: true/false,              // Команда найдена и валидна
  content: "instruction: userInput", // Готовая строка для LLM
  userInput: "биткоин",             // Чистый пользовательский ввод
  instruction: "Объясни что это?",  // Из БД instruction field
  id: "WTF_COMMAND",                // ID команды из БД
  models: ["gpt-5-mini"],           // Массив моделей из БД или default
  isCached: true,                   // Из БД поле is_cached
  isForced: false                   // --force флаг от пользователя
}
```

### 🎯 НОВАЯ АРХИТЕКТУРА: ApplicationLoop → Router

#### Clean Flow (без лишних слоев):
```
User Input 
  ↓
ApplicationLoop.startMainLoop() 
  ↓  
router.routeAndProcess(input, applicationLoop)
  ↓
Router.routeAndProcess() internal:
  - detectCommandType(input)
  - createCommandData(input) 
  - switch(commandType) → Handler.handle(commandData, applicationLoop)
  ↓
Result → applicationLoop.writeOutput()
```

#### Разделение ответственности:

**ApplicationLoop** (implements core/ApplicationLoop.js):
- Main application loop (`while(true)` + `readline.question()`)
- ESC handling through AbortController (handleEscapeKey → controller.abort())
- Graceful shutdown with 3-phase exitApp() method:
  - Phase 1: stopUserInput() - closes readline interface
  - Phase 2: cancelActiveOperations() - aborts LLM requests, clears timers
  - Phase 3: finalCleanup() - shows cursor, goodbye message, process.exit(0)
- UI layer compatibility methods (writeOutput, writeError, writeWarning, writeInfo)
- State management integration through StateManager
- Spinner coordination and creation (createSpinner, showInitializationSpinner)

**Router** (existing, enhanced):
- Pure decision engine + direct execution
- Analyzes input, creates commandData, executes handlers
- Internal method: `routeAndProcess(input, applicationLoop)`
- No legacy routingTarget approach

**SystemCommandHandler** (new):
- Handles system commands (help, exit, provider, model, cmd)
- Replaces scattered system command logic

**CommandHandler** (existing):
- Handles single instruction commands from database
- Cache logic management (isCached && isForced checks)
- Delegates to ChatRequest for AI requests

**ChatRequest** (existing):
- Final AI request processing
- Unified spinner + ESC handling through AbortController
- Streaming response management

## 🎯 Multi-command архитектура (Композиция vs Дублирование)

### ✅ Правильная композиция:
```javascript
// MultiCommandHandler использует CommandHandler через композицию
class MultiCommandHandler {
  constructor() {
    this.commandHandler = new CommandHandler() // Композиция!
    this.cacheHandler = new CacheHandler()
  }

  async execute(commandData) {
    const { models, userInput, id, isCached, isForced } = commandData
    
    // Параллельное выполнение через композицию
    const promises = models.map(async (model) => {
      // Проверить кеш для каждой модели
      if (!isForced && isCached) {
        const cached = await this.cacheHandler.get(userInput, id, model)
        if (cached) return { ...cached, fromCache: true }
      }
      
      // Live запрос через CommandHandler
      const singleCommandData = { ...commandData, models: [model] }
      return await this.commandHandler.execute(singleCommandData)
    })
    
    // LEADERBOARD - отрисовка по мере поступления
    const results = []
    for await (const result of Promise.allSettled(promises)) {
      if (result.status === 'fulfilled') {
        results.push(result.value)
        this.streamResult(result.value) // Сразу начинаем отрисовку
      }
    }
    
    // Leaderboard система + форматирование
    return this.aggregateAndFormat(results)
  }
}
```

### Единственные ответственности Multi-command:
1. **Orchestration** - управление параллельным выполнением
2. **Leaderboard** - порядок вывода по скорости ответа 
3. **Aggregation** - сбор и форматирование результатов
4. **Mixed режим** - обработка частичного кеша (кеш + live)

### ❌ Что НЕ делает Multi-command:
- НЕ дублирует Single command логику
- НЕ делает прямые AI запросы
- НЕ парсит команды
- НЕ принимает решения о кешировании

## 🎯 Бизнес-правила мультимодельных команд

### Кеширование мультимодельных команд:
- ✅ **Гибкая система кеширования** - кеш контролируется полем `is_cached` в БД
- **Иерархическая структура кеша** - каждый `userInput` содержит массив результатов от разных команд и моделей
- **Безопасность команд** - `rr hello` и `kg hello` НЕ пересекаются, каждая команда имеет свой `commandId`
- **Mixed режим** - часть ответов из кеша (мгновенно), часть live запросов (стриминг)
- **Force flags** (`-f`, `--force`) игнорируют кеш
- **Per-command control**: любая команда может управлять кешированием

#### НОВАЯ структура данных в кеше (ключ = userInput):
```js
// Ключ кеша - чистый userInput БЕЗ инструкции
"биткоин": {
  userInput: "биткоин",
  results: [
    {
      commandId: "WTF_COMMAND",  // Разделение по командам
      provider: "openai", 
      model: "gpt-5-mini",
      response: "Bitcoin - это децентрализованная криптовалюта...",
      timestamp: 1642543200000
    },
    {
      commandId: "EXPLAIN",      // Другая команда, тот же userInput
      provider: "deepseek",
      model: "deepseek-chat", 
      response: "Биткоин представляет собой...",
      timestamp: 1642543210000
    }
  ]
}

// Безопасность: команды "wtf биткоин" и "explain биткоин" 
// НЕ конфликтуют благодаря разным commandId
```

#### Mixed режим работы:
```bash
> kg hello world
<from cache>
[DeepSeek deepseek-chat]  
салам дүйнө

[Anthropic claude-3-5-sonnet] ← live запрос + стриминг
салам дүйнө! ...стриминг...

[2/2 models responded - 1 from cache, 1 live]
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
→ Отправить запрос напрямую в default LLM (без кэша)
```

#### 2. Команда найдена → анализ models + isCached:

##### 2.1. Пустой массив моделей (`command.models.length === 0`):
```js
if (command.isCached === true) {
  // Проверить кэш → если есть ответ, вернуть из кэша
  // Если кэша нет → отправить в default model + сохранить в кэш
} else {
  // Отправить в default model без кэширования
}
```

##### 2.2. Одна модель (`command.models.length === 1`):
```js
if (command.isCached === true) {
  // Проверить кэш → если есть ответ, вернуть из кэша
  // Если кэша нет → отправить в указанную модель + сохранить в кэш
} else {
  // Отправить в указанную модель без кэширования  
}
```

##### 2.3. Несколько моделей (`command.models.length > 1`):
```js
if (command.isCached === true) {
  // Для каждой модели проверить кэш:
  // - Если ответ есть в кэше → взять из кэша
  // - Если ответа нет → отправить запрос + сохранить в кэш
  // Агрегировать все ответы (из кэша + новые)
} else {
  // Отправить во все указанные модели без кэширования
}
```

### Принципы кэширования:

#### Архитектурное разделение ответственности:
- **InputProcessingService**: обрабатывает флаги и возвращает полный commandData
- **Router**: ТОЛЬКО routing decisions, передает commandData дальше
- **CommandHandler**: управляет кеш логикой на основе isCached + isForced
- **CacheHandler**: тупой исполнитель с новой структурой по userInput
- **MultiCommandHandler**: оркестрация и leaderboard для multi-model
- **ChatRequest**: финальная обработка AI запросов

#### Логика Force Flags:
- **`--force` игнорирует ЧТЕНИЕ кеша** → всегда запрашивает LLM
- **`--force` НЕ игнорирует ЗАПИСЬ кеша** → результат СОХРАНЯЕТСЯ (перезатирает старые ответы)
- **Пример**: `aa hello --force` → пропустить чтение кеша → запросить LLM → сохранить результат в кеш

#### Технические принципы:
- **Ключ кэша**: `userInput` (чистый пользовательский ввод БЕЗ инструкции команды)
- **Фильтрация**: по `commandId + provider + model` внутри CacheManager
- **Безопасность**: команды `rr hello` и `kg hello` НЕ конфликтуют (разные `commandId`)
- **Per-command control**: через поле `is_cached` в БД (НЕ `cache_enabled`!)
- **Без TTL**: чистка кеша через отдельную команду, упрощенная архитектура

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

### Система кэширования:
- **Per-command control**: индивидуальное управление кешированием через `is_cached` поле
- **Переводы**: по ключу запроса (если is_cached=true)
- **Multi-provider**: множественные ответы (если is_cached=true)  
- **Документы**: сохранение в файлы
- **TTL caching** с автоочисткой (30 дней)
- **CommandEditor integration**: включение/отключение кеша через UI
- **Force override**: флаги `-f` или `--force` обходят кеш независимо от настроек

### ⚠️ Архитектурные проблемы доступа к данным:

#### 1. Кеширование (ИСПРАВЛЕНО):
**БЫЛО**: Логика кеширования разбросана по 5 файлам
**СТАЛО**: Централизованный `CacheManager` как единственный источник истины для всех решений по кешированию

#### 2. Доступ к базе данных команд (КРИТИЧНО):
**ПРОБЛЕМА**: Нарушение Single Source of Truth для доступа к SQLite БД команд:
- Прямые импорты `getCommandsFromDB()` разбросаны по всему коду
- Каждый компонент самостоятельно обращается к БД 
- Отсутствует централизованный контроль доступа к данным команд
- В будущем это приведет к неконтролируемому росту говнокода

**АРХИТЕКТУРНОЕ ПРАВИЛО**: Должна быть единая точка доступа к БД команд:
- `DatabaseCommandService` - единственный сервис с правом импорта `database-manager.js`
- Все остальные компоненты получают доступ к командам БД только через этот сервис
- Dependency injection для передачи сервиса в компоненты
- Запрет прямых импортов `getCommandsFromDB()` везде кроме `DatabaseCommandService`

**ЦЕЛЬ**: Предотвратить архитектурную деградацию и обеспечить контролируемый доступ к данным.

## 🧩 Архитектурные паттерны

### 1. Dual Architecture (Legacy + Modern):
Сосуществование старой архитектуры с новыми сервисами для плавного перехода:
- **Legacy**: прямое взаимодействие с aiState для совместимости
- **Modern**: использование ServiceManager для новой функциональности

### 2. Command Pattern:
Разделение команд по типам и областям ответственности:
- **Core commands**: системные команды (help, exit)
- **AI commands**: команды управления провайдерами и моделями
- **Instruction commands**: команды из SQLite базы данных

### 3. Factory Pattern:
Централизованное создание провайдеров с единообразной инициализацией и конфигурацией.

### 4. Chain of Responsibility (EXPERIMENTAL):
Экспериментальная архитектура с обработчиками, отключена в пользу production-ready RequestRouter.

## 📂 Структура файлов

### Основные компоненты:
- **bin/app.js**: Главное приложение (1660 строк) с полной бизнес-логикой
- **core/Router.js**: Чистый роутер для routing decisions (было RequestRouter)
- **core/ChatRequest.js**: Финальная обработка AI запросов (было AIProcessor)
- **core/CommandHandler.js**: Обработка single команд с кеш логикой (новый)
- **core/MultiCommandHandler.js**: Оркестрация multi-model с leaderboard (новый)
- **core/CacheHandler.js**: Унифицированный кеш с новой структурой (новый)
- **utils/application.js**: Базовый класс Application с общей функциональностью
- **utils/command-manager.js**: Система управления командами
- **utils/provider-factory.js**: Фабрика создания AI провайдеров
- **utils/stream-processor.js**: Обработчик потоковых ответов
- **utils/database-manager.js**: Управление SQLite базой команд
- **utils/command-editor.js**: Интерактивный редактор команд
- **services/service-manager.js**: Современная сервис-архитектура
- **services/input-processing-service.js**: Обработка ввода и флагов
- **services/DatabaseCommandService.js**: Single Source of Truth для БД команд

### Конфигурация:
- **config/commands.db**: SQLite база данных с командами
- **config/mcp-servers.json**: Конфигурация MCP серверов
- **config/default_models.js**: Предпочтительные модели для провайдеров
- **config/constants.js**: Константы приложения и UI символы

## 🚀 Состояние архитектуры

### ✅ Что работает:
1. **SQLite команды**: aa, cc, rr, hsk полностью из БД
2. **Multi-provider поддержка**: OpenAI, DeepSeek, Anthropic с ленивой загрузкой
3. **MCP интеграция**: автоматическое извлечение веб-контента
4. **Streaming**: потоковый вывод с возможностью отмены
5. **Кэширование**: переводы и множественные ответы
6. **CommandEditor**: полнофункциональное управление командами
7. **Robust Error Handling**: user-friendly обработка ошибок провайдеров без крашей
8. **Instant Provider Switching**: мгновенное переключение провайдеров (~0.016ms)
9. **Graceful Recovery**: автоматическое предложение смены провайдера при ошибках

### 🔄 Архитектурное состояние:
1. **Production Ready**: Router → CommandHandler → ChatRequest архитектура
2. **Handler Chain**: экспериментальный, полностью удален
3. **Composition Pattern**: MultiCommandHandler использует CommandHandler как строительные блоки
4. **ServiceManager**: полностью интегрирован
5. **Unified Handlers**: CacheHandler с новой структурой, унифицированные error и spinner

### 🎯 Готовность к рефакторингу:
- **Фаза 1 завершена**: мертвый код удален, тесты организованы
- **Фаза 2 готова**: архитектура изучена, точки декомпозиции определены
- **Core понимание**: бизнес-логика задокументирована

## 🔍 Ключевые точки для Фазы 2

### ✅ АРХИТЕКТУРА РЕАЛИЗОВАНА:
1. **ApplicationLoop → Router flow** - полностью реализовано
2. **Legacy processAIInput** - удален полностью
3. **SystemCommandHandler** - создан для системных команд
4. **Unified ESC handling** - через AbortController везде
5. **Clean separation** - каждый компонент имеет одну ответственность

### Реализованная архитектура:
- `core/ApplicationLoop.js` ← UI layer + main loop + ESC handling + graceful shutdown
  - Main loop: startMainLoop() with readline interface
  - ESC handling: handleEscapeKey() через AbortController
  - Graceful exit: exitApp() с 3-фазной очисткой ресурсов
  - UI compatibility: writeOutput(), writeError(), writeWarning(), writeInfo()
- `core/output-handler.js` ← Single Source of Truth для всего вывода приложения
- `core/Router.js` ← routing decisions + direct execution (enhanced)
- `core/SystemCommandHandler.js` ← system commands (help, exit, provider, model, cmd)
- `core/ChatRequest.js` ← финальная обработка AI запросов (было AIProcessor)
- `core/CommandHandler.js` ← single команды с кеш логикой
- `core/MultiCommandHandler.js` ← multi-model оркестрация
- `core/CacheManager.js` ← унифицированный кеш (исправлен getInstance)
- `core/StateManager.js` ← aiState + contextHistory

Архитектура хорошо подготовлена для рефакторинга благодаря четкому разделению ответственности и наличию современных сервисов.