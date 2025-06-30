[English](#english) | [Русский](#russian) | [中文](#chinese)

<details open>
<summary>English</summary>
<a name="english"></a>

# AI Command-Line Assistant

A versatile and powerful command-line interface (CLI) tool for interacting with multiple AI providers, including OpenAI and DeepSeek. This tool is designed for developers, writers, and anyone who wants to leverage the power of large language models directly from their terminal.

It features a context-aware chat mode, a robust caching system for translation commands, and the flexibility to switch between models and providers on the fly.

## Features

- **Multi-Provider Support:** Seamlessly switch between OpenAI and DeepSeek at any time.
- **Model Selection:** Choose from a list of all available models from the selected provider.
- **Intelligent Caching:** Translation requests are cached locally to save API costs and provide instant responses for repeated queries.
- **Force Request:** Bypass the cache to get a fresh response from the AI model using the `--force` or `-f` flag.
- **Request Cancellation:** Cancel any in-progress API request by simply pressing the `Esc` key.
- **Clipboard Integration:** Easily include the contents of your clipboard in a prompt using the `$$` marker.
- **Context-Aware Chat:** Maintains a conversation history for fluid, multi-turn dialogues (non-translation queries).
- **Cross-Platform:** Works on macOS, Linux, and Windows.

## Requirements

### 1. Software
- **Node.js:** Version 18.x or higher is recommended.
- **npm:** Comes bundled with Node.js. Used for package management.
- **Git:** For cloning the repository.
- **(Linux Only) xclip:** The clipboard functionality on Linux depends on this utility. You can install it with your package manager, e.g., `sudo apt-get install xclip`.

### 2. Skills
- Basic familiarity with the command line (terminal).
- A text editor to create and edit configuration files.
- No advanced programming skills are required to use the tool.

## Installation & Configuration

1.  **Clone the Repository:**
    Open your terminal and run the following command to clone the project to your local machine:
    ```bash
    git clone https://github.com/your-username/openai-cli-2.git
    cd openai-cli-2
    ```

2.  **Install Dependencies:**
    Run the following command to install the necessary Node.js packages:
    ```bash
    npm install
    ```

3.  **Set Up API Keys:**
    You have two methods to configure your API keys.

    ### Method 1: Using a `.env` File
    This method is simple and keeps your keys within the project directory.

    - Create a new file named `.env` in the root of the project directory.
    - Open the `.env` file with a text editor and add your API keys in the following format:

    ```env
    # .env file

    # Get from: https://platform.openai.com/api-keys
    OPENAI_API_KEY="sk-YourOpenAI_API_KeyHere"

    # Get from: https://platform.deepseek.com/api_keys
    DEEPSEEK_API_KEY="sk-YourDeepSeek_API_KeyHere"
    ```
    **Important:** The `.env` file is included in `.gitignore`, so your secret keys will never be accidentally committed to Git.

    ### Method 2: Using Environment Variables (Recommended)
    This method makes your keys available globally in your terminal, which is more secure and flexible.

    - **For macOS/Linux (Zsh):**
        1. Open your Zsh configuration file: `open ~/.zshrc`
        2. Add the following lines to the end of the file:
           ```bash
           export OPENAI_API_KEY="sk-YourOpenAI_API_KeyHere"
           export DEEPSEEK_API_KEY="sk-YourDeepSeek_API_KeyHere"
           ```
        3. Save the file and apply the changes by running: `source ~/.zshrc`

    - **For macOS/Linux (Bash):**
        1. Open your Bash configuration file (`~/.bash_profile` or `~/.bashrc`): `open ~/.bash_profile`
        2. Add the following lines:
           ```bash
           export OPENAI_API_KEY="sk-YourOpenAI_API_KeyHere"
           export DEEPSEEK_API_KEY="sk-YourDeepSeek_API_KeyHere"
           ```
        3. Save and apply the changes: `source ~/.bash_profile`

## How to Run the Program

Once the installation and configuration are complete, you can start the application by running:

```bash
node bin/app.js
```

## How It Works

The application operates in a simple but powerful loop:

1.  **Provider Selection:** On the first run (and whenever you use the `provider` command), you will be prompted to choose between the configured AI providers.
2.  **Model Loading:** The application fetches and lists all available models from the selected provider.
3.  **User Input:** You can then type your questions or commands.
4.  **Command Handling:**
    - **System Commands** (`help`, `model`, `provider`, `exit`) are executed directly.
    - **Translation Commands** (`rr`, `ee`, etc.) first check the local cache.
        - If a response is found, it's returned instantly with a `[from cache]` notice.
        - If not, a request is sent to the API, and the response is saved to the cache.
    - **General Chat** (any other input) is sent to the API along with the history of the current conversation to provide context. These responses are not cached.
5.  **Response Streaming:** The AI's response is streamed to your terminal in real-time.

---

## Commands and Usage

### System Commands

| Command    | Description                                  |
| :--------- | :------------------------------------------- |
| `help`     | Displays the help message with all commands. |
| `provider` | Allows you to switch the AI provider.        |
| `model`    | Lists available models and prompts to select a new one. |
| `exit`     | Closes the application.                      |

### Prompting Commands (Instructions)

To use a prompting command, type the command's key followed by your text.

| Command Keys       | Description                     | Example                               |
| :----------------- | :------------------------------ | :------------------------------------ |
| `gg`, `-g`, `:g`   | Checks and corrects grammar.    | `gg i can has cheezburger?`           |
| `rr`, `рр`, `ру`   | Translates text to Russian.     | `rr Hello, my friend.`                |
| `ee`, `аа`, `aa`   | Translates text to English.     | `ee Привет, мой друг.`                |
| `cc`, `сс`, `кк`   | Translates text to Chinese.     | `cc Hello, my friend.`                |
| `code`             | Reviews code for errors and quality. | `code const x = 1;`                |
| ...and many more! | Use the `help` command to see all available instructions. |                                       |

### Special Features

#### Clipboard Integration (`$$`)

To use the text currently in your clipboard as part of your prompt, use the `$$` marker.

**Example:** Copy a block of code to your clipboard, then run:
```
> code $$
```

#### Forcing a Fresh Request (`--force` or `-f`)

To bypass the cache and force a new API request, end your prompt with the `--force` or `-f` flag.

**Example:**
```
> rr Hello, world! --force
```
This will send a new request to the API and overwrite the previous entry in the cache.

---

## For Developers: How to Add a New Command

1.  Open the `config/instructions.js` file.
2.  Add a new entry to the `INSTRUCTIONS` object.
    ```javascript
    YOUR_NEW_COMMAND: {
      key: ['-yourkey', ':yourkey'],
      description: 'A brief description of what it does.',
      instruction: 'The full instruction to be sent to the AI model.',
    },
    ```

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

</details>

<details>
<summary>Русский</summary>
<a name="russian"></a>

# Консольный ИИ-Ассистент

Универсальный и мощный инструмент командной ��троки (CLI) для взаимодействия с несколькими ИИ-провайдерами, включая OpenAI и DeepSeek. Этот инструмент предназначен для разработчиков, писателей и всех, кто хочет использовать возможности больших языковых моделей прямо в терминале.

Он включает в себя контекстно-зависимый режим чата, надежную систему кеширования для команд перевода и гибкость для переключения между моделями и провайдерами "на лету".

## Возможности

- **Поддержка нескольких провайдеров:** Легко переключайтесь между OpenAI и DeepSeek в любое время.
- **Выбор модели:** Выбирайте из списка всех доступных моделей от выбранного провайдера.
- **Интеллектуальное кеширование:** Запросы на перевод кешируются локально для экономии затрат на API и предоставления мгновенных ответов на повторные запрос��.
- **Принудительный запрос:** Обходите кеш, чтобы получить свежий ответ от ИИ-модели, используя флаг `--force` или `-f`.
- **Отмена запроса:** Отмените любой выполняющийся запрос к API, просто нажав клавишу `Esc`.
- **Интеграция с буфером обмена:** Легко включайте содержимое буфера обмена в свой запрос с помощью маркера `$$`.
- **Контекстный чат:** Сохраняет историю разговора для плавных, многоэтапных диалогов (для запросов, не являющихся переводом).
- **Кроссплатформенность:** Работает на macOS, Linux и Windows.

## Требования

### 1. Программное обеспечение
- **Node.js:** Рекомендуется версия 18.x или выше.
- **npm:** Поставляется вместе с Node.js. Используется для управления пакетами.
- **Git:** Для клонирования репозитория.
- **(Только для Linux) xclip:** Функциональность буфера обмена в Linux зависит от этой утилиты. Вы можете установить ее с помощью вашего менеджера пакетов, например, `sudo apt-get install xclip`.

### 2. Навыки
- Базовое знакомство с командной строкой (терминалом).
- Текстовый редактор для создания и редактирования конфигурационных файлов.
- Для использования инструмента не требуются продвинутые навыки программирования.

## Установка и настройка

1.  **Клонирование репозитория:**
    Откройте терминал и выполните следующую команду, чтобы клонировать проект на ваш локальный компьютер:
    ```bash
    git clone https://github.com/your-username/openai-cli-2.git
    cd openai-cli-2
    ```

2.  **Установка зависимостей:**
    Выполните следующую команду для установки необходимых пакетов Node.js:
    ```bash
    npm install
    ```

3.  **Настройка API-ключей:**
    У вас есть два способа настроить ваши API-ключи.

    ### Метод 1: Использование файла `.env`
    Этот метод прост и хранит ваши ключи в каталоге проекта.

    - Создайте новый файл с именем `.env` в корневом каталоге проекта.
    - Откройте файл `.env` в текстовом редакторе и добавьте ваши API-ключи в следующем формате:

    ```env
    # Файл .env

    # Получить здесь: https://platform.openai.com/api-keys
    OPENAI_API_KEY="sk-Ваш_OpenAI_API_Ключ"

    # Получить здесь: https://platform.deepseek.com/api_keys
    DEEPSEEK_API_KEY="sk-Ваш_DeepSeek_API_Ключ"
    ```
    **Важно:** Файл `.env` включен в `.gitignore`, поэтому ваши секретные ключи никогда не будут случайно отправлены в Git.

    ### Метод 2: Использование переменных окружения (Рекомендуется)
    Этот метод делает ваши ключи доступными глобально в вашем терминале, что более безопасно и гибко.

    - **Для macOS/Linux (Zsh):**
        1. Откройте ваш конфигурацион��ый файл Zsh: `open ~/.zshrc`
        2. Добавьте следующие строки в конец файла:
           ```bash
           export OPENAI_API_KEY="sk-Ваш_OpenAI_API_Ключ"
           export DEEPSEEK_API_KEY="sk-Ваш_DeepSeek_API_Ключ"
           ```
        3. Сохраните файл и примените изменения, выполнив: `source ~/.zshrc`

    - **Для macOS/Linux (Bash):**
        1. Откройте ваш конфигурационный файл Bash (`~/.bash_profile` или `~/.bashrc`): `open ~/.bash_profile`
        2. Добавьте следующие строки:
           ```bash
           export OPENAI_API_KEY="sk-Ваш_OpenAI_API_Ключ"
           export DEEPSEEK_API_KEY="sk-Ваш_DeepSeek_API_Ключ"
           ```
        3. Сохраните и примените изменения: `source ~/.bash_profile`

## Как запустить программу

После завершения установки и настройки вы можете запустить приложение, выполнив:

```bash
node bin/app.js
```

## Как это работает

Приложение работает в простом, но мощном цикле:

1.  **Выбор провайдера:** При первом запус��е (и всякий раз, когда вы используете команду `provider`) вам будет предложено выбрать между настроенными ИИ-провайдерами.
2.  **Загрузка моделей:** Приложение загружает и отображает список всех доступных моделей от выбранного провайдера.
3.  **Ввод пользователя:** Вы можете вводить свои вопросы или команды.
4.  **Обработка команд:**
    - **Системные команды** (`help`, `model`, `provider`, `exit`) выполняются напрямую.
    - **Команды перевода** (`rr`, `ee` и т.д.) сначала проверяют локальный кеш.
        - Если ответ найден в кеше, он возвращается мгновенно с пометкой `[from cache]`.
        - В противном случае отправляется запрос к API, и ответ сохраняется в кеш.
    - **Общий чат** (любой другой ввод) отправляется в API вм��сте с историей текущего разговора для предоставления контекста. Эти ответы не кешируются.
5.  **Потоковая передача ответа:** Ответ ИИ передается в ваш терминал в режиме реального времени.

---

## Команды и использование

### Системные команды

| Команда    | Описание                                     |
| :--------- | :------------------------------------------- |
| `help`     | Отображает справочное сообщение со всеми командами. |
| `provider` | Позволяет переключить ИИ-провайдера.         |
| `model`    | Показывает доступные модели и предлагает выбрать новую. |
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

#### Принудительный запрос (`--force` или `-f`)

Чтобы обойти кеш, добавьте флаг `--force` или `-f` в конец вашего запроса.

**Пример:**
```
> rr Hello, world! --force
```
Это отправит новый запрос к API и перезапишет предыдущую запись в кеше.

---

## Для разработчиков: Как добавить новую команду

1.  Откройте файл `config/instructions.js`.
2.  Добавьте новую запись в объект `INSTRUCTIONS`.
    ```javascript
    YOUR_NEW_COMMAND: {
      key: ['-yourkey', ':yourkey'],
      description: 'Краткое описание того, что она делает.',
      instruction: 'Полная инструкция для отправки ИИ-модели.',
    },
    ```

## Лицензия

Этот проект лицензирован по лицензии MIT. Подробности см. в файле `LICENSE`.

</details>

<details>
<summary>中文 (Chinese)</summary>
<a name="chinese"></a>

# AI 命令行助手

一个功能多样且强大的命令行界面（CLI）工具，用于与包括 OpenAI 和 DeepSeek 在内的多个 AI 提供商进行交互。该工具专为开发人员、作家以及任何希望直接从终端利用大型语言模型强大功能的用户而设计。

它具有上下文感知聊天模式、针对翻译命令的强大缓存系统，以及随时切换模型和提供商的灵活性。

## 功能特性

- **多���供商支持:** 随时在 OpenAI 和 DeepSeek 之间无缝切换。
- **模型选择:** 从所选提供商的所有可用模型列表中进行选择。
- **智能缓存:** 本地缓存翻译请求，以节省 API 成本并为重复查询提供即时响应。
- **强制请求:** 使用 `--force` 或 `-f` 标志绕过缓存，从 AI 模型获取全新响应。
- **请求取消:** 只需按 `Esc` 键即可取消任何正在进行的 API 请求。
- **剪贴板集成:** 使用 `$$` 标记轻松将剪贴板内容包含在提示中。
- **上下文感知聊天:** 为流畅的多轮对话（非翻译查询）维护对话历史。
- **跨平台:** 可在 macOS、Linux 和 Windows 上运行。

## 要求

### 1. 软件
- **Node.js:** 推荐使用 18.x 或更高版本。
- **npm:** 与 Node.js 捆绑在一起。用于包管理。
- **Git:** 用于克隆仓库。
- **(仅限 Linux) xclip:** Linux 上的剪贴板功能依赖于此实用程序。您可以使用包管理器进行安装，例如 `sudo apt-get install xclip`。

### 2. 技能
- 熟悉命令行（终端）的基本操作。
- 用于创建和编辑配置文件的文本编辑器。
- 使用该工具无需高级编程技能。

## 安装与配置

1.  **克隆仓库:**
    打开终端并运行以下命令将项目克隆到本地计算机：
    ```bash
    git clone https://github.com/your-username/openai-cli-2.git
    cd openai-cli-2
    ```

2.  **安装依赖:**
    运行以下命令安装必需的 Node.js 包：
    ```bash
    npm install
    ```

3.  **设置 API 密钥:**
    您有两种方法来配置您的 API 密钥。

    ### 方法一：使用 `.env` 文件
    此方法简单，并将密钥保留在项目目录中。

    - 在项目根目录中创建一个名为 `.env` 的新文件。
    - 使用文本编辑器打开 `.env` 文件，并按以下格式添加您的 API 密钥：

    ```env
    # .env 文件

    # 获取地址: https://platform.openai.com/api-keys
    OPENAI_API_KEY="sk-你的OpenAI_API密钥"

    # 获取地址: https://platform.deepseek.com/api_keys
    DEEPSEEK_API_KEY="sk-你的DeepSeek_API密钥"
    ```
    **重要提示:** `.env` 文件已包含在 `.gitignore` 中，因此您的密钥不会被意外提交到 Git。

    ### 方法二：使用环境变量（推荐）
    此方法使您的密钥在终端中全局可用，更安全、更灵活。

    - **对于 macOS/Linux (Zsh):**
        1. 打开您的 Zsh 配置文件: `open ~/.zshrc`
        2. 将以下行添加到文件末尾:
           ```bash
           export OPENAI_API_KEY="sk-你的OpenAI_API密钥"
           export DEEPSEEK_API_KEY="sk-你的DeepSeek_API密钥"
           ```
        3. 保存文件并通过运行 `source ~/.zshrc` 应用更改。

    - **对于 macOS/Linux (Bash):**
        1. 打开您的 Bash 配置文件 (`~/.bash_profile` 或 `~/.bashrc`): `open ~/.bash_profile`
        2. 添加以下行:
           ```bash
           export OPENAI_API_KEY="sk-你的OpenAI_API密钥"
           export DEEPSEEK_API_KEY="sk-你的DeepSeek_API密钥"
           ```
        3. 保存并应用更改: `source ~/.bash_profile`

## 如何运行程序

安装和配置完成后，您可以通过运行以下命令来启动应用程序：

```bash
node bin/app.js
```

## 工作原理

该应用程序在一个简单而强大的循环中运行：

1.  **提供商选择:** 首次运行（以及每当您使用 `provider` 命令时），系统会提示您在配置的 AI 提供商之间进行选择。
2.  **模型加载:** 应用程序会从所选提供商处获取并列出所有可用模型。
3.  **用户输入:** 然后您可以输入您的问题或命令。
4.  **命令处理:**
    - **系统命令** (`help`, `model`, `provider`, `exit`) 会被直接执行。
    - **翻译命令** (`rr`, `ee` 等) 会首先检查本地缓存。
        - 如果在缓存中找到响应，它会立即返回并附带 `[from cache]` 通知。
        - 如果没有，则向 API 发送请求，并将响应保存到缓存中。
    - **通用聊天** (任何其他输入) 会连同当前对话的历史记录一起发送到 API 以提供上下文。这些响应不会被缓存。
5.  **响应流式传输:** AI 的响应会实时流式传输到您的终端。

---

## 命令与用法

### 系统命令

| 命令       | 描述                                         |
| :--------- | :------------------------------------------- |
| `help`     | 显示包含所有命令的帮助信息。                 |
| `provider` | 允许您切换 AI 提供商。                       |
| `model`    | 列出可用模型并提示选择新模型。               |
| `exit`     | 关闭应用程序。                               |

### 提示命令 (指令)

| 命令键             | 描述                            | 示例                                  |
| :----------------- | :------------------------------ | :------------------------------------ |
| `gg`, `-g`, `:g`   | 检查并纠正语法。                | `gg i can has cheezburger?`           |
| `rr`, `рр`, `ру`   | 将文本翻译成俄语。              | `rr Hello, my friend.`                |
| `ee`, `аа`, `aa`   | 将文本翻译成英语。              | `ee Привет, мой друг.`                |
| `cc`, `сс`, `кк`   | 将文本翻译成中文。              | `cc Hello, my friend.`                |
| `code`             | 检查代码的错误和质量。          | `code const x = 1;`                |
| ...还有更多!       | 使用 `help` 命令查看所有可用指令。 |                                       |

### 特殊功能

#### 剪贴板集成 (`$$`)

要使用剪贴板中的文本，请使用 `$$` 标记。

**示例:** 复制一段代码，然后运行：
```
> code $$
```

#### 强制刷新请求 (`--force` 或 `-f`)

要绕过缓存，请在提示末尾添加 `--force` 或 `-f` 标志。

**示例:**
```
> rr Hello, world! --force
```
这将向 API 发送一个新请求，并覆盖缓存中的旧条目。

---

## 开发者指南：如何添加新命令

1.  打开 `config/instructions.js` 文件。
2.  向 `INSTRUCTIONS` 对象添加一个新条目。
    ```javascript
    YOUR_NEW_COMMAND: {
      key: ['-yourkey', ':yourkey'],
      description: '功能的简要描述。',
      instruction: '要发送给 AI 模型的完整指令。',
    },
    ```

## 许可证

该项目根据 MIT 许可证授权。有关详细信息，请参阅 `LICENSE` 文件。

</details>