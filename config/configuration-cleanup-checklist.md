# Configuration Cleanup Checklist

## Critical Conflicting Constants

### 1. MAX_INPUT_LENGTH
- [x] **Problem**: Different values in multiple files
- **Current State**:
  - `constants.js`: ~~`10000`~~ → **`30000`** ✅
  - `app-config.js`: ~~`100000`~~ → **REMOVED** ✅
  - Used in: `clipboard-handler.js`, `input-processing-service.js`, `utils/index.js`
- **Recommendation**: ~~Keep `100000`~~ → **Keep `30000` (token-efficient)**
- **Action**: ~~[TODO]~~ **COMPLETED** - Updated constants.js, removed from app-config.js
- **Status**: **DONE** ✅

### 2. API_TIMEOUT
- [x] **Problem**: Different timeout values
- **Current State**:
  - `constants.js`: ~~`100000`~~ → **`180000`** ✅
  - `app-config.js`: ~~`180000`~~ → **REMOVED** ✅
  - Used in: `config-manager.js` setup (will be deleted)
- **Recommendation**: ~~Keep `180000`~~ → **Unified to `180000` in constants.js**
- **Action**: ~~[TODO]~~ **COMPLETED** - Updated constants.js, removed from app-config.js
- **Status**: **DONE** ✅

### 3. MAX_CONTEXT_HISTORY
- [ ] **Problem**: Different history limits
- **Current State**:
  - `constants.js`: `10`
  - `app-config.js`: `20`
  - Used in: `config-manager.js` setup
- **Recommendation**: Keep `20` (better user experience)
- **Action**: [TODO] Consolidate values
- **Status**: TODO

### 4. CACHE_TTL
- [ ] **Problem**: Dramatically different cache lifetimes
- **Current State**:
  - `constants.js`: `30 * 24 * 60 * 60 * 1000` (30 days)
  - `app-config.js`: `3600000` (1 hour default), `7200000` (2 hours translation)
- **Recommendation**: Use hierarchical approach from app-config.js
- **Action**: [TODO] Remove from constants.js, use app-config.js structure
- **Status**: TODO

## Provider Models Duplication

### 5. OpenAI Default Model
- [x] **Problem**: Conflicting model names, one doesn't exist
- **Current State**:
  - `app-config.js`: `'gpt-4o-mini'` ✅ Valid model
  - `default_models.js`: `'gpt-5-mini'` ❌ **NON-EXISTENT MODEL**
- **Recommendation**: Fix `gpt-5-mini` → `gpt-4o-mini`
- **Action**: [TODO] Update default_models.js
- **Status**: TODO

### 6. DeepSeek Default Model
- [x] **Problem**: Consistent but duplicated
- **Current State**:
  - `app-config.js`: `'deepseek-chat'`
  - `default_models.js`: `'deepseek-chat'`
- **Recommendation**: Keep one source (app-config.js)
- **Action**: [TODO] Decide consolidation approach
- **Status**: TODO

### 7. Anthropic Default Model
- [x] **Problem**: Consistent but duplicated
- **Current State**:
  - `app-config.js`: `'claude-3-5-sonnet-20241022'`
  - `default_models.js`: `'claude-3-5-sonnet-20241022'`
- **Recommendation**: Keep one source (app-config.js)
- **Action**: [TODO] Decide consolidation approach
- **Status**: TODO

## Architecture Issues

### 8. ConfigManager Class (Legacy)
- [ ] **Problem**: Class-based config manager duplicates app-config.js functionality
- **Current State**:
  - `config-manager.js`: 149 lines, imports from constants.js
  - `app-config.js`: 283 lines with better structure
- **Recommendation**: **DELETE** config-manager.js (violates CLAUDE.md "NO CLASSES" rule)
- **Action**: [TODO] Remove ConfigManager, update imports
- **Status**: TODO

### 9. Constants.js Scope Creep
- [ ] **Problem**: File contains both UI constants and duplicated config
- **Current State**: Mixed concerns (UI symbols + config duplicates)
- **Recommendation**: Keep only UI_SYMBOLS, ERROR_CODES, HTTP_STATUS, SUPPORTED_PLATFORMS
- **Action**: [TODO] Remove duplicated config values, keep pure constants
- **Status**: TODO

### 10. Provider Configuration Split
- [x] **Problem**: Provider info split across multiple files
- **Current State**:
  - `api_providers.js`: ~~Endpoints and API keys~~ → **MERGED into app-config.js** ✅
  - `default_models.js`: ~~Default models~~ → **MERGED into app-config.js** ✅
  - `app-config.js`: ~~Provider settings~~ → **CONSOLIDATED all provider info** ✅
- **Recommendation**: ~~Consolidate into app-config.js~~ → **COMPLETED**
- **Action**: ~~[TODO]~~ **COMPLETED** - All provider info unified in PROVIDERS section
- **Status**: **DONE** ✅

## Import Dependencies Analysis

### 11. Files Using constants.js
- [ ] **Problem**: Need to update imports after cleanup
- **Files to update**:
  - `services/input-processing-service.js`
  - `handlers/clipboard-handler.js`
  - `utils/index.js`
  - `config-manager.js` (will be deleted)
- **Action**: [TODO] Update imports to use app-config.js
- **Status**: TODO

### 12. Files Using default_models.js
- [x] **Problem**: Need to handle after consolidation
- **Files to update**:
  - `services/ai-provider-service.js`
  - `core/StateManager.js`
  - `core/ApplicationInitializer.js`
- **Action**: [TODO] Update imports after model consolidation
- **Status**: TODO

## Migration Plan

### Phase 1: Fix Critical Conflicts
- [ ] Fix `gpt-5-mini` → `gpt-4o-mini` in default_models.js
- [ ] Resolve MAX_INPUT_LENGTH conflict
- [ ] Test application still runs

### Phase 2: Consolidate Provider Config
- [ ] Merge provider info into app-config.js
- [ ] Update all imports
- [ ] Test provider switching works

### Phase 3: Remove Legacy Files
- [ ] Delete config-manager.js
- [ ] Clean constants.js (keep only pure constants)
- [ ] Update remaining imports

### Phase 4: Validation
- [ ] Run application end-to-end test
- [ ] Verify all features work
- [ ] Check no missing imports

## Decision Log

### Decisions Made:
- **Source of Truth**: `app-config.js` will be the single source for all application configuration
- **Pure Constants**: `constants.js` will keep only UI symbols and error codes
- **Legacy Removal**: `config-manager.js` will be deleted (violates no-classes rule)

### Decisions Pending:
- [ ] Exact structure of consolidated provider config
- [ ] Environment variable handling approach
- [ ] Backward compatibility requirements

---

**Usage**: Check off items as you complete them. Update the **Status** field and add notes about decisions made.
