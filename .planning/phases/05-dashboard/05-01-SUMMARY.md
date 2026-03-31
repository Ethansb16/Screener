---
phase: 05-dashboard
plan: 01
subsystem: ui
tags: [express, htmx, tailwind, better-sqlite3, node-test]

# Dependency graph
requires:
  - phase: 04-ai-analysis
    provides: claude_analysis stored in opportunities table
  - phase: 03-signal-extraction
    provides: signals table with 4 signal rows per filing
  - phase: 01-foundation
    provides: db singleton, schema with filings/opportunities/signals tables

provides:
  - src/web/queries.js — listOpportunities() and getOpportunityDetail() DB query functions
  - src/web/templates.js — renderLayout(), renderFeedPage(), renderDetail(), esc(), SIGNAL_LABELS
  - src/__tests__/dashboard.test.js — 11 tests covering queries and templates

affects: [05-02-router]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LEFT JOIN signals on reason_classification to derive top_signal_classification without failing on missing signals"
    - "esc() utility for 5-entity HTML escaping of DB content before insertion into template literals"
    - "Split claude_analysis on 'Red Flags:' to render the red flags section with distinct styling"
    - "SIGNAL_LABELS map from DB classification values to human-readable labels and Tailwind color classes"

key-files:
  created:
    - src/web/queries.js
    - src/web/templates.js
    - src/__tests__/dashboard.test.js
  modified: []

key-decisions:
  - "LEFT JOIN (not INNER JOIN) for signals — handles opportunities where signal extraction hasn't run yet"
  - "Split claude_analysis string on 'Red Flags:' for red flag rendering — deterministic because Claude output follows SYSTEM_PROMPT format from Phase 4"
  - "SIGNAL_LABELS exported as named const — allows router.js to import and reuse display mapping"

patterns-established:
  - "Pattern: esc() guard on all DB-originated strings in template literals — defensive against < > & in SEC filing text and Claude output"
  - "Pattern: null-guard on claude_analysis with 'Analysis pending' fallback — prevents literal 'null' string in UI"
  - "Pattern: hx-push-url='true' on feed rows — browser URL updates on HTMX swap without full page reload"

requirements-completed: [DASH-01, DASH-02]

# Metrics
duration: 15min
completed: 2026-03-30
---

# Phase 5 Plan 01: Dashboard Data and Presentation Layer Summary

**DB query functions (listOpportunities, getOpportunityDetail) and HTML template functions (renderLayout, renderFeedPage, renderDetail, esc) with 11 passing tests establishing the testable contract for DASH-01 and DASH-02**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-30T19:33:00Z
- **Completed:** 2026-03-30T19:48:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/web/queries.js` with `listOpportunities()` (LEFT JOIN on reason_classification) and `getOpportunityDetail()` (returns null for missing id, attaches full signals array)
- Created `src/web/templates.js` with `esc()`, `SIGNAL_LABELS`, `renderLayout()`, `renderFeedPage()`, and `renderDetail()` — all returning correct HTML with HTMX attributes and Tailwind classes
- Created `src/__tests__/dashboard.test.js` with 11 tests (3 query + 8 template) — all passing; full 78-test suite also green

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Wave 0 tests + query functions (queries.js)** - `ce36576` (feat)
2. **Task 2: Create template functions (templates.js) and template tests** - `54758af` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/web/queries.js` — DB query functions: listOpportunities() with LEFT JOIN signals, getOpportunityDetail() with null return
- `src/web/templates.js` — HTML template functions: esc(), SIGNAL_LABELS const, renderLayout(), renderFeedPage(), renderDetail() with Red Flags parsing
- `src/__tests__/dashboard.test.js` — 11 dashboard tests: 3 query tests, 8 template tests including null analysis fallback and Red Flags section rendering

## Decisions Made

- LEFT JOIN for signals on reason_classification: handles the common case where a newly discovered opportunity hasn't had signals extracted yet (status 'new')
- Split `claude_analysis` on `'Red Flags:'` string: Claude output format is deterministic from the SYSTEM_PROMPT established in Phase 4, making string splitting reliable
- `esc()` applied to all DB-originated strings: defensive escaping since SEC filing names and Claude text may contain `<`, `>`, `&`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `src/web/queries.js` and `src/web/templates.js` are ready to be consumed by `src/web/router.js` (Plan 05-02)
- All DASH-01 and DASH-02 testable behaviors verified via pure function tests
- Full test suite green (78/78) — no regressions from prior phases

---
*Phase: 05-dashboard*
*Completed: 2026-03-30*
