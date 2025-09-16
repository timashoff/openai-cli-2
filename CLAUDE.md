# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Глобальные правила разработки

## Общие принципы
- никогда не хардкодь!
- не используй сложные regexp, лучше вместо это создавать словари/массивы/слайсы слов(символов)
- как можно реже используй regexp! сведи их к минимуму!
- веди всегда отдельный файл общих, на весь проект, констант; так будет проще отлаживать, добавлять новые данные, и убирать "магические числа"
- всегда старайся следовать принципам KISS, DRY, YAGNI
- строго следуй принципу Single Source of Truth (Единственный источник истины)!
- **Colocation Principle**: код должен находиться рядом с тем, кто его использует
- **Single Responsibility Principle**: каждая папка/модуль должна иметь четкую единственную ответственность
- **No Spread Principle**: не размазывать related код по разным папкам - держи связанный код вместе
- пытайся внедрять новые фичи в проект модульно, чтобы их можно было отдельно улучшать/дорабатывать/выпиливать
- **Организация утилит по принципу близости**: утилиты, используемые только одним компонентом/модулем, должны находиться РЯДОМ с ним, а не в общих папках типа /utils или /helpers. В общие папки помещай ТОЛЬКО код, используемый 3+ компонентами
- ВСЕ комментарии в коде ИСКЛЮЧИТЕЛЬНО на английском языке
- ВСЕ логи и технические сообщения ИСКЛЮЧИТЕЛЬНО на английском языке
- ВСЕ пользовательские сообщения ИСКЛЮЧИТЕЛЬНО на английском языке
- веди все проекты изначально на английском языке, оставляя возможность и проектируя так, чтобы в будущем было легко имплементировать мультиязычность; подготавливай архитектуру i18n с самого начала

## Принципы безопасности и обработки ошибок (Zero Trust)
- **ЦЕНТРАЛИЗОВАННАЯ ОБРАБОТКА ОШИБОК** - критически важная инфраструктура: все ошибки в проекте должны обрабатываться в едином специально спроектированном месте (Error Handler, Error Service, Error Manager)
- **Пользователь = потенциальный злоумышленник**: никогда не показывай raw error.message пользователям
- **Трехуровневая система обработки ошибок**:
  - **PUBLIC** (пользователю): только предопределенные безопасные сообщения
  - **DEV** (разработчику): детали только в development окружении
  - **INTERNAL** (системе): структурированные логи без чувствительных данных
- **НИКОГДА НЕ ЛОГИРОВАТЬ и НЕ ПОКАЗЫВАТЬ чувствительную информацию**: пароли, API-ключи, токены, секреты
- **Санитизация всех выводов**: считать ВСЕ error.message потенциально опасными
- **Предопределенные сообщения об ошибках**: использовать константы вместо динамических текстов
- **Single Point of Failure Prevention**: централизованный обработчик ошибок должен быть максимально надежным и простым

## Правила для проектов на JS
- **ИСКЛЮЧАЙ node_modules из поиска и анализа!** Анализируй код в node_modules только по прямому запросу пользователя для экономии токенов и фокуса на проектном коде
- всегда делай проверку на мертвый код перед тем как я прошу подготовить коммит месседж
- все сетевые запросы старайся выполнять через event-driven архитектуру (например с использованием EventEmitter)
- НЕ используй require, только ESM import/export модули!
- после удаления импортов из проекта удаляй также те части кода/файлы откуда эти импорты брались, не оставляй после себя много мусорных файлов
- **ЗАПРЕЩЕНО использовать классы (class)!** Код должен быть написан исключительно в функциональной парадигме. Вместо классов используй:
  - Фабричные функции (factory functions)
  - Объекты с методами
  - Композицию функций
  - Модули с экспортируемыми функциями
  - Пример: вместо `class User {}` используй `const createUser = () => ({})`
- всегда пиши асинхронный код в случае i/o операций, запросов по http и т.д.! никакой блокировки event loop! ОБЯЗАТЕЛЬНО используй async/await синтаксис вместо .then()
- принципиально минимальное использование внешних зависимостей! если есть встроенные возможности nodejs, то используй именно их!
- никогда не используй фреймворк express.js! только fastify!
- **Безопасная обработка ошибок**: применяй принципы Zero Trust - показывай пользователю только предопределенные безопасные сообщения из констант, raw error.message только разработчику в dev режиме
- SQLite поддержка уже встроена в nodejs! используй node:sqlite вместо внешних зависимостей
- НИКОГДА не используй оператор опциональной цепочки (optional chaining) "?."
- никаких legacy подходов типа `const __dirname = path.dirname(fileURLToPath(import.meta.url))` - используй современный синтаксис `import.meta.dirname`
- НИКАКИХ JSDoc комментариев! не засоряй проекты этим мусором
- НИКОГДА не используй switch/case конструкции! Заменяй их на функциональный подход:
  - Объекты-словари с функциями
  - Map структуры
  - Массивы с find/filter методами
  - Пример: вместо `switch(type) { case 'a': return handleA() }` используй `const handlers = { a: handleA }; return handlers[type]()`

## Правила работы с SQL/SQLite
- при работе с SQL используй методику UPSERT для разрешения конфликтов! Используй `INSERT OR REPLACE` или `INSERT OR IGNORE` вместо отдельных INSERT/UPDATE операций
- всегда используй prepared statements для предотвращения SQL injection
- создавай индексы для часто используемых полей поиска

## Правила для проектов на Swift/Xcode
- **Безопасная обработка ошибок**: применяй принципы Zero Trust - используй предопределенные сообщения, raw error только в DEBUG режиме
- При создании новых файлов в Xcode проектах ВСЕГДА предупреждай что файлы нужно добавить в проект вручную
- Объясняй как: "Правый клик на папке в Xcode → Add Files to 'ProjectName' → выбрать файлы → снять галку 'Add to target' для документации"
- Никогда не создавай файлы молча без предупреждения об этом
- После создания файлов всегда выводить инструкцию:
  "ВНИМАНИЕ: Файлы созданы в файловой системе, но НЕ добавлены в Xcode проект!
   Нужно добавить вручную:
   1. Правый клик на корневой папке в Xcode
   2. 'Add Files to ProjectName'
   3. Выбрать созданные файлы
   4. Убрать галку 'Add to target' (для документации)"

## Правила для Git коммитов
- НЕ добавляй строку, о том что коммит сгенерирован с помощью ИИ, например вот такую: "🤖 Generated with [Claude Code](https://claude.ai/code)" в сообщения коммитов

## Правила для Git Workflow и работы с ветками
- Использую **Enhanced GitFlow** для команды разработчиков
- **Структура веток**:
  ```
  master     ──●────●────●────●──  (только релизы с тегами)
                │    │    │    │
                v1.0 v1.1 v1.2 v2.0
                │    │    │    │
  develop    ──●────●────●────●──  (интеграционная ветка)
              ╱ ╲  ╱ ╲  ╱ ╲  ╱ ╲
  feature/A  ●───●╱   ╲╱   ╲╱   ╲
  feature/B     ●─────●╱   ╲╱
  feature/C          ●─────●╱
  ```

- **Workflow**:
  1. **feature → develop**: Regular merge (сохраняет contributions)
  2. **develop → master**: Squash merge + ручные теги версий

- **Команды для разработки**:
  ```bash
  # Feature разработка
  git checkout -b feature/my-feature
  git commit -m "feat: implement awesome feature"

  # Merge в develop (regular - сохраняет GitHub contributions)
  git checkout develop
  git merge feature/my-feature

  # Релиз в master (когда готовы)
  git checkout master
  git merge --squash develop
  git commit -m "release: v1.1.0 - description"
  git tag -s v1.1.0 -m "Release v1.1.0"
  git push origin master --tags

  # Синхронизировать develop с master после релиза
  git checkout develop
  git reset --hard master
  git push origin develop --force
  ```

- **Преимущества**:
  - Простота: только основные git команды
  - Гибкость: версии присваиваются вручную когда готовы
  - GitHub contributions: regular merge сохраняет активность разработчика
  - Чистые релизы: squash merge только в master для чистой истории релизов
  - GPG подписи: используй -s флаг для verified тегов
  - Контроль: полный контроль над релизами
  - Минимализм: никаких внешних зависимостей
  - Мотивация: видимая активность в GitHub графике

- **Типы коммитов** (conventional commits):
  - `feat:` - новая функциональность
  - `fix:` - исправление бага
  - `docs:` - изменения в документации
  - `style:` - форматирование, отсутствие изменений кода
  - `refactor:` - рефакторинг кода
  - `test:` - добавление тестов (только когда программа стабильна для production)
  - `chore:` - обновление сборки, вспомогательные инструменты

### Пошаговый workflow для новых задач:

1. **Подготовка develop:**
   ```bash
   # Сначала синхронизируй develop с master (обязательно!)
   git checkout develop
   git reset --hard master
   git push origin develop --force
   ```

2. **Создание новой фичи:**
   ```bash
   # Создать ветку от чистого develop
   git checkout -b feature/название-задачи develop
   # или для рефакторинга:
   git checkout -b refactor/название-системы develop
   ```

3. **Работа над задачей:**
   - Делать изменения согласно требованиям
   - Коммитить по мере работы с правильными типами коммитов
   - Тестировать функциональность после каждого важного изменения

4. **Завершение работы:**
   ```bash
   # Запушить ветку
   git push -u origin feature/название-задачи
   # Создать PR: feature → develop (regular merge)
   # НЕ в master! Только в develop!
   ```

5. **Подготовка релиза (когда накопилось достаточно фич):**
   ```bash
   # Создать PR: develop → master (squash merge)
   # После влития в master снова синхронизировать develop (пункт 1)
   ```

**Ключевые принципы:**
- Фича-ветки → develop (regular merge, сохраняет GitHub contributions)
- develop → master (squash merge, чистая история релизов)
- После каждого релиза: develop reset к master для синхронизации
- Удалять фича-ветки после успешного влития в develop

## Правила для рефакторинга кода

### Основные принципы:
- **УДАЛЯЙ** старый код сразу после замены - никаких deprecated, legacy или fallback!
- Создавай git ветку `refactor/название-фичи` для каждого крупного рефакторинга
- Git - единственный бекап, никаких дополнительных бекапов в коде

### Правила работы с legacy файлами:
- Когда я прошу **пометить файл как legacy** - это означает, что файл помечается как устаревший и **НЕ должен использоваться ни в коем случае**!
- Legacy файлы оставляются для справки - чтобы при необходимости "вспомнить" старую логику и возможно перенести какие-то решения в новый код, обновив и улучшив их
- Переименование происходит по принципу добавления суффикса `_legacy`:
  - `UnifiedCommandManager.js` → `UnifiedCommandManager_legacy.js`
  - `UserService.ts` → `UserService_legacy.ts`
- **НИКОГДА не импортируй и не используй legacy файлы в новом коде!**
- Legacy файлы удаляются только по моему явному указанию

### Методология анализа сервисов перед рефакторингом:

Критический анализ требует глубокого исследования зависимостей и использования сервиса. Необходимо провести тщательную инвентаризацию методов, проверить их актуальность и фактическое применение в проекте.

**Этапы анализа:**
1. **Исследование назначения**: понять ДЛЯ ЧЕГО сервис существует в архитектуре
2. **Анализ зависимостей**: кто использует сервис (grep по импортам и вызовам)
3. **Инвентаризация методов**: какие методы реально вызываются в коде
4. **Выявление dead code**: неиспользуемые методы, свойства, логика
5. **Проверка архитектурной роли**: соответствует ли Single Responsibility Principle

**Вопросы для анализа:**
- Какую роль играет сервис в общем data flow?
- Все ли методы действительно используются?
- Есть ли дублирование функциональности?
- Соответствует ли сервис принципам CLAUDE.md?

### Планирование крупного рефакторинга:
1. **Создай REFACTOR-ROADMAP.md** с детальным планом:
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

2. **Создай BUSINESS-LOGIC.md** для сохранения критической логики:
   ```markdown
   # Business Logic Documentation

   ## Core Rules
   - Rule 1: Description and implementation details
   - Rule 2: Edge cases and expected behavior

   ## Test Cases
   - Input/Output examples
   - Edge case scenarios
   ```

### Методология анализа при рефакторинге:
**ВСЕГДА включай ultrathink mode при анализе!**

Перед началом рефакторинга любого участка кода ОБЯЗАТЕЛЬНО задавай себе следующие вопросы:

1. **Что это за файл и для чего он нужен?**
   - Понимание назначения и роли в системе
   - Анализ основной функциональности

2. **С какими участками кода он взаимодействует?**
   - Маппинг зависимостей и связей
   - **Глубокий анализ каждого импорта**:
     - Откуда импортируется и что содержит исходный файл?
     - Действительно ли используются ВСЕ импортируемые элементы?
     - Какую бизнес-логику несет импортируемый код?
     - Не является ли импорт театральным (присутствует, но фактически не используется)?
   - **Анализ экспортов**:
     - Кто фактически использует экспортируемые элементы?
     - Все ли экспорты имеют реальных потребителей?
     - Не экспортируется ли мертвый код?
   - **Трассировка цепочек зависимостей**:
     - Проследить полный путь от импорта до фактического использования
     - Выявить промежуточные файлы, которые только перепроводят импорты
     - Найти циклические зависимости
   - Поиск использований этого кода в других файлах

3. **Есть ли в нем легаси код?**
   - Поиск устаревших паттернов
   - Идентификация кода, который можно модернизировать

4. **Есть ли мертвый код?**
   - Неиспользуемые функции, переменные, импорты
   - Код, который никогда не выполняется

5. **Нарушает ли архитектурные принципы CLAUDE.md?**
   - Проверка на соответствие правилам проекта
   - Выявление нарушений функциональной парадигмы
   - Поиск hardcode, использования классов, switch/case и других запрещенных паттернов

6. **Проверка на ТЕАТРАЛЬНОСТЬ и ПСЕВДО-ФУНКЦИОНАЛЬНОСТЬ кода (ULTRA-THINK)**

   **ТЕАТРАЛЬНЫЙ КОД** - код, который выглядит функциональным, но является мертвым или создает ложную иллюзию работы.

   **УНИВЕРСАЛЬНАЯ МЕТОДОЛОГИЯ для любого языка программирования:**

   **ФАЗА 1: ПОЛНАЯ ИНВЕНТАРИЗАЦИЯ ЗАВИСИМОСТЕЙ**
   Для каждого подключения модуля/библиотеки/файла:
   - [ ] **Источник**: ЧТО именно подключается (функции, классы, константы)
   - [ ] **Первичное использование**: ГДЕ используются подключенные элементы
   - [ ] **НЕ ОСТАНАВЛИВАЙСЯ на факте подключения!** - это может быть театр

   **ФАЗА 2: АНАЛИЗ ПОЛНОЙ ЛОГИЧЕСКОЙ ЦЕПОЧКИ**
   Для каждого "используемого" элемента:
   - [ ] **Полнота использования**: используются ли ВСЕ методы/свойства объекта или только часть?
   - [ ] **Использование результата**: используется ли возвращаемое значение или результат выполнения?
   - [ ] **Логическая связность**: есть ли логическая ЦЕПОЧКА действий или только изолированные вызовы?
   - [ ] **Влияние на поток выполнения**: влияет ли результат на дальнейшую логику программы?

   **ФАЗА 3: ВЫЯВЛЕНИЕ ПСЕВДО-ФУНКЦИОНАЛЬНОСТИ**

   **УНИВЕРСАЛЬНЫЕ RED FLAGS псевдо-функционального кода:**

   **Паттерн "Вызов без использования результата":**
   - Функция/метод вызывается, НО возвращаемое значение игнорируется
   - Объект создается, НО его состояние не проверяется

   **Паттерн "Частичная реализация безопасности":**
   - Компонент безопасности инициализируется, НО проверки не блокируют выполнение
   - Валидация выполняется, НО результаты валидации игнорируются
   - Логирование ошибок есть, НО обработка ошибок отсутствует

   **Паттерн "Неполная функциональная цепочка":**
   - Данные записываются, НО никогда не читаются
   - Состояние устанавливается, НО никогда не проверяется
   - События генерируются, НО обработчики не реагируют

   **Паттерн "Имитация работы":**
   - Объект имеет 10 методов, НО используется только 1-2 метода
   - Система инициализируется, НО её основная функциональность обходится

   **ФАЗА 4: АНАЛИЗ СООТВЕТСТВИЯ НАЗНАЧЕНИЮ**
   Ключевые вопросы (язык-независимые):
   - **Семантическое назначение**: что ДОЛЖНО делать по названию/документации?
   - **Фактическое поведение**: что РЕАЛЬНО происходит в коде?
   - **Полнота реализации**: реализована ли полная функциональность или только её видимость?
   - **Влияние на программу**: как изменится поведение программы при удалении этого кода?

   **ТИПОЛОГИЯ ТЕАТРАЛЬНОГО КОДА (универсальная):**

   1. **МЕРТВЫЙ** - определен, но никогда не используется
   2. **ПОДКЛЮЧЕННО-МЕРТВЫЙ** - подключается, но не используется
   3. **ВЫЗЫВНО-МЕРТВЫЙ** - вызывается, но результат игнорируется
   4. **ЧАСТИЧНО-ФУНКЦИОНАЛЬНЫЙ** - работает на 20-30%, создавая иллюзию полной работы
   5. **ПСЕВДО-ЗАЩИТНЫЙ** - имитирует безопасность/проверки без реальной защиты
   6. **АРХИТЕКТУРНО-ИЗБЫТОЧНЫЙ** - правильно работает, но решает несуществующую проблему

   **УНИВЕРСАЛЬНЫЕ ДЕЙСТВИЯ:**
   - **МЕРТВЫЙ/ПОДКЛЮЧЕННО-МЕРТВЫЙ** → немедленное удаление
   - **ЧАСТИЧНО-ФУНКЦИОНАЛЬНЫЙ** → доимплементировать ИЛИ удалить (консультация с заказчиком)
   - **ПСЕВДО-ЗАЩИТНЫЙ** → ПРИОРИТЕТ удаления (опаснее отсутствия защиты)
   - **АРХИТЕКТУРНО-ИЗБЫТОЧНЫЙ** → удаление после подтверждения ненужности

   **КОНТРОЛЬНЫЕ ВОПРОСЫ ДЛЯ ЛЮБОГО ЯЗЫКА:**
   - Все ли подключенные модули РЕАЛЬНО используются?
   - Все ли созданные объекты выполняют свое ПОЛНОЕ назначение?
   - Все ли "защитные" механизмы РЕАЛЬНО защищают?
   - Нет ли разрыва между названием компонента и его функциональностью?
   - Изменится ли поведение программы при удалении каждого компонента?

   **ПРИНЦИП ЧЕСТНОСТИ КОДА:**
   Лучше честное отсутствие функциональности, чем её имитация.
   Псевдо-функциональный код опаснее мертвого, так как создает ложные ожидания и может привести к критическим ошибкам в production.

   **СОЗДАВАЙ IMPORT-AUDIT.md для каждого крупного рефакторинга:**
   ```markdown
   # Import/Export Audit: [FileName]

   ## Summary
   - Total imports: X
   - Used imports: Y
   - Dead imports: Z
   - Theatrical imports: W

   ## Dead Code Found
   - [ ] Import A from module B (line X) - never used
   - [ ] Export C (line Y) - no consumers found

   ## Theatrical Code Found
   - [ ] Import D from module E (line Z) - imported but methods never called

   ## Recommendations
   - Remove imports: [list]
   - Simplify chains: [list]
   - Direct imports: [list]
   ```

### Контрольные точки:
- Убедиться что программа запускается, затем обратиться к пользователю для полного тестирования
- Производительность не должна деградировать
- API совместимость должна сохраняться
- Документация обновляется синхронно с кодом


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

**ES modules only:**
- Use only `import/export`, never use `require()`
- Project uses `"type": "module"` in package.json
- All imports must be static at the beginning of the file

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
- **Zero Trust error handling system**:
  - PUBLIC level: predefined safe messages for users
  - DEV level: detailed errors only in development mode
  - INTERNAL level: structured logs without sensitive data
  - Complete sanitization of all error outputs

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

**Streaming Architecture:** Real-time response streaming with escape key cancellation:
- `StreamProcessor` handles different provider response formats
- Global keypress handler for immediate escape response
- State management for request vs response processing

## Key Files to Understand

- `bin/app.js` - Main application entry point with AIApplication class
- `utils/application.js` - Base application class with core functionality
- `utils/provider-factory.js` - AI provider creation and management
- `utils/stream-processor.js` - Response streaming with provider-specific parsing
- `config/instructions.js` - Translation and task command definitions
- `utils/command-manager.js` - Command registration and execution system