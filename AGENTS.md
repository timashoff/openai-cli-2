# Repository Guidelines

## Project Structure & Module Organization
- `bin/app.js` bootstraps the CLI and composes router, state manager, and application loop.
- `core/` hosts routing, print, error, and `application-loop/`; `core/response/` centralizes chat, single/multi-model handlers, and the shared stream runner, `commands/system/` covers system verbs.
- `services/` preprocess input and expose SQLite-backed services (`DatabaseCommandService`, `AgentProfileService`); `config/` stores provider constants; `utils/` держат общий код.
- `db/commands.db` seeds instruction shortcuts consumed during routing.

## Business Logic & Architecture
- Functional factories keep dependencies explicit and modules pure.
- Execution path: application loop → `Router` dictionary dispatch → handlers → state manager for provider-agnostic streaming.
- `InputProcessingService` resolves clipboard `$$` tokens and loads command definitions before routing.
- Multi-model commands (in `core/response/multi-model/`) use `Promise.allSettled`: the leader streams live, followers buffer and render after settling.
- Caching is off; future history features must stay opt-in.

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
- Run `npm start` manually before submitting.
- Add automated specs beside the code (e.g., `tests/`) and wire them to a future `npm test` script.
- For DB changes, inspect `db/commands.db` with `sqlite3` and replay representative flows.

## Commit & Pull Request Guidelines
- Commits follow `type: short summary` (`refactor:`, `docs:`, `release:`) in imperative mood.
- PRs outline intent, bullet key changes, cite manual tests, link issues, and attach UX evidence.

## Configuration & Secrets
- Provider credentials live in env vars from `config/providers.js` (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`); never commit secrets.
- Store overrides in shell profiles or ignored `.env` files and document default tweaks.
- When editing SQLite schema or seeds, note regeneration steps and keep migrations repeatable.
