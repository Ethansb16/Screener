---
phase: 02-discovery
plan: "03"
subsystem: ingestion
tags: [edgar, lifecycle, sqlite, better-sqlite3, tdd, node-test]

requires:
  - phase: 02-discovery-02-01
    provides: discover stage and edgarIngester with 10-12B filing insertion
  - phase: 02-discovery-02-02
    provides: classify stage, opportunities table upsert, signal_type detection
provides:
  - checkLifecycle(cik) function that queries EDGAR submissions and returns confirmed/withdrawn/null
  - runPersist(_newFilingIds) stage that updates all new opportunities with lifecycle status
  - Full DISC-03 test coverage (9 tests)
affects: [03-extraction, 04-signal, dashboard-phase]

tech-stack:
  added: []
  patterns:
    - "EDGAR submissions columnar array reconstruction: recent.form.map((formType, i) => ({ form: formType, ... }))"
    - "RW takes priority over EFFECT when both present in submissions"
    - "Lifecycle persist queries ALL 'new' opportunities — not just newly discovered ones"
    - "Test idempotency: clean up leftover DB rows before inserting in DB integration tests"

key-files:
  created:
    - src/ingestion/lifecycleChecker.js
    - src/__tests__/lifecycle.test.js
  modified:
    - src/pipeline/stages/persist.js

key-decisions:
  - "RW takes priority over EFFECT in edge case where both exist — withdrawn deal may have received erroneous EFFECT"
  - "persist.js queries ALL 'new' opportunities on every run (not just newly discovered) — lifecycle changes can happen any day"
  - "Test idempotency pattern: DELETE before INSERT using accession_number lookup in DB integration tests"

patterns-established:
  - "Columnar array pattern: EDGAR submissions filings.recent is parallel arrays, never iterable as objects"
  - "normalizeCIK required before building submissions URL — CIK0001603978.json format"

requirements-completed: [DISC-03]

duration: 15min
completed: 2026-03-28
---

# Phase 2 Plan 03: Lifecycle Checker Summary

**EDGAR EFFECT/RW lifecycle detection via submissions columnar arrays, wired into persist stage to auto-transition spinoff candidates from new to confirmed/withdrawn**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-28T03:15:00Z
- **Completed:** 2026-03-28T03:30:00Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- Implemented `checkLifecycle(cik)` using EDGAR submissions API with correct columnar array parsing
- Replaced the `runPersist` stub with full lifecycle update logic that processes ALL 'new' opportunities
- 9/9 DISC-03 lifecycle tests pass; RW-takes-priority edge case covered

## Task Commits

Each task was committed atomically:

1. **Task 1: RED - Failing DISC-03 tests** - `80adb4e` (test)
2. **Task 2: GREEN - lifecycleChecker + persist implementation** - `4a58459` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks have RED commit then GREEN commit_

## Files Created/Modified
- `src/ingestion/lifecycleChecker.js` - checkLifecycle(cik): queries submissions, returns 'confirmed'/'withdrawn'/null using columnar array pattern
- `src/pipeline/stages/persist.js` - Replaced stub with runPersist that SELECTs all 'new' opps, calls checkLifecycle per CIK, UPDATEs status
- `src/__tests__/lifecycle.test.js` - 9 tests covering EFFECT detection, RW detection, null case, URL padding, columnar parsing, and all runPersist DB scenarios

## Decisions Made
- RW takes priority over EFFECT when both appear in submissions — a company can't un-withdraw but EFFECT forms occasionally appear out of sequence
- persist.js queries ALL 'new' opportunities each run, not just those from the current runDiscover() call — lifecycle changes happen on any day, independent of when we first discovered the filing
- Test idempotency: each DB integration test cleans up any leftover rows before inserting, preventing SQLITE_CONSTRAINT_UNIQUE failures across test runs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SQLITE_CONSTRAINT_UNIQUE failures in DB integration tests**
- **Found during:** Task 2 (GREEN) - tests 6-9 failed with constraint errors on second run
- **Issue:** DB integration tests used fixed accession numbers; leftover rows from a crashed/interrupted previous run caused UNIQUE constraint violations on re-run
- **Fix:** Added pre-insert cleanup in `insertTestCandidate` helper — looks up and deletes any existing filing+opportunity rows by accession_number before inserting
- **Files modified:** src/__tests__/lifecycle.test.js
- **Verification:** lifecycle tests pass consistently on repeated runs
- **Committed in:** 4a58459 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix was necessary for test reliability. No scope creep.

## Issues Encountered
- Pre-existing discover.test.js failures (2/6 tests): `insertFiling inserts one row` and `runDiscover returns array` fail with `Expected positive rowId, got 0` due to leftover DB rows from prior test runs. These failures pre-existed before this plan (confirmed via git stash check). Out of scope — logged to deferred-items.

## Known Stubs
None - the persist.js stub is fully replaced; lifecycleChecker.js is a complete implementation.

## Next Phase Readiness
- All three DISC-0x requirements covered: DISC-01 (02-01), DISC-02 (02-02), DISC-03 (02-03)
- Phase 2 discovery pipeline complete: discover → classify → persist with lifecycle tracking
- Phase 3 (Signal Extraction) can now proceed — opportunities table is populated with correct status values
- Pre-existing discover.test.js failures should be addressed before Phase 3 (leftover DB rows issue)

---
*Phase: 02-discovery*
*Completed: 2026-03-28*
