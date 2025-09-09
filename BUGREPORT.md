# Bug Report

## Bug ID: BUG-1735152247

**Discovered:** 2024-12-25 19:37:27 UTC

### Issue: Double checkmark output in command operations

**Description:**
When updating/creating/deleting commands via cmd system command, two checkmark symbols (✓✓) are displayed instead of one.

**Example output:**
```
✓ ✓ Command "DOC" updated successfully!
```

**Root cause:**
Both `spinner.stop('success')` and `outputHandler.formatSuccess()` output checkmark symbols:
- `spinner.stop('success')` outputs `${UI_SYMBOLS.CHECK}` if operation takes > 0.1s
- `outputHandler.formatSuccess()` always outputs `✓` in message

**Location:**
- File: `/commands/cmd-command.js`
- Lines: Around spinner.stop('success') calls followed by outputHandler.formatSuccess()

**Affected operations:**
- Command creation (Add command)
- Command update (Edit command) 
- Command deletion (Delete command)

**Priority:** Low (cosmetic issue)

**Status:** Open

---

## Refactoring Plan: CMD Command Decomposition

**Target:** `/commands/cmd-command.js` (994 lines - too large)

**Strategy:** Variant 1 - Folder structure `commands/cmd/`

### Proposed Structure:
```
commands/cmd/
├── index.js           # Main command + routing (CmdCommand, handleAddCommand, etc.)
├── field-editors.js   # editName, editDescription, editInstruction, editCaching  
├── collection-editors.js # editKeys, editModels + flows (addKeyWithValidation, etc.)
├── validators.js      # validateKey, isCommandValid, getAllExistingKeys
├── formatters.js      # fieldFormatters, generateMenuWithValues, formatFieldValue
└── configs.js         # COLLECTION_CONFIGS, COLLECTION_ACTIONS, constants
```

### Benefits:
- ✅ Logically grouped by responsibility
- ✅ Easy to find needed component  
- ✅ Each part can be developed independently
- ✅ Doesn't break existing architecture
- ✅ Reduces cognitive load per file

**Status:** Planned (deferred until next major changes)
**Priority:** Medium (code maintainability)

---

## Bug ID: BUG-1736244000

**Discovered:** 2025-01-07 UTC

### Issue: Multi-model streaming race condition - output interleaving (INTERMITTENT)

**Description:**
When using multi-model commands (like `rr`), concurrent streaming responses from different models **sporadically** interfere with each other, causing output from second model to appear in the middle of first model's response, making responses unreadable. 

**⚠️ Intermittent bug** - occurs only when second model responds significantly faster than first model during streaming.

**Example output:**
```
> rr $
[Clipboard content inserted (505 chars)]
✓ 3.3s

[deepseek-chat]
Перевод на русский язык:

1. "отделить от" - означает разделить, выделить одну часть из целого  
2. "перенести из в" - переместить из одного места
[gpt-5-nano]
- Рефакторинг: разделить конфигурацию системных команд от бизнес-логики
- Переместить утилитные функции из config/system-commands.js в utils/system-commands.js
...complete gpt-5-nano response...
checkmark 14.0s

/файла в другое  
3. "содержать только" - иметь в составе исключительно указанное  
...continuation of deepseek-chat response...
checkmark 20.2s

[2/2 models responded]
```

**Root cause:**
- Concurrent streaming outputs from different models are NOT isolated
- Second model captures stdout/stderr while first model is still streaming  
- No output buffering or synchronization for multi-model responses
- **Timing-dependent race condition** - depends on model response speed differential
- System load, network latency, and response size affect occurrence probability

**Technical details:**
- **Intermittent race condition** - classic concurrent programming hazard
- First model starts streaming its response
- Second model completes faster and interrupts first model's output stream
- First model's incomplete response continues after second model finishes  
- Results in completely broken, unreadable mixed output
- **Debugging complexity** - difficult to reproduce consistently due to timing dependency
- **Production risk** - users may dismiss as random glitch, but can break important responses

**Location:**
- Multi-model response streaming implementation
- stdout/stderr synchronization in concurrent model processing
- Output buffering logic for streaming responses

**Affected operations:**
- All multi-model commands (rr, tt, etc.)
- Any command that triggers multiple AI providers with streaming responses

**Priority:** High (breaks response readability + intermittent nature makes it dangerous)

**Status:** Open