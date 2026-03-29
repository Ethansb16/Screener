---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [node, sqlite, better-sqlite3, pino, dotenv, express, node-cron, p-limit, anthropic-sdk, esm]

# Dependency graph
requires: []
provides:
  - better-sqlite3 singleton with WAL mode and foreign_keys at src/db/db.js
  - Four-table SQLite schema (filings, opportunities, news_items, run_log) at src/db/schema.js
  - pino logger singleton at src/logger.js
  - Wave 0 test stubs for INFRA-01, INFRA-02, INFRA-03, INFRA-04
  - All Phase 1 npm dependencies installed
  - .env.example with required env var template
  - data/ directory for DB file location
affects: [02-edgar-client, 03-pipeline, 04-analysis, 05-ui]

# Tech tracking
tech-stack:
  added:
    - "@anthropic-ai/sdk@0.80.0 (replaces broken claude@0.1.1 stub)"
    - "better-sqlite3@12.8.0 (SQLite with sync API, WAL mode)"
    - "node-cron@4.2.1 (daily cron scheduler)"
    - "p-limit@7.3.0 (EDGAR request concurrency cap)"
    - "pino@10.3.1 (structured logging)"
    - "pino-pretty@latest (human-readable dev logs)"
    - "dotenv@17.3.1 (env config)"
    - "express@5.2.1 (HTTP server)"
  patterns:
    - "ESM module type: all src/ files use import/export syntax"
    - "Database singleton: one better-sqlite3 instance opened at process start"
    - "Schema-on-startup: CREATE TABLE IF NOT EXISTS run once at startup (no migrations)"
    - "Test isolation: in-memory DB for unit tests; temp file DB only for WAL pragma test"

key-files:
  created:
    - src/db/db.js
    - src/db/schema.js
    - src/logger.js
    - src/__tests__/db.test.js
    - src/__tests__/edgarClient.test.js
    - src/__tests__/scheduler.test.js
    - src/__tests__/runner.test.js
    - .env.example
    - .gitignore
  modified:
    - package.json

key-decisions:
  - "Use better-sqlite3 (not experimental node:sqlite) — still experimental in Node 24"
  - "Test command: node --test glob pattern (not directory) required on Windows + Node 24"
  - "WAL test uses temp file DB — WAL pragma not supported on :memory: databases"
  - "node --test src/__tests__/ fails on Windows; use node --test src/__tests__/*.test.js"

patterns-established:
  - "Pattern DB-Singleton: import db from src/db/db.js — never open a second connection"
  - "Pattern WAL-On-Open: db.pragma('journal_mode = WAL') immediately after new Database()"
  - "Pattern ESM-dirname: fileURLToPath(import.meta.url) required for __dirname in ESM"

requirements-completed: [INFRA-02]

# Metrics
duration: 3min
completed: 2026-03-29
---

# Phase 1 Plan 01: Bootstrap Foundation Summary

**better-sqlite3 singleton with WAL mode, four-table schema, pino logger, and Wave 0 test stubs — all Phase 1 npm deps installed and ESM configured**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-29T05:42:44Z
- **Completed:** 2026-03-29T05:46:02Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Removed broken `claude@0.1.1` stub and installed all 8 Phase 1 npm dependencies
- Created `src/db/db.js` (better-sqlite3 singleton with WAL mode and foreign_keys) and `src/db/schema.js` (four-table schema with indexes)
- Created `src/logger.js` (pino singleton with pino-pretty for dev)
- Created Wave 0 test stubs for all four INFRA requirements; all 10 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix packages and initialize project config** - `7c9c240` (feat)
2. **Task 2 RED: DB schema and Wave 0 test stubs** - `9096cae` (test)
3. **Task 2 GREEN: DB singleton, schema, logger** - `ffdd6b4` (feat)
4. **Deviation fix: test script glob pattern** - `d225848` (fix)

**Plan metadata:** _(docs commit follows)_

_Note: TDD task has separate test (RED) and implementation (GREEN) commits_

## Files Created/Modified
- `package.json` - Added name, version, type:module, scripts; all Phase 1 deps
- `package-lock.json` - Lockfile for installed deps
- `.env.example` - Required env var template (SEC_USER_AGENT, ANTHROPIC_API_KEY, PORT, LOG_LEVEL, CRON_SCHEDULE)
- `.gitignore` - Covers node_modules/, data/, .env, *.db files
- `src/db/db.js` - better-sqlite3 singleton; WAL mode; foreign_keys ON; ESM __dirname fix
- `src/db/schema.js` - initializeSchema() with CREATE TABLE IF NOT EXISTS for all 4 tables + indexes
- `src/logger.js` - pino singleton with pino-pretty for non-production
- `src/__tests__/db.test.js` - 7 tests covering INFRA-02 (tables, upsert, WAL, idempotency)
- `src/__tests__/edgarClient.test.js` - INFRA-01 stub (Plan 02 replaces)
- `src/__tests__/scheduler.test.js` - INFRA-03 stub (Plan 03 replaces)
- `src/__tests__/runner.test.js` - INFRA-04 stub (Plan 03 replaces)

## Decisions Made
- Used `better-sqlite3` not experimental `node:sqlite` — still experimental in Node 24
- WAL test uses a temp file DB (not `:memory:`) because WAL mode is not supported on in-memory SQLite databases
- Fixed test script from `node --test src/__tests__/` to `node --test "src/__tests__/*.test.js"` — the directory form fails on Windows + Node 24

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WAL journal_mode test fails on in-memory database**
- **Found during:** Task 2 (TDD RED phase — first test run)
- **Issue:** `:memory:` SQLite databases always report `journal_mode = 'memory'`; WAL mode is not supported. The plan's test used the in-memory DB for all tests including the WAL pragma check.
- **Fix:** Isolated WAL test to use a `mkdtemp` temp file database, then clean up after the test
- **Files modified:** `src/__tests__/db.test.js`
- **Verification:** `node --test "src/__tests__/*.test.js"` — 10/10 pass
- **Committed in:** `9096cae` (RED phase commit)

**2. [Rule 1 - Bug] `npm test` script uses directory path that fails on Windows + Node 24**
- **Found during:** Task 2 (verification run)
- **Issue:** `node --test src/__tests__/` causes "Cannot find module" error on Windows; Node 24 requires explicit file patterns
- **Fix:** Changed test script to `node --test "src/__tests__/*.test.js"`
- **Files modified:** `package.json`
- **Verification:** `npm test` exits 0 with 10 passing tests
- **Committed in:** `d225848` (separate fix commit)

---

**Total deviations:** 2 auto-fixed (2 × Rule 1 bugs)
**Impact on plan:** Both fixes necessary for tests to pass on Windows. No scope creep.

## Issues Encountered
- `node --test src/__tests__/` path resolution fails on Windows — resolved by using explicit glob pattern
- WAL mode not supported on in-memory SQLite — resolved by using temp file for that specific test

## User Setup Required
Copy `.env.example` to `.env` and fill in:
- `SEC_USER_AGENT` — Your app name and email (required by SEC policy)
- `ANTHROPIC_API_KEY` — Your Anthropic API key (needed for Phase 4)

## Next Phase Readiness
- Package infrastructure complete — all Phase 1 npm deps installed, ESM configured
- Database layer ready — DB singleton and schema available for all subsequent plans
- Test infrastructure ready — `npm test` runs all stubs; Plan 02 and 03 will replace stubs with real tests
- Plan 02 (EDGAR client) can proceed immediately — depends only on this plan's output

## Self-Check: PASSED

- src/db/db.js: FOUND
- src/db/schema.js: FOUND
- src/logger.js: FOUND
- src/__tests__/db.test.js: FOUND
- src/__tests__/edgarClient.test.js: FOUND
- .env.example: FOUND
- .gitignore: FOUND
- Commit 7c9c240 (Task 1): FOUND
- Commit 9096cae (Task 2 RED): FOUND
- Commit ffdd6b4 (Task 2 GREEN): FOUND
- Commit d225848 (fix test script): FOUND

---
*Phase: 01-foundation*
*Completed: 2026-03-29*
