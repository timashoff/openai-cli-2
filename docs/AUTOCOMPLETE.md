# Autocomplete for System Commands

A simple autocomplete feature implemented using the Tab key for OpenAI CLI system commands.

## How to Use

1. Start typing a command, for example: `he`
2. Press the `Tab` key
3. The command will automatically complete to `help`

## Supported Commands

Autocomplete works for all system commands defined in `SYS_INSTRUCTIONS`:

- `help` - show help
- `model` - select AI model
- `provider` - change API provider
- `exit`, `q` - exit the program

## Implementation

Autocomplete is implemented in the following modules:

- `utils/autocomplete.js` - system command search logic
- `utils/index.js` - completer added to existing readline interface
- `bin/app.js` - uses standard rl.question with autocomplete

## Features

- Autocomplete works only for system commands, not affecting regular user queries
- Uses built-in completer functionality of Node.js readline
- Simple integration with existing readline interface
- Maintains compatibility with existing functionality
- Doesn't require additional raw mode or keypress events management
- Fully compatible with standard terminal behavior

## Technical Solution

**Final solution uses standard readline completer:**
- Added `completer` function in `utils/index.js`
- Completer integrated into existing `readline.createInterface`
- Removed all custom keypress event handlers
- Uses standard `rl.question` without modifications

**Advantages of this approach:**
- No character duplication
- No conflicts with existing handlers
- Full compatibility with standard readline
- Minimal changes in existing code
