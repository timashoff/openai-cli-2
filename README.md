[English](#english) | [Русский](#russian) | [中文](#chinese)

<details open>
<summary>English</summary>
<a name="english"></a>

# Console AI Assistant

A command-line tool for interacting with AI providers (OpenAI, DeepSeek), designed to use large language models directly in your terminal. It includes command templates, switching between AI providers and their models, and **MCP (Model Context Protocol) integration** for web content extraction.

## Features

- **Multi-Provider Support:** Easily switch between OpenAI and DeepSeek.
- **Model Selection:** List and choose from all available models of the selected provider.
- **~~Smart Caching~~ Disabled:** Caching system is temporarily disabled - all requests are live.
- **~~Force Refresh~~ Disabled:** --force/-f flags are parsed but ignored (cache disabled).
- **Request Cancellation:** Abort a long-running or unwanted API call by pressing `Esc`.
- **Clipboard Integration:** Insert your clipboard contents into the prompt with the `$$` token.
- **Contextual Chat:** Keeps a conversation history for coherent multi-turn dialogue (for non-translation queries).
- **Cross-Platform:** Works on macOS (tested), Linux, and Windows (needs testing).

## Installation Requirements

1. Software
   - **Node.js:** Version 22.x or higher required.
   - **npm:** Included with Node.js, used for package management.
   - **Git:** For cloning the repository.
   - **(Linux only) xclip:** Needed for clipboard support on Linux. Install via your package manager (e.g., `sudo apt-get install xclip`).

2. Skills
   - Basic familiarity with the command line (terminal).

## Installation and Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/timashoff/openai-cli-2.git
   cd openai-cli-2
   ```

2. Install dependencies globally so the utility is available system-wide:
   ```bash
   npm i -g
   ```

3. Configure your API keys. You have two options:

   Method 1: Using a `.env` file (local to the project)
   - Create a file named `.env` in the project root.
   - Add your keys in this format:
     ```env
     # .env file
     # Generate here: https://platform.openai.com
     OPENAI_API_KEY="sk-OpenAI_API_Key"

     # Generate here: https://platform.deepseek.com/api_keys
     DEEPSEEK_API_KEY="sk-DeepSeek_API_Key"
     ```
   - The `.env` file is in `.gitignore` by default, so your keys won’t be committed.

   Method 2: Environment Variables (recommended)
   - For macOS/Linux with Zsh:
     1. Open `~/.zshrc`.
     2. Add:
        ```bash
        export OPENAI_API_KEY="sk-OpenAI_API_Key"
        export DEEPSEEK_API_KEY="sk-DeepSeek_API_Key"
        ```
     3. Run `source ~/.zshrc`.
   - For macOS/Linux with Bash:
     1. Open `~/.bash_profile` or `~/.bashrc`.
     2. Add the same `export` lines.
     3. Run `source ~/.bash_profile` (or `~/.bashrc`).

## Running the Program

From the project folder, run:
```bash
node bin/app.js
```
If installed globally (`npm i -g`), simply type:
```bash
ai
```

## How It Works

1. **Provider Selection:** On startup (and whenever you run the `provider` command), you choose between your configured AI providers.
2. **Model Loading:** The tool fetches and displays all available models.
3. **User Input:** Acts like a chat interface.
4. **Command Handling:**
   - **System commands** (`help`, `model`, `provider`, `exit`) run locally.
   - **Translation commands** (`rr`, `ee`, etc.) are sent directly to the API (caching disabled).
   - **General chat** (any other input) is sent to the API along with the current conversation history for context.
5. **Streaming Responses:** The AI’s reply streams in real time; press `Esc` to interrupt.
6. **Clearing Context:** Entering an empty line clears the conversation context to avoid hitting token limits when you switch topics.
7. **Full Screen Clear:** Hitting Enter twice clears both the context and your terminal screen (you can scroll up to see previous answers).

## Commands and Usage

System Commands:
- help – Show all available commands and usage.
- provider – Switch AI provider.
- model – List and pick a different model.
- cmd – Interactive command manager for adding/editing/removing user commands.
- exit – Quit the application.

Instruction Commands (translation & other tasks):
- gg / -g / :g – Grammar check and correction
  Example: `gg i can has cheezburger?`
- rr / рр / ру – Translate to Russian
  Example: `rr Hello, my friend.`
- ee / аа / aa – Translate to English
  Example: `ee Привет, мой друг.`
- cc / сс / кк – Translate to Chinese
  Example: `cc Hello, my friend.`
- code – Review code for bugs and quality
  Example: `code const x = 1;`
- …and many more! Use `help` to see the full list.

Special Features:
- Clipboard Integration (`$$`): Use `$$` in your prompt to paste clipboard contents.
  Example:
  ```
  > code $$
  ```
- ~~Force Request (`--force` or `-f`)~~ Disabled: Flags are parsed but ignored (caching disabled).

## For Developers: Adding a New Command

The application uses an interactive command management system with SQLite database storage.

1. Run the interactive command manager:
   ```bash
   cmd
   ```
   Or in Russian:
   ```bash
   кмд
   ```

2. Choose "Add command" from the main menu.

3. Follow the interactive prompts to configure:
   - **Command keys**: Text triggers that activate the command (e.g., `gg`, `rr`, `translate`)
   - **Command description**: Brief explanation of what the command does
   - **AI instruction**: The full prompt sent to the AI model
   - **Target models**: Optionally specify which models can use this command
   - **Undo/Redo**: The system supports operation rollback

4. Your command is immediately available for use across all providers and models.

The interactive system also supports editing, removing, and bulk operations on existing commands.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

</details>

<details>
<summary>Русский</summary>
<a name="russian"></a>

# Консольный ИИ-Ассистент

Инструмент командной строки для взаимодействия с ИИ-провайдерами (OpenAI, DeepSeek), предназначен для использования больших языковых моделей в терминале. Включает шаблоны-команды, переключение между провайдерами ИИ и их моделями, а также **интеграцию MCP (Model Context Protocol)** для извлечения веб-контента.

## Возможности

- **Поддержка нескольких провайдеров:** Легкое перекление между OpenAI и DeepSeek.
- **Выбор модели:** Список всех доступных моделей от выбранного провайдера.
- **~~Интеллектуальное кеширование~~ Отключено:** Система кеширования временно отключена - все запросы живые.
- **~~Принудительный запрос~~ Отключен:** Флаги --force/-f парсятся, но игнорируются (кеш отключен).
- **Отмена запроса:** Отмена затянувшегося или ненужного запроса к API нажатием клавиши `Esc`.
- **Интеграция с буфером обмена:** Добавление содержимого буфера обмена с помощью маркера `$$` в запросе.
- **Контекстный чат:** Сохраняет историю разговора для последовательного диалога (для запросов, не являющихся переводом).
- **Кроссплатформенность:** Работает на macOS (протестированно). на Linux и Windows (надо тестить).

## Требования для установки

### 1. Программное обеспечение
- **Node.js:** Требуется версия 22.x или новее.
- **npm:** Поставляется вместе с Node.js. Используется для управления пакетами.
- **Git:** Для клонирования репозитория.
- **(Только для Linux) xclip:** Функциональность буфера обмена в Linux зависит от этой утилиты. Вы можете установить ее с помощью вашего менеджера пакетов, например, `sudo apt-get install xclip`.

### 2. Навыки для работы с утилитой
- Базовое знакомство с командной строкой (терминалом).

## Установка и настройка

1.  **Клонирование репозитория:**
    Откройте терминал и выполните следующую команду, чтобы клонировать проект на ваш локальный компьютер:
    ```bash
    git clone https://github.com/timashoff/openai-cli-2.git
    cd openai-cli-2
    ```

2.  **Установка зависимостей:**
    Выполните следующую команду для установки необходимых пакетов Node.js глобально (утилита будет доступна из любой директории, в которой бы не находился терминал):
    ```bash
    npm i -g
    ```

3.  **Настройка API-ключей:**
    Два способа настроить ваши API-ключи.

    ### Метод 1: Использование файла `.env`
    Метод прост и хранит ключи в каталоге проекта.

    - Необходимо создать новый файл с именем `.env` в корневом каталоге проекта.
    - Открыть файл `.env` текстовым редакторе и добавить API-ключи в следующем формате:

    ```env
    # Файл .env

    # Генерировать здесь: https://platform.openai.com
    OPENAI_API_KEY="sk-OpenAI_API_Ключ"

    # Генерировать здесь: https://platform.deepseek.com/api_keys
    DEEPSEEK_API_KEY="sk-DeepSeek_API_Ключ"
    ```
    **Важно:** Файл `.env` включен в `.gitignore`, поэтому ключи никогда не будут случайно отправлены в Git.

    ### Метод 2: Использование переменных окружения (Рекомендуется)
    Этот метод делает ключи доступными глобально в терминале.

    - **Для macOS/Linux (Zsh):**
        1. Открыть конфигурационный файл Zsh: `~/.zshrc`
        2. Добавить следующие строки в конец файла:
           ```bash
           export OPENAI_API_KEY="sk-OpenAI_API_Ключ"
           export DEEPSEEK_API_KEY="sk-DeepSeek_API_Ключ"
           ```
        3. Сохранить файл и применить изменения, выполнив: `source ~/.zshrc`

    - **Для macOS/Linux (Bash):**
        1. Открыть конфигурационный файл файл Bash (`~/.bash_profile` или `~/.bashrc`): `open ~/.bash_profile`
        2. Добавить следующие строки в конец файла:
           ```bash
           export OPENAI_API_KEY="sk-OpenAI_API_Ключ"
           export DEEPSEEK_API_KEY="sk-DeepSeek_API_Ключ"
           ```
        3. Сохранить файл и применить изменения, выполнив: `source ~/.bash_profile`

## Как запустить программу

После завершения установки и настройки вы можете запустить приложение, выполнив из папки с приложением:

```bash
node bin/app.js
```

Либо, если установлен пакет глобально ```npm i -g```, в окне терминала прописав ```ai```

## Как это работает

1.  **Выбор провайдера:** При старте (и всякий раз, когда вы используете команду `provider`) будет предложено выбрать между настроенными ИИ-провайдерами.
2.  **Загрузка моделей:** Приложение загружает и отображает список всех доступных моделей.
3.  **Ввод пользователя:** Общение как в обычном чате.
4.  **Обработка команд:**
    - **Системные команды** (`help`, `model`, `provider`, `exit`) выполняются напрямую.
    - **Команды перевода** (`rr`, `ee` и т.д.) отправляются напрямую в API (кеширование отключено).
    - **Общий чат** (любой другой ввод) отправляется в API вместе с историей текущего разговора для предоставления контекста.
5.  **Потоковая передача ответа:** Ответ ИИ передается в ваш терминал в режиме реального времени, его можно прервать через `Esc`.
6.  **Ввод пустой строки** очищает контекст, дабы не перегружать API токенами в случае резкой смены темы запросов
7.  **Ввод пустой строки дважды** помимо очещение исторического контекста, очищает экран пользователя. Чтобы увидеть стырые ответы можно проскролить терминал вверх

---

## Команды и использование

### Системные команды

| Команда    | Описание                                     |
| :--------- | :------------------------------------------- |
| `help`     | Отображает справочное сообщение со всеми командами. |
| `provider` | Позволяет переключить ИИ-провайдера.         |
| `model`    | Показывает доступные модели и предлагает выбрать новую. |
| `cmd`, `кмд` | Интерактивный менеджер команд для добавления/редактирования/удаления пользовательских команд. |
| `exit`     | Закрывает приложение.                        |

### Команды-инструкции

| Ключи команды      | Описание                        | Пример                                |
| :----------------- | :------------------------------ | :------------------------------------ |
| `gg`, `-g`, `:g`   | Проверяет и исправляет грамматику. | `gg i can has cheezburger?`           |
| `rr`, `рр`, `ру`   | Переводит текст на русский.     | `rr Hello, my friend.`                |
| `ee`, `аа`, `aa`   | Переводит текст на английский.  | `ee Привет, мой друг.`                |
| `cc`, `сс`, `кк`   | Переводит текст на китайский.   | `cc Hello, my friend.`                |
| `code`             | Проверяет код на ошибки и качество. | `code const x = 1;`                |
| ...и многие другие! | Используйте команду `help` для просмотра всех инструкций. |                                       |

### Особые возможности

#### Интеграция с буфером обмена (`$$`)

Чтобы использовать текст из буфера обмена, используйте маркер `$$`.

**Пример:** Скопируйте блок кода, затем выполните:
```
> code $$
```

#### ~~Принудительный запрос (`--force` или `-f`)~~ Отключен

~~Чтобы обойти кеш, добавьте флаг `--force` или `-f` в конец вашего запроса.~~ **Кеширование отключено** - все запросы выполняются в live режиме.

**Флаги парсятся, но игнорируются:**
```
> rr Hello, world! --force  # работает как обычный запрос
```

---

## Для разработчиков: Как добавить новую команду

Приложение использует интерактивную систему управления командами с хранением в SQLite базе данных.

1. Запустите интерактивный менеджер команд:
   ```bash
   cmd
   ```
   Или на русском языке:
   ```bash
   кмд
   ```

2. Выберите "Add command" в главном меню.

3. Следуйте интерактивным подсказкам для настройки:
   - **Ключи команд**: Текстовые триггеры, активирующие команду (например, `gg`, `rr`, `translate`)
   - **Описание команды**: Краткое объяснение функций команды
   - **ИИ-инструкция**: Полный промпт, отправляемый ИИ-модели
   - **Целевые модели**: По желанию укажите, какие модели могут использовать команду
   - **Отмена/Повтор**: Система поддерживает откат операций

4. Ваша команда немедленно становится доступной для всех провайдеров и моделей.

Интерактивная система также поддерживает редактирование, удаление и массовые операции с существующими командами.

## Лицензия

Этот проект лицензирован по лицензии MIT. Подробности см. в файле `LICENSE`.

</details>

<details>
<summary>中文 (Chinese)</summary>
<a name="chinese"></a>

# 控制台 AI 助手

一个命令行工具，用于与 AI 提供商（OpenAI、DeepSeek）交互，旨在直接在终端使用大型语言模型。它包含命令模板、在不同 AI 提供商及其模型之间切换的功能，以及 **MCP（模型上下文协议）集成**，用于网页内容提取。

## 功能

- **多提供商支持**：可在 OpenAI 和 DeepSeek 间自由切换。
- **模型选择**：列出并选择所选提供商的所有可用模型。
- **~~智能缓存~~ 已禁用**：缓存系统暂时禁用 - 所有请求均为实时请求。
- **~~强制刷新~~ 已禁用**：--force/-f 标志被解析但忽略（缓存已禁用）。
- **请求取消**：按下 Esc 可中断长时间运行或不需要的 API 调用。
- **剪贴板集成**：在提示中使用 `$$` 令牌插入剪贴板内容。
- **上下文对话**：保存会话历史，支持连贯的多轮对话（针对非翻译查询）。
- **跨平台**：在 macOS（已测试）、Linux 和 Windows（待测试）上均可运行。

## 安装要求

1. 软件
   - **Node.js**：需使用 22.x 或更高版本。
   - **npm**：随 Node.js 一同安装，用于包管理。
   - **Git**：用于克隆仓库。
   - **（仅限 Linux）xclip**：在 Linux 下实现剪贴板支持。可通过包管理器安装（例如 `sudo apt-get install xclip`）。

2. 技能
   - 具备基本的命令行（终端）操作经验。

## 安装与设置

1. 克隆仓库：
   ```bash
   git clone https://github.com/timashoff/openai-cli-2.git
   cd openai-cli-2
   ```

2. 全局安装依赖，使该工具在系统范围内可用：
   ```bash
   npm i -g
   ```

3. 配置 API 密钥，可选两种方式：

   方法一：使用 `.env` 文件（项目本地）
   - 在项目根目录创建 `.env` 文件。
   - 添加以下内容：
     ```env
     # 在此生成： https://platform.openai.com
     OPENAI_API_KEY="sk-OpenAI_API_Key"

     # 在此生成： https://platform.deepseek.com/api_keys
     DEEPSEEK_API_KEY="sk-DeepSeek_API_Key"
     ```
   - 默认 `.env` 已加入 `.gitignore`，密钥不会被提交。

   方法二：环境变量（推荐）
   - macOS/Linux + Zsh：
     1. 打开 `~/.zshrc`。
     2. 添加：
        ```bash
        export OPENAI_API_KEY="sk-OpenAI_API_Key"
        export DEEPSEEK_API_KEY="sk-DeepSeek_API_Key"
        ```
     3. 运行 `source ~/.zshrc`。
   - macOS/Linux + Bash：
     1. 打开 `~/.bash_profile` 或 `~/.bashrc`。
     2. 添加相同的 `export` 行。
     3. 运行 `source ~/.bash_profile`（或 `~/.bashrc`）。

## 运行程序

在项目文件夹下执行：
```bash
node bin/app.js
```
若已全局安装（`npm i -g`），只需输入：
```bash
ai
```

## 工作原理

1. **提供商选择**：启动时（或执行 `provider` 命令）选择已配置的 AI 提供商。
2. **模型加载**：工具获取并显示该提供商的所有可用模型。
3. **用户输入**：表现为一个聊天界面。
4. **命令处理**：
   - **系统命令**（`help`、`model`、`provider`、`exit`）在本地执行。
   - **翻译命令**（例如 `rr`, `ee` 等）直接发送给 API（缓存已禁用）。
   - **普通对话**（除翻译外的任何输入）连同当前对话上下文发送给 API。
5. **流式响应**：AI 回复实时流入；按 Esc 可中断。
6. **清除上下文**：输入空行可清除会话上下文，避免切换话题时触及 token 限制。
7. **全屏清空**：连续两次按回车既清空上下文，也清屏（可向上滚动查看历史答案）。

## 命令及用法

系统命令：
- help    — 显示所有可用命令及用法
- provider — 切换 AI 提供商
- model   — 列出并选择不同模型
- cmd, кмд — 交互式命令管理器，用于添加/编辑/删除用户命令
- exit    — 退出应用

指令命令（翻译及其他任务）：
- gg / -g / :g     — 语法检查和纠正
  示例：`gg i can has cheezburger?`
- rr / рр / ру     — 翻译成俄语
  示例：`rr Hello, my friend.`
- ee / аа / aa     — 翻译成英语
  示例：`ee Привет, мой друг.`
- cc / сс / кк     — 翻译成中文
  示例：`cc Hello, my friend.`
- code            — 代码审查（查错并提升质量）
  示例：`code const x = 1;`
- …更多命令请使用 `help` 查看完整列表。

## 特殊功能

- 剪贴板集成 (`$$`)：在提示中使用 `$$` 可自动粘贴剪贴板内容。
  示例：
  ```
  > code $$
  ```
- ~~强制请求 (`--force` 或 `-f`)~~ 已禁用：标志被解析但忽略（缓存已禁用）。

## 开发者：添加新命令

应用程序使用具有 SQLite 数据库存储的交互式命令管理系统。

1. 运行交互式命令管理器：
   ```bash
   cmd
   ```
   或俄语版本：
   ```bash
   кмд
   ```

2. 从主菜单选择 "Add command"。

3. 按照交互式提示进行配置：
   - **命令键**：激活命令的文本触发器（例如 `gg`、`rr`、`translate`）
   - **命令描述**：命令功能的简要说明
   - **AI 指令**：发送给 AI 模型的完整提示
   - **目标模型**：可选择指定哪些模型可以使用此命令
   - **撤销/重做**：系统支持操作回滚

4. 您的命令立即可用于所有提供商和模型。

交互式系统还支持编辑、删除现有命令以及批量操作。

## 许可证

本项目遵循 MIT 许可证。详情请参见 `LICENSE` 文件。

</details>
