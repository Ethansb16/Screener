---
phase: 01-foundation
plan: 02
subsystem: infra
tags: [edgar, http-client, rate-limiting, p-limit, retry, esm, node-fetch]

# Dependency graph
requires:
  - phase: 01-foundation plan 01
    provides: project bootstrap with ESM config, p-limit in package.json, db singleton
provides:
  - Rate-limited EDGAR HTTP client with User-Agent injection (edgarGet, edgarGetJson, edgarGetText)
  - CIK normalization and accession number helpers (normalizeCIK, accessionToPath)
  - Full INFRA-01 test coverage (6 tests replacing Plan 01 stubs)
affects:
  - All future phases that fetch EDGAR data (02-discovery, 03-signals, 04-analysis, 05-ui)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All EDGAR HTTP calls go through edgarClient — never call fetch() directly for SEC URLs"
    - "p-limit(8) shared limiter enforces max 8 concurrent EDGAR requests"
    - "Exponential backoff with full jitter on 429/503, max 4 attempts"
    - "SEC_USER_AGENT env var with fallback 'SpinoffScreener contact@example.com'"
    - "Read process.env per-call (not at module top) to support test isolation with ?v=N ESM cache busters"

key-files:
  created:
    - src/ingestion/edgarClient.js
    - src/lib/edgar-utils.js
  modified:
    - src/__tests__/edgarClient.test.js

key-decisions:
  - "Read process.env.SEC_USER_AGENT inside fetchWithRetry (per-call) not at module top level — ensures test isolation when mocking global fetch and re-importing via ?v=N cache busters"

patterns-established:
  - "EDGAR client pattern: single choke-point module, pLimit(8), User-Agent injection, exponential backoff"
  - "CIK normalization: always padStart(10, '0') before building EDGAR URLs"

requirements-completed: [INFRA-01]

# Metrics
duration: 12min
completed: 2026-03-28
---

# Phase 1 Plan 02: EDGAR HTTP Client Summary

**Rate-limited EDGAR fetch wrapper using p-limit(8) and exponential backoff, with User-Agent injection from env var and CIK normalization utilities**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-28T22:48:00Z
- **Completed:** 2026-03-28T23:00:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `src/lib/edgar-utils.js` with `normalizeCIK` (10-digit zero-padding), `accessionToPath` (dash removal), and URL builder helpers
- Created `src/ingestion/edgarClient.js` as single choke-point for all EDGAR HTTP traffic — exports `edgarGet`, `edgarGetJson`, `edgarGetText`
- Replaced edgarClient.test.js stub with 6 full INFRA-01 tests covering User-Agent injection, fallback, 429/503 retry, max retries, and non-retryable errors
- All 19 tests pass (7 db + 6 edgarClient + 4 runner/scheduler stubs)

## Task Commits

Each task was committed atomically:

1. **Task 1: EDGAR utility helpers** - `75d6e54` (feat)
2. **Task 2: RED phase - failing INFRA-01 tests** - `1ae87cd` (test)
3. **Task 2: GREEN phase - edgarClient implementation** - `018302a` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD task had separate test and implementation commits (RED then GREEN)_

## Files Created/Modified
- `src/lib/edgar-utils.js` - CIK normalization, accession-to-path, and EDGAR URL builders
- `src/ingestion/edgarClient.js` - Rate-limited fetch wrapper (pLimit 8, User-Agent, backoff retry)
- `src/__tests__/edgarClient.test.js` - 6 INFRA-01 tests replacing stub

## Decisions Made
- Read `process.env.SEC_USER_AGENT` per-call inside `fetchWithRetry` rather than at module top level. This ensures the env var is evaluated at fetch time, enabling test isolation when tests mock global fetch and re-import the module via `?v=N` ESM cache busters. Without this, tests 1 and 2 (which set/delete the env var before each import) would see the value captured at module initialization time.

## Deviations from Plan

None - plan executed exactly as written. The plan explicitly noted the per-call env var reading pattern as the recommended approach for test isolation.

## Issues Encountered
- None. The `?v=N` ESM cache buster pattern for Node.js test isolation worked as expected with per-call env var reading.

## User Setup Required
None - no external service configuration required. Set `SEC_USER_AGENT` in `.env` before making live EDGAR requests.

## Next Phase Readiness
- EDGAR client is complete and ready for all future phases to import
- Plan 03 (scheduler) can import `edgarGet` / `edgarGetJson` from `src/ingestion/edgarClient.js`
- Phase 02 (discovery) will use `edgarGetJson` for submissions API calls and `normalizeCIK` from edgar-utils

---
*Phase: 01-foundation*
*Completed: 2026-03-28*
