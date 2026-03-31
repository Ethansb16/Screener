---
phase: 04-ai-analysis
plan: 01
subsystem: api
tags: [anthropic, claude, batch-api, prompt-caching, sqlite, tdd]

# Dependency graph
requires:
  - phase: 03-signal-extraction
    provides: signals table with signal_name/classification/confidence rows per filing_id
  - phase: 01-foundation
    provides: db.js better-sqlite3 singleton, logger.js pino instance

provides:
  - claudeAnalyzer.js with SYSTEM_PROMPT, buildUserMessage, analyzeOpportunities exports
  - analyze.js stage wired to claudeAnalyzer (replaces stub)
  - 6-test suite covering AI-01, AI-02, AI-03 requirements

affects: [04-ai-analysis, 05-ui-dashboard, pipeline/stages/analyze.js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dependency-injected Anthropic client for test isolation (no real API calls in tests)
    - Claude Batch API: create -> poll-until-ended -> stream results pattern
    - Prompt caching with cache_control ttl 1h for batch jobs (exceeds 5-min default)
    - Idempotency via WHERE claude_analysis IS NULL filter before batch submission
    - TDD RED/GREEN: test file committed before implementation

key-files:
  created:
    - src/__tests__/analyze.test.js
    - src/ingestion/claudeAnalyzer.js
  modified:
    - src/pipeline/stages/analyze.js

key-decisions:
  - "analyzeOpportunities accepts injectable client parameter — tests pass mock object, no ANTHROPIC_API_KEY required for tests"
  - "SYSTEM_PROMPT exceeds 4,096 tokens (includes worked examples and red flag explanations) to qualify for claude-haiku-4-5 prompt cache"
  - "Poll interval is 60s with synchronous blocking loop — acceptable at 0-5 daily filings; no batch ID persistence needed"
  - "Errored/expired batch results leave claude_analysis NULL — next pipeline run retries automatically via idempotency filter"
  - "analyze.js returns same input array unchanged — claude_analysis written directly to DB during result streaming, no in-memory enrichment"

patterns-established:
  - "Pattern: Dependency-injectable client — export async function f(ids, client = createDefaultClient()) for testability without module mocking"
  - "Pattern: Batch API lifecycle — create batch, poll with setTimeout loop checking processing_status === 'ended', then stream results async iterator"
  - "Pattern: cache_control with ttl 1h on system prompt block — ensures cache survives the batch processing window (up to 1 hour)"

requirements-completed: [AI-01, AI-02, AI-03]

# Metrics
duration: 7min
completed: 2026-03-31
---

# Phase 4 Plan 01: AI Analysis Core Summary

**Claude Batch API analyzer with prompt caching, idempotent filtering, and 6-test TDD suite covering all three AI requirements**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-31T01:05:49Z
- **Completed:** 2026-03-31T01:13:01Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `claudeAnalyzer.js` with full Batch API lifecycle: submit, poll-until-ended, stream results to DB
- SYSTEM_PROMPT exceeds 4,096 tokens with detailed red flag definitions and worked examples, enabling prompt cache for `claude-haiku-4-5-20251001`
- Replaced `analyze.js` stub with real implementation wired to claudeAnalyzer; all 67 tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 — Create failing test suite** - `c1d2449` (test)
2. **Task 2: Implement claudeAnalyzer.js** - `de5fa1e` (feat)

**Plan metadata:** `4b24401` (docs: complete plan)

_Note: TDD tasks — test committed RED, implementation committed GREEN_

## Files Created/Modified

- `src/__tests__/analyze.test.js` — 6 unit tests with mock Anthropic client (AI-01, AI-02, AI-03)
- `src/ingestion/claudeAnalyzer.js` — SYSTEM_PROMPT, buildUserMessage, analyzeOpportunities with Batch API integration
- `src/pipeline/stages/analyze.js` — Replaced stub with real runAnalyze wired to claudeAnalyzer.js

## Decisions Made

- Used dependency injection (`client = createDefaultClient()`) for Anthropic client — consistent with project pattern of avoiding module mocking in node:test
- SYSTEM_PROMPT written with full examples (~900 lines) to exceed 4,096 token threshold for claude-haiku-4-5 cache eligibility
- Poll interval of 60 seconds with synchronous blocking loop — documented in code comment, acceptable at 0-5 daily filings
- Errored/expired results leave claude_analysis NULL — idempotency guarantees retry on next run without extra logic
- `analyze.js` returns input array unchanged — claude_analysis written directly to DB during streaming, avoids in-memory enrichment

## Deviations from Plan

None - plan executed exactly as written.

Minor observation: Test 2 (runAnalyze returns extracted array unchanged) passed immediately in RED phase because `analyze.js` stub was already returning its input. The plan expected all 6 to fail; 5 of 6 failed as expected due to missing claudeAnalyzer.js. This was not a deviation requiring action — the test is valid and correctly verifies the return contract.

## Issues Encountered

None — implementation proceeded cleanly. The 2-minute test suite runtime is expected behavior: the mock `retrieve` returns `'ended'` after the first 60-second poll interval fires for tests 1 and 6 (which exercise the polling path).

## User Setup Required

**ANTHROPIC_API_KEY required for production runs.** Tests use mock client injection and work without the key.

To enable real API calls in production, add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

Key available at: https://console.anthropic.com/ -> API Keys -> Create Key

## Next Phase Readiness

- `claudeAnalyzer.js` is fully tested and ready for real API calls once `ANTHROPIC_API_KEY` is set in `.env`
- `analyze.js` stage is wired — pipeline runs will now submit Claude Batch API jobs for unanalyzed opportunities
- Phase 4 Plan 02 (UI dashboard) can display `claude_analysis` text from the opportunities table

---
*Phase: 04-ai-analysis*
*Completed: 2026-03-31*
