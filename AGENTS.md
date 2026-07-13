# Repository Guidelines

## Project Structure & Module Organization
- `bin/app.js` bootstraps the CLI and composes router, state manager, and application loop.
- `core/` hosts routing, print, error, and `application-loop/`; `core/response/` centralizes chat, single/multi-model handlers, and the shared stream runner, `commands/system/` covers system verbs.
- `services/` holds `commands/` (TOML store + per-record sync), `config/` (provider overlay + gateway), `sessions/` (saved conversations) and `dialogue/` (dialogue-mode settings); `config/` stores provider and app constants; `utils/` holds shared helpers.
- Instruction commands live in `~/.openai-cli/commands.toml` (shipped defaults in `config/commands-default.toml`), edited via `cmd` and synced through the gateway. The old SQLite store and its `cmd/` editing tree were deleted in Phase 2 — do not reintroduce them.
- `gateway/` is a zero-dependency Node forwarder deployed on the owner's VPS: it holds the real provider keys, authenticates with email+password+OTP, and carries the per-record sync substrate.

## Business Logic & Architecture
- Functional factories keep dependencies explicit and modules pure.
- Execution path: application loop → `Router` dictionary dispatch (SYSTEM → INSTRUCTION → CHAT) → handlers → state manager for provider-agnostic streaming.
- `InputProcessingService` resolves clipboard `$$` tokens and loads command definitions before routing.
- Multi-model commands (in `core/response/multi-model/`) run concurrently: a coordinator lets the first model to emit content stream live, while the others buffer and render after.
- The OpenAI provider speaks the **Responses API** (`config/providers.js` → `api: 'responses'`). Interactive chat chains turns with `previous_response_id` (a `∞` marker replaces the context dots when the chain is armed); one-shot and stateless commands do not.
- `dd` (dialogue-translation mode) pins **its own provider and model** via the `providerModel` seam, which routes without touching global state — entering it must never disturb the user's selected provider.
- A mode (`core/application-loop`) can capture REPL lines instead of the Router; `dd` is its first user.

## Development Principles
- Avoid hardcoded values; centralize shared constants and config.
- Prefer simple data structures over complex regex; colocate utilities unless reused widely.
- Enforce KISS/DRY/YAGNI, Single Responsibility, and Single Source of Truth across modules.
- Comments, logs, and user messaging stay in English with an i18n-ready design.
- Search for existing logic before building new features and extend instead of duplicating.

## Build, Test & Development Commands
- `npm install` — refresh dependencies after lockfile updates.
- `npm start` — run the CLI entrypoint.
- `npm run dev` — watch mode; add `NODE_OPTIONS=--inspect` for debugging.

## Coding Style & Naming Conventions
- Use 2-space indentation, ES modules, and `const` defaults; export factories as `createX`, constants in SCREAMING_SNAKE_CASE.
- Favor dependency injection to keep modules pure; avoid hidden imports.
- Send instrumentation through `utils/logger.js`; skip raw `console.log`.

## Testing Guidelines
- There is no unit-test suite by design ("tests only when the program is stable for production"). Verification is a **live drive**: run the real CLI, and drive the REPL through a pty (`expect`, or `script -q /dev/null node bin/app.js`) — see `.claude/skills/verify/SKILL.md`.
- Prefer a stub-provider harness for wire-protocol claims (what options actually reach the API) and a live gateway run for behaviour.
- Terminal rendering must be verified by **simulating the terminal** (honour `\r` and clear-to-end), not by substring-matching the byte stream — a regex happily matches text that is visually mangled.

## Commit & Pull Request Guidelines
- Commits follow `type: short summary` (`refactor:`, `docs:`, `release:`) in imperative mood.
- PRs outline intent, bullet key changes, cite manual tests, link issues, and attach UX evidence.

## Configuration & Secrets
- Providers are reachable two ways: a direct env key (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) or a **gateway session** — `ai login` stores an opaque 90-day token in `~/.openai-cli/credentials.toml` and the real keys stay on the VPS. Never commit secrets; never log them.
- User overrides live in `~/.openai-cli/config.toml` (`[providers.<id>]`: `baseURL`, `token`, `api`), validated against a whitelist in `services/config/validate.js`.
- Dialogue-mode defaults persist in `~/.openai-cli/dialogue.json`; saved conversations in `~/.openai-cli/sessions/`.
