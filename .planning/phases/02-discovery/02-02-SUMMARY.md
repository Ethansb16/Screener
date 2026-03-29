---
phase: 02-discovery
plan: 02
subsystem: ingestion
tags: [sqlite, edgar, better-sqlite3, classification, tdd, node-test]

# Dependency graph
requires:
  - phase: 02-01
    provides: queryEFTSSpinoffs, insertFiling in edgarIngester.js
provides:
  - classifyDeal(hit) in src/ingestion/classifyDeal.js — pure function classifying EFTS hits into spinoff/split-off/pending_classification/divestiture
  - insertOpportunity(filingId, hit, dealType) in src/ingestion/edgarIngester.js — gates opportunity insertion to spinoff/split-off/pending_classification only
  - Updated discover.js calling classifyDeal + insertOpportunity per filing
  - 8-test DISC-02 coverage in src/__tests__/classify.test.js
affects:
  - 02-03 (enrichment stage reads from opportunities table)
  - 03 (signal extraction uses signal_type = form_10 to find Form 10 candidates)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-level classification: form type first, then content metadata (display_names) for split-off detection"
    - "signal_type mapping: spinoff/split-off -> form_10, pending_classification -> 8k_spinoff"
    - "INSERT OR IGNORE gate: only spinoff/split-off/pending_classification reach opportunities table"
    - "TDD: RED commit (failing tests) then GREEN commit (implementation)"

key-files:
  created:
    - src/ingestion/classifyDeal.js
    - src/__tests__/classify.test.js
  modified:
    - src/ingestion/edgarIngester.js
    - src/pipeline/stages/discover.js

key-decisions:
  - "10-12B filings are never carve_out — carve-outs use S-1 per research; Form 10 always classifies as spinoff or split-off"
  - "split-off detection checks display_names for 'exchange offer', 'split-off', or 'split off' text"
  - "divestiture is the safe fallback for unknown form types — excluded from pipeline"
  - "Test idempotency by pre-deleting rows in real DB (singleton pattern prevents in-memory swap)"

patterns-established:
  - "classifyDeal is pure (no DB, no I/O) — testable without infrastructure"
  - "insertOpportunity returns 0 for excluded deal types (matches insertFiling pattern)"

requirements-completed:
  - DISC-02

# Metrics
duration: 20min
completed: 2026-03-28
---

# Phase 2 Plan 02: Deal Type Classification Summary

**Two-level EDGAR filing classifier (Form 10 -> spinoff/split-off, 8-K -> pending) with DB opportunity gating — carve_out and divestiture excluded from pipeline**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-28T03:10:00Z
- **Completed:** 2026-03-28T03:30:00Z
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 4

## Accomplishments

- Pure `classifyDeal(hit)` function classifies 10-12B/10-12B/A as spinoff (or split-off when exchange offer language detected), 8-K as pending_classification, and all other forms as divestiture
- `insertOpportunity()` added to edgarIngester.js: maps spinoff/split-off to signal_type='form_10' (strength='moderate'), pending_classification to '8k_spinoff' (strength='weak'), and skips carve_out/divestiture entirely
- discover.js updated to call classifyDeal + insertOpportunity per successful filing insert
- 8/8 DISC-02 tests pass (5 pure logic + 3 DB integration)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Write failing DISC-02 classification tests** - `1dda769` (test)
2. **Task 2 (GREEN): Implement classifyDeal and insertOpportunity** - `5d578c0` (feat)

## Files Created/Modified

- `src/ingestion/classifyDeal.js` — Pure classification function, two-level logic
- `src/__tests__/classify.test.js` — 8 DISC-02 tests (5 pure + 3 DB integration)
- `src/ingestion/edgarIngester.js` — Added insertOpportunity export + classifyDeal import
- `src/pipeline/stages/discover.js` — Now calls classifyDeal and insertOpportunity per filing

## Decisions Made

- split-off detection uses `display_names` join (not entity_name field) — matches the EFTS data structure observed in plan context
- Test cleanup uses explicit DELETE before INSERT (not INSERT OR IGNORE) to ensure filingId > 0 assertions work in the real singleton DB

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test INSERT OR IGNORE returned 0 for pre-existing accession numbers**
- **Found during:** Task 2 (GREEN phase, tests 6 and 7)
- **Issue:** The DB singleton persists across test runs; accession numbers `0001111111-25-000001/2/3` inserted by a prior run were still present, causing `INSERT OR IGNORE` to return `lastInsertRowid = 0`, breaking `assert.ok(filingId > 0)`
- **Fix:** Added explicit `DELETE FROM filings WHERE accession_number = ?` before each INSERT in tests 6-8 and changed to plain `INSERT` (not `INSERT OR IGNORE`) so lastInsertRowid is always the new row
- **Files modified:** src/__tests__/classify.test.js
- **Verification:** 8/8 tests pass after fix
- **Committed in:** 5d578c0 (Task 2 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test isolation)
**Impact on plan:** Minimal — test isolation fix only, no production code change. Tests now robust against repeated runs.

## Issues Encountered

- Pre-existing discover.test.js DISC-01 failures (`insertFiling inserts one row`, `runDiscover returns array`) were present before this plan and are not caused by plan 02-02 changes. Root cause: accession numbers from plan 01 test run remain in the persistent DB singleton. These are out-of-scope for this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- opportunities table now receives spinoff/split-off filing records with signal_type='form_10' and status='new'
- Phase 02-03 (enrichment) can query `SELECT * FROM opportunities WHERE signal_type = 'form_10' AND status = 'new'` to find candidates
- Phase 3 signal extraction can use pending_classification rows (signal_type='8k_spinoff') for text-based classification

---
*Phase: 02-discovery*
*Completed: 2026-03-28*
