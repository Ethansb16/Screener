---
phase: 03-signal-extraction
plan: "01"
subsystem: signal-extraction
tags: [schema, tdd, node-html-parser, signals-table, wave-0]
dependency_graph:
  requires: [02-discovery]
  provides: [signals-table, extract-test-scaffolding]
  affects: [src/db/schema.js, src/__tests__/extract.test.js]
tech_stack:
  added: [node-html-parser@7.1.0]
  patterns: [TDD Wave 0, ESM cache-busting with ?v=N, INSERT OR REPLACE idempotency]
key_files:
  created:
    - src/__tests__/extract.test.js
  modified:
    - src/db/schema.js
    - package.json
    - package-lock.json
decisions:
  - "16 tests written covering all 4 classifiers — 15 fail (signalExtractor.js not yet created), 1 passes (runExtract stub already exists)"
  - "storeSignal storage tests use real DB singleton with FK-safe setup: insert filing row first, then signal, cleanup in after()"
  - "Each classifier test uses a unique ?v=N version to guarantee ESM module isolation"
metrics:
  duration_minutes: 3
  completed_date: "2026-03-29"
  tasks_completed: 2
  files_changed: 4
---

# Phase 03 Plan 01: Schema Foundation and Test Scaffolding Summary

**One-liner:** signals table added to SQLite schema and Wave 0 failing TDD tests created for four signal classifiers using node-html-parser dependency.

## What Was Built

1. **node-html-parser installed** — production dependency `node-html-parser@7.1.0` added to `package.json`. Required by Plan 02 for parsing EDGAR HTML filings.

2. **signals table in schema** — `src/db/schema.js` extended with:
   - `signals` table: `id`, `filing_id` (FK to filings), `signal_name`, `classification`, `confidence`, `raw_excerpt`, `extracted_at`
   - `UNIQUE(filing_id, signal_name)` constraint enabling `INSERT OR REPLACE` idempotency on re-runs
   - Two indexes: `idx_signals_filing_id`, `idx_signals_signal_name`
   - Signal name values: `reason_classification`, `equity_grants`, `debt_loading`, `management_continuity`

3. **Wave 0 failing test file** — `src/__tests__/extract.test.js` with 16 test cases:
   - `describe('SIG-01: Reason Classification')` — 4 tests for `classifyReasons`
   - `describe('SIG-02: Equity Grants')` — 3 tests for `classifyEquityGrants`
   - `describe('SIG-03: Debt Loading')` — 3 tests for `classifyDebtLoading`
   - `describe('SIG-04: Management Continuity')` — 3 tests for `classifyManagement`
   - `describe('Signal Storage')` — 2 tests for `storeSignal` (insert + idempotency)
   - `describe('runExtract integration')` — 1 test for `runExtract([])`

## Test State After Plan 01

- 15 tests FAIL: All `signalExtractor.js` imports throw `ERR_MODULE_NOT_FOUND` (Wave 0 = RED — correct)
- 1 test PASSES: `runExtract([])` returns empty array (stub in `extract.js` already works)
- Exit code: 1 (non-zero, as required by Wave 0 contract)

## Regression Check

All 45 pre-existing tests pass without modification:
- `db.test.js`, `edgarClient.test.js`, `runner.test.js`, `scheduler.test.js`
- `discover.test.js`, `classify.test.js`, `lifecycle.test.js`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1: Schema + npm install | 89a9a65 | feat(03-01): install node-html-parser and add signals table to schema |
| 2: Wave 0 test file | 92dd534 | test(03-01): add failing Wave 0 test scaffolding for signal extraction |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None that block this plan's goal. `runExtract` in `src/pipeline/stages/extract.js` is an intentional stub from Phase 1 — Plan 02 will implement the real extraction logic. The `runExtract([])` test intentionally passes against the stub.

## Self-Check: PASSED

- `src/__tests__/extract.test.js` exists: FOUND
- `src/db/schema.js` contains signals table: FOUND
- Commit 89a9a65 exists: FOUND
- Commit 92dd534 exists: FOUND
- `node-html-parser` installed: FOUND (v7.1.0)
