# REFACTORING_ROADMAP.md

## 🎯 Цель: Комплексная архитектурная модернизация

### 📊 Исходная диагностика (13.08.2025):
- **bin/app.js**: 1660 строк с 251 условной конструкцией 
- **Импорты**: 30+ в одном файле (архитектурный smell)
- **TODO/FIXME**: 51 комментарий по всему коду
- **Мертвый код**: 4 неиспользуемых файла
- **Дубликаты**: 2 сервиса с идентичной функциональностью
- **Тесты**: 7 файлов в корне (должны быть в /tests)
- **Monolith**: Смешивание UI, бизнес-логики, сети и конфигурации

---

## 🏗️ ПЛАН РЕФАКТОРИНГА

### ✅ ФАЗА 1: Очистка мертвого кода
**Цель**: Устранить ~15% codebase, упростить понимание

- [ ] **1.1 Удалить неиспользуемые файлы:**
  - [ ] `utils/menu-helpers.js` (0 использований)
  - [ ] `utils/enhanced-provider-factory.js` (только тесты)
  - [ ] `utils/structured-logger.js` (только тесты)
  - [ ] `config/instructions.js.backup` (backup файл)

- [ ] **1.2 Устранить дубликаты сервисов:**
  - [ ] Удалить `services/provider-service.js` → использовать `ai-provider-service.js`
  - [ ] Удалить `services/command-service.js` → использовать `command-processing-service.js`

- [ ] **1.3 Организовать тесты:**
  - [ ] Создать `/tests` директорию
  - [ ] Переместить все `test-*.js` файлы
  - [ ] Обновить импорты в тестах

---

### ⏳ ФАЗА 2: Декомпозиция Monolith  
**Цель**: bin/app.js 1660 → ~150 строк

- [ ] **2.1 Создать core архитектуру:**
  - [ ] `core/Application.js` - Базовая логика приложения
  - [ ] `core/CLIInterface.js` - Управление терминалом
  - [ ] `core/RequestRouter.js` - Роутинг запросов
  - [ ] `core/StateManager.js` - Управление состоянием

- [ ] **2.2 Выделить команды:**
  - [ ] `commands/CommandExecutor.js` - Движок выполнения
  - [ ] `commands/ProviderCommand.js` - Смена провайдера
  - [ ] `commands/ModelCommand.js` - Смена модели
  - [ ] `commands/HelpCommand.js` - Система помощи

---

### 🎯 ФАЗА 3: Применение паттернов
**Цель**: SOLID principles + Design Patterns

- [ ] **3.1 Command Pattern:**
  - [ ] Абстрактный `BaseCommand`
  - [ ] `CommandInvoker` для выполнения
  - [ ] `CommandHistory` для undo/redo

- [ ] **3.2 Strategy Pattern:**
  - [ ] `ChatStrategy` - обычное общение
  - [ ] `TranslationStrategy` - перевод
  - [ ] `DocumentStrategy` - обработка файлов

- [ ] **3.3 Facade Pattern:**
  - [ ] `AIFacade` - упрощение AI операций
  - [ ] `ConfigFacade` - упрощение конфигурации

---

### 🚀 ФАЗА 4: Модернизация архитектуры
**Цель**: Event-driven + Dependency Injection

- [ ] **4.1 Активировать Handler Chain:**
  - [ ] Убрать комментарий "DISABLED while studying architecture"
  - [ ] Интегрировать с новой архитектурой
  - [ ] Добавить метрики производительности

- [ ] **4.2 Унифицировать Service Layer:**
  - [ ] Удалить дублирующиеся сервисы
  - [ ] Стандартизировать интерфейсы
  - [ ] Добавить health checks

- [ ] **4.3 Repository Pattern:**
  - [ ] `ConfigRepository` - работа с настройками
  - [ ] `ModelRepository` - управление моделями
  - [ ] `CacheRepository` - кеширование

---

### ⚡ ФАЗА 5: Оптимизация производительности
**Цель**: Scalability + Performance

- [ ] **5.1 Lazy Loading:**
  - [ ] Отложенная загрузка тяжелых модулей
  - [ ] Dynamic imports для опциональных фич

- [ ] **5.2 Connection Pooling:**
  - [ ] Пул соединений для AI провайдеров
  - [ ] Smart retry logic с circuit breaker

- [ ] **5.3 Smart Caching:**
  - [ ] TTL-based cache для запросов
  - [ ] LRU eviction policy
  - [ ] Cache warming strategies

---

## 📝 PROGRESS TRACKING

### Completed ✅
- [x] Создание refactor ветки `refactor/monolith-decomposition-and-cleanup`
- [x] Создание roadmap документа

### In Progress 🔄  
- [ ] Фаза 1: Очистка мертвого кода

### Blocked 🚫
_(Заблокированные задачи с причинами)_

---

## 🐛 DISCOVERED ISSUES
_(Новые проблемы, найденные в процессе)_

---

## 💡 ARCHITECTURAL DECISIONS  
_(История принятых архитектурных решений)_

---

## 🎯 SUCCESS METRICS

### Количественные:
- [ ] Размер bin/app.js: 1660 → ~150 строк (-90%)
- [ ] Циклическая сложность: 251 → <50 (-80%)
- [ ] Количество TODO: 51 → 0 (-100%)
- [ ] Количество файлов: убрать 6 мертвых файлов
- [ ] Покрытие тестами: возможность unit-тестирования

### Качественные:  
- [ ] SOLID principles соблюдены
- [ ] Separation of concerns достигнут
- [ ] Код легко читается и поддерживается
- [ ] Добавление новых фич не требует изменения core
- [ ] Performance улучшен благодаря lazy loading

---

## 📋 DETAILED TASK TRACKING

### Фаза 1.1: Удаление неиспользуемых файлов
- [ ] `utils/menu-helpers.js` - подтверждено 0 использований
- [ ] `utils/enhanced-provider-factory.js` - используется только в тестах
- [ ] `utils/structured-logger.js` - используется только в тестах  
- [ ] `config/instructions.js.backup` - backup файл

### Фаза 1.2: Устранение дубликатов
- [ ] `services/provider-service.js` vs `services/ai-provider-service.js` - анализ различий
- [ ] `services/command-service.js` vs `services/command-processing-service.js` - анализ различий

### Фаза 1.3: Организация тестов
- [ ] `test-enhanced-factory.js` → `tests/enhanced-factory.test.js`
- [ ] `test-handler.js` → `tests/handler.test.js`
- [ ] `test-implementation.js` → `tests/implementation.test.js`
- [ ] `test-improvements.js` → `tests/improvements.test.js`
- [ ] `test-services.js` → `tests/services.test.js`
- [ ] `test-universal-multi.js` → `tests/universal-multi.test.js`
- [ ] `test-ux-fix.js` → `tests/ux-fix.test.js`

---

## 📝 SESSION NOTES

### 13.08.2025 - Initial Analysis
- Создана ветка для рефакторинга
- Проведен анализ архитектурных проблем
- Выявлены основные точки боли: monolith, мертвый код, дублирование
- План разбит на 5 фаз с четкими метриками успеха