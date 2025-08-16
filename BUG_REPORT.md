# BUG REPORT

## Bug #1: Provider Models Initialization Error
**Date:** 2025-08-16 14:24:02  
**Context:** After fixing CommandRouter logic for system commands from database

### Error Output:
```
node bin/app.js
(node:69117) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[WARN] Failed to list models for openai: Failed to list models: Request timed out.
[WARN] Failed to list models for deepseek: Failed to list models: Request timed out.
Error: {
  message: 'defaultProvider.models.find is not a function',
  stack: 'TypeError: defaultProvider.models.find is not a function\n' +
    '    at ApplicationInitializer.initializeProviders (file:[PATH_MASKED]\n' +
    '    at process.processTicksAndRejections (node:internal[PATH_MASKED]\n' +
    '    at async ApplicationInitializer.initializeAI (file:[PATH_MASKED]\n' +
    '    at async AIApplication.initializeAI (file:[PATH_MASKED]\n' +
    '    at async start (file:[PATH_MASKED]',
  timestamp: '2025-08-16T14:24:02.878Z',
  isOperational: false
}
```

### Analysis:
- **Root Cause:** `defaultProvider.models.find is not a function`
- **Location:** `ApplicationInitializer.initializeProviders()`
- **Trigger:** Network timeouts when listing models for openai and deepseek
- **Issue:** When model listing fails, `defaultProvider.models` is not an array

### Context:
- Commands are now properly routed from database
- Migration removed, database contains all commands
- Provider initialization failing due to network issues

### Status: PENDING INVESTIGATION

---

## Bug #2: Delayed Spinner Start
**Date:** 2025-08-16  
**Priority:** UX Improvement

### Issue:
Spinner/loading indicator starts with several seconds delay instead of immediately when application starts.

### Current Behavior:
```
node bin/app.js
(node:71571) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)

✓ 1.9s
current model is OpenAI gpt-5-mini
```

### Problem:
- Several seconds of "dead time" before spinner appears
- Timer shows "1.9s" but actual loading took much longer
- Poor user experience - user doesn't know if app is starting

### Expected Behavior:
- Spinner should start immediately when app launches
- Accurate timing display
- Clear indication that app is loading

### Status: PENDING FIX

---

## Bug #3: Missing Model Info in Provider Command
**Date:** 2025-08-16  
**Priority:** UX Enhancement

### Issue:
When using `provider` command, only provider name is shown, missing current model information.

### Current Behavior:
```
> provider
Current provider: openai
```

### Expected Behavior:
```
> provider  
Current provider: openai, current model: gpt-5-mini
```

### Improvement:
User should see complete provider + model context when switching providers to understand what model will be used by default.

### Status: PENDING IMPLEMENTATION

---

## Bug #4: Command Field Editing UX Improvement
**Date:** 2025-08-16  
**Priority:** UX Enhancement

### Issue:
Two UX improvements needed for command editing:
1. Interactive field selection menu instead of sequential field skipping
2. Add "Name" field for human-readable command names

### Current Behavior:
```
> cmd
> edit command
> russian
> Command key [aa]: [Enter to skip]
> Description [Russian translation]: [Enter to skip]  
> Instruction [Translate to Russian]: [Enter to skip]
> Edit models? (y/n) [n]: [Enter to skip]
```

### Expected Behavior:
After selecting a command to edit, show an interactive menu:
```
> cmd
> edit command  
> russian
┌─ Select field to edit ─┐
│ ▶ Name                 │
│   Command key          │
│   Description          │
│   Instruction          │
│   Models               │
└────────────────────────┘
```

### Improvements:
1. **Interactive Menu**: Replace sequential field editing with menu-based field selection
2. **Name Field**: Add human-readable name field (e.g., "Russian Translation" instead of auto-generated "AA" from key "aa")

### Technical Changes:
- Add `name` column to commands database table
- Update `utils/command-editor.js` with field selection menu
- Update `utils/database-manager.js` for name field support
- Modify `addCommand()` and `editCommand()` methods

### Location:
`utils/command-editor.js:editCommand()` method around lines 120-150

### Status: PENDING IMPLEMENTATION

---

## Bug #5: CMD Menu UX Improvements  
**Date:** 2025-08-16  
**Priority:** UX Enhancement

### Issue:
Three UX improvements needed for cmd command workflow:

1. **Missing Exit option in cmd menu**
2. **Unclear field editing feedback** 
3. **Poor navigation flow after field editing**

### 1. Add Exit Option to CMD Menu

**Current Behavior:**
```
Select action:
▶ Add command
  Edit command
  List commands
  Delete command
Use ↑/↓ to navigate, Enter to select, Esc to cancel
```

**Expected Behavior:**
```
Select action:
▶ Add command
  Edit command
  List commands
  Delete command
  Exit (esc)
Use ↑/↓ to navigate, Enter to select, Esc to cancel
```

### 2. Improve Field Editing Feedback

**Current Behavior:**
```
Name [CHINESE]: [Enter pressed with no input]
Command "CHINESE" updated
```

**Problem:** Unclear what happened - was name changed or kept the same?

**Expected Behavior:**
```
Name [CHINESE]: [Enter pressed with no input]
Name CHINESE: nothing's changed

Name [CHINESE]: Chinese Translation [Enter pressed]
✓ Name CHINESE has been changed to Chinese Translation
```

### 3. Return to Field Selection After Editing

**Current Behavior:**
After editing any field, user is thrown back to main terminal prompt.

**Expected Behavior:**
After editing a field, return to field selection menu:
```
┌─ Select field to edit ─┐
│ ▶ Name                 │
│   Command key          │
│   Description          │
│   Instruction          │
│   Models               │
│   Exit                 │
└────────────────────────┘
```

### Technical Changes:
- Add "Exit" option to `showCommandMenu()` actions array
- Add explicit feedback messages in field editing
- Implement loop in `editCommand()` to return to field selection
- Add "Exit" option to field selection menu

### Location:
`utils/command-editor.js` - methods `showCommandMenu()` and `editCommand()`

### Status: PENDING IMPLEMENTATION

---