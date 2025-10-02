# Responses API Migration Plan

## Objectives
- Replace legacy `chat.completions` usage with the Responses API for every user command.
- Convert all instruction commands into agent-driven workflows backed by reusable profiles.
- Preserve existing CLI experience: streaming output, ESC cancellation, context history, `cmd` editor.
- Keep implementation modular and compliant with the project rules in `CLAUDE.md` (Single Source of Truth, no hardcode, no legacy layers).

## Current Architecture Snapshot
- Commands are stored in `db/commands.db` and loaded via `services/database-command-service.js`.
- `services/input-processing/index.js` resolves commands and returns synthesized `instruction` strings.
- `core/Router.js` routes to `core/response/single.js` → `stateManager.createChatCompletion()` → `client.chat.completions.create`.
- Context history is handled by `utils/context-utils.js` and reused through `prepareStreamingMessages`.
- There is no dedicated notion of agent profiles; instructions live in the DB alongside the trigger key.

## Migration Steps

### 1. Extend Command Schema
- Add columns `command_type` (default `agent`), `agent_profile_id`, `input_mode` to the SQLite schema.
- Update `services/database-command-service.js` to read/write the new fields and keep UPSERT logic aligned with `COMMANDS_SCHEMA`.
- Migrate existing rows: set `command_type = 'agent'`, persist original `instruction` text into temporary JSON so nothing is lost.
- Adjust `cmd` UI (`commands/system/cmd/*`) to expose the new fields when creating or editing commands, and validate that an agent profile exists.

### 2. Introduce Agent Profiles
- Create `config/agents/` with one JSON file per command (e.g., `config/agents/DOC.json`). Each file contains:
  ```json
  {
    "id": "DOC",
    "model": "gpt-5-mini",
    "instructions": "...",
    "tools": [],
    "metadata": {}
  }
  ```
- Build `core/agents/profile-loader.js` that loads and validates these JSON files at startup (Single Source of Truth).
- Expose `agentProfileService` via `core/StateManager` with methods `loadProfiles`, `getProfile(id)`, and reload hooks for future hot updates.
- Update `cmd` UI to preview the profile summary so users understand what a command will trigger.

### 3. Wire Responses API Support
- Add `prepareResponseInput(history, userText)` in `utils/message-utils.js` to transform `contextHistory` into Responses-compatible input:
  ```js
  [{
    role: 'user',
    content: [{ type: 'input_text', text }],
  }]
  ```
- Implement `stateManager.createResponseStream({ profile, userInput, signal })`:
  1. Build the `input` array from context.
  2. Call `client.responses.stream({ model: profile.model, input, instructions: profile.instructions, tools: profile.tools })`.
  3. Bridge streaming events to the CLI (`response.output_text.delta`, `response.completed`, `response.function_call_arguments.delta`, ...).
  4. Respect `AbortController` for ESC cancellation; swallow `APIUserAbortError` silently.
- Create `core/response/responses-agent.js` that wraps the stream runner, writes chunks via `outputHandler`, and calls `updateContext` with the final text.

### 4. Update Router and Handlers
- Extend `services/input-processing/index.js` so it returns `{ executionMode: 'agent', agentProfileId, userInput }` without concatenating instruction text.
- Modify `core/Router.js` to branch on `executionMode` and route agent commands to the new handler.
- Keep `singleModelCommand` for future compatibility but mark it as deprecated in comments.

### 5. Migrate All Commands
- For every command in the database:
  1. Create a matching profile JSON in `config/agents/` with the previous instruction text and desired model.
  2. Run a migration script (or manual SQL) to update `command_type`, `agent_profile_id`, and clear the old `instruction` field (or keep for historical reference until cleanup).
  3. Verify the `cmd` editor shows the profile linkage and that `help`/`help -a` reflect the new state.
- Remove any code paths that rely on legacy instruction concatenation once migration is complete.

### 6. Testing Checklist
- **Automated**: add unit tests for `prepareResponseInput` and `stateManager.createResponseStream` using mocked Responses events.
- **Manual**:
  - Smoke test core commands (`DOC`, `CHINESE`, `GRAMMAR`, `CODE`, translations) to confirm streaming and cancellation.
  - Trigger ESC during a long response to ensure graceful abort without errors.
  - Clear context with an empty line and verify the next call starts fresh.
  - Run `cmd`, edit a command, and confirm profile validation catches missing IDs.

### 7. Cleanup and Documentation
- Delete unused helpers: `prepareStreamingMessages`, OpenAI provider `createChatCompletion`, multi-model handlers if irrelevant.
- Update `README.md`, `AGENTS.md`, and `help` output to reflect the new agent-based workflow.
- Lock `openai` version to `^6.0.1` (already in `package.json`) and regenerate `package-lock.json` after removing legacy imports.
- Document the rollout plan: deploy in a feature branch, QA, then merge to main.

## Additional Notes
- Responses API emits richer events (reasoning, function calls). Keep the stream handler extensible so we can surface these features later.
- Store only English instructions/logs, per project guidelines.
- Avoid duplicating profile data between JSON and DB. The DB references profile IDs; JSON holds the authoritative configuration.
- If future providers appear, wrap Responses calls behind a provider-agnostic interface to maintain modularity.
