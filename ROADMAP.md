# Roadmap

**Current release: v6.5.0.** This file supersedes `ROADMAP_NEW.md`, which planned an MCP integration
that has since been explicitly vetoed and described as "next" work that is already shipped.

---

## Binding decisions — do not re-litigate

- **No MCP in the CLI.** Ultra-complex tasks (web search, images) belong in the Claude app. The CLI
  stays small and fast. `@modelcontextprotocol/sdk` was removed and must not come back.
- **The Tauri GUI is decided, not optional.** Editing more than two lines in a terminal is the pain
  that drives it. Killer feature: a global hotkey + Apple Shortcuts (translate the selected text).
- **A Rust rewrite is LAST**, after cleanup, TOML, and the GUI.
- **DeepSeek connects directly; OpenAI and Anthropic route through the VPS gateway** (that is why the
  gateway exists — no VPN).
- Engineering rules (functional only, no classes/`switch`/optional chaining, dictionaries over regex,
  minimal dependencies, Zero-Trust error handling) live in `CLAUDE.md` and outrank anything here.

## Measured findings that constrain the design

These were established by experiment, not opinion. Reversing them requires new measurements, not a
better-sounding argument.

- **The English pivot in dialogue mode loses to direct translation** on both speed (1.4–3.3x) and
  fidelity — the pivot leg rephrases and the second leg faithfully translates the rephrasing.
  Direct is the default; the pivot survives only as a toggle.
- **The `previous_response_id` chain in dialogue mode is load-bearing.** Removing it fixes language
  routing on weak models but destroys quality: the model then renders a female speaker with masculine
  Russian verbs and invents a new term for the same product every turn (a blind judge preferred the
  chained translations 18 of 21). Keep the chain; pin a model strong enough to carry it.
- **Dialogue mode therefore pins its own provider and model** (`gpt-5.6-luna`) rather than riding the
  global current one. Do not repoint `PROVIDERS.openai.defaultModel` to "fix" dialogue mode — that
  would repoint every OpenAI call in the app.
- `temperature`, `maxTokens` and `streaming` were removed from `config/providers.js`: they had zero
  consumers, and every `gpt-5.6-*` model rejects `temperature` with a 400. Do not reintroduce them.

---

## Shipped

| | |
|---|---|
| **Phase 0** | current model ids; MCP SDK removed; `openai@6.45`; Node >= 24 |
| **Phase 1** | dead-code sweep (error-recovery theatre, dead state, unused streaming API) |
| **Phase 1b** | error system rewritten into one Zero-Trust module (real `Error` objects, regex-free sanitizing) |
| **Phase 2** | commands moved from SQLite to `~/.openai-cli/commands.toml`; the whole `cmd/` editing tree deleted; per-command `context` flag (translations are stateless → token savings) |
| **One-shot mode** | `ai rr "text"` and piped stdin — the bridge to Apple Shortcuts before the GUI exists |
| **Gateway** | zero-dependency Node forwarder on the VPS; email+password login with an emailed OTP; 90-day server-revocable sessions; password reset by email; per-record command sync across devices |
| **Phase 5** (v6.2–6.5) | Responses API (fixes the Responses-only models); `previous_response_id` chaining for chat; `save`/resume sessions synced through the gateway; `dd` dialogue-translation mode with its own settings screen and model pin |

## Next

1. **Dialogue mode: speaker attribution.** Relaying a group chat (several Chinese speakers and one
   Russian) currently produces anonymous translations. Naming who said what is the missing piece for
   the WoW-addon use case — the most valuable small feature on this list.
2. **Architecture: extract a per-provider conversation strategy.** Phase 5 threaded "how a multi-turn
   conversation is carried" through ~7 layers. Consolidate it into one module before a second
   Responses provider arrives. Behaviour-preserving; the existing harnesses are the safety net.
3. **Doubao provider.** A Responses-API clone reachable from mainland China without a VPN. Lands
   cleanly after (2) — dialogue mode already resolves its provider by capability, but with two
   Responses providers it will need to ask which one.
4. **Phase 4 — the Tauri GUI.** Palette-first (Spotlight-style), chat window secondary.
5. **The Rust rewrite** — last, once everything above has settled.

## Open / parked

- **Anthropic is on hold** — the prepaid API credits expired.
- **Dialogue mode: stray command prefixes.** Typing `cc привет` inside `dd` translates the literal
  "cc". Either strip a leading known command token or leave it; the owner leaned toward leaving it.
- **Multi-model commands** (`chinese`, `grammar`, `wtf`). The output-interleaving race once reported
  against them is **fixed** — a coordinator lets only the first model to produce content stream live
  while the others buffer and render after. What remains is a product question: do these commands earn
  their keep?
