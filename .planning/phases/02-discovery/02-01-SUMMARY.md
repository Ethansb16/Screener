---
phase: 02-discovery
plan: 01
subsystem: ingestion
tags: [edgar, efts, sqlite, better-sqlite3, node-test, tdd]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: edgarClient.js (edgarGetJson), db.js singleton, schema.js (filings table), edgar-utils.js (normalizeCIK, accessionToPath)
provides:
  - queryEFTSSpinoffs(): EFTS query for 10-12B/10-12B/A/8-K filings with yesterday/today date window
  - insertFiling(hit): idempotent INSERT OR IGNORE into filings table
  - runDiscover(): pipeline stage — replaces stub, calls edgarIngester, returns inserted row ids
affects: [02-discovery, 03-signal, pipeline/runner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "URLSearchParams for EDGAR query string construction"
    - "INSERT OR IGNORE for idempotent daily pipeline runs"
    - "parseDisplayName two-pattern regex for EDGAR display_names field"
    - "edgarGetJson always used — never direct fetch() for SEC URLs"
    - "?v=N ESM cache-buster on dynamic imports for test isolation"

key-files:
  created:
    - src/ingestion/edgarIngester.js
    - src/__tests__/discover.test.js
  modified:
    - src/pipeline/stages/discover.js

key-decisions:
  - "Import path in discover.js is ../../ingestion/edgarIngester.js (not ../ingestion) — stages/ is two levels deep from src/"
  - "No pagination in Phase 2: daily 10-12B/10-12B/A volume is 0-5 filings; size=100 is sufficient"
  - "insertFiling returns lastInsertRowid (0 for duplicates, positive integer for new rows) — callers filter on truthiness"

patterns-established:
  - "TDD RED: write 6 failing tests before implementation file exists"
  - "TDD GREEN: implement against tests, verify 6/6 pass, then run full suite (28/28)"
  - "In-memory DB via ?v=N cache-busters is not sufficient for edgarIngester tests — tests use the real singleton DB with cleanup"

requirements-completed: [DISC-01]

# Metrics
duration: 10min
completed: 2026-03-29
---

# Phase 2 Plan 01: EDGAR EFTS Discovery Summary

**EFTS spinoff discovery via queryEFTSSpinoffs + INSERT OR IGNORE filing ingestion, replacing the discover.js stub with real pipeline logic**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-29T10:19:13Z
- **Completed:** 2026-03-29T10:29:31Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 3

## Accomplishments

- Implemented `queryEFTSSpinoffs()` — queries EFTS with yesterday/today date window and form filter 10-12B,10-12B/A,8-K using edgarGetJson (never direct fetch)
- Implemented `insertFiling(hit)` — parses EFTS hit, builds primary_doc_url, INSERT OR IGNORE into filings table (fully idempotent)
- Replaced discover.js stub with real `runDiscover()` that calls edgarIngester and returns array of inserted row ids
- 6 DISC-01 tests written and all passing; full suite 28/28 green

## Task Commits

1. **Task 1 (RED): Write failing DISC-01 tests** - `2d5bcd5` (test)
2. **Task 2 (GREEN): Implement edgarIngester and replace discover stub** - `aeb3321` (feat)

## Files Created/Modified

- `src/ingestion/edgarIngester.js` - queryEFTSSpinoffs() and insertFiling() — core DISC-01 functions
- `src/pipeline/stages/discover.js` - replaced stub with real runDiscover() calling edgarIngester
- `src/__tests__/discover.test.js` - 6 DISC-01 tests covering both functions and the pipeline stage

## Decisions Made

- Import path in discover.js must be `../../ingestion/edgarIngester.js` — pipeline/stages/ is two levels deep from src/
- No EFTS pagination in Phase 2 (daily 10-12B volume is 0–5; size=100 is sufficient)
- `insertFiling` returns `lastInsertRowid` — 0 means duplicate (ignored), positive integer means inserted; `runDiscover` filters on truthiness

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect import path in discover.js**
- **Found during:** Task 2 (GREEN phase — running tests)
- **Issue:** Plan specified `import { queryEFTSSpinoffs, insertFiling } from '../ingestion/edgarIngester.js'` but `src/pipeline/stages/discover.js` is two directories deep from `src/`, so `../ingestion` resolved to `src/pipeline/ingestion/` (non-existent)
- **Fix:** Changed to `../../ingestion/edgarIngester.js` — correct relative path from `src/pipeline/stages/`
- **Files modified:** src/pipeline/stages/discover.js
- **Verification:** Tests 5 and 6 (runDiscover tests) went from ERR_MODULE_NOT_FOUND to passing
- **Committed in:** aeb3321 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Bug)
**Impact on plan:** Essential path correction. No scope creep.

## Issues Encountered

- edgarIngester tests for insertFiling use the real singleton DB (not in-memory testDb) because edgarIngester imports db.js as a module singleton that can't be swapped without full ESM module isolation. Tests include cleanup steps (DELETE after each insert test) to prevent state leakage. This is consistent with the runner.test.js pattern.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DISC-01 complete: pipeline now discovers real spinoff filings from EDGAR EFTS on each daily run
- Ready for Phase 2 Plan 02 (DISC-02): fetch filing document text for discovered filings
- No blockers

---
*Phase: 02-discovery*
*Completed: 2026-03-29*
