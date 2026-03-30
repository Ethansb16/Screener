---
phase: 03-signal-extraction
verified: 2026-03-29T17:50:30Z
status: passed
score: 13/13 must-haves verified
re_verification: false
---

# Phase 3: Signal Extraction Verification Report

**Phase Goal:** For each spinoff candidate, the system extracts four structured signals from the Form 10 text.
**Verified:** 2026-03-29T17:50:30Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | The signals table exists with columns filing_id, signal_name, classification, confidence, raw_excerpt | VERIFIED | `src/db/schema.js` lines 70-81: CREATE TABLE IF NOT EXISTS signals with all required columns, UNIQUE(filing_id, signal_name), two indexes |
| 2  | node-html-parser is installed and importable | VERIFIED | `package.json` dependencies contains `node-html-parser`; used in form10Fetcher.js line 13 |
| 3  | classifyReasons returns strategic_focus, weak_unit_disposal, mixed, or unknown from section text | VERIFIED | `signalExtractor.js` lines 206-227; all 4 classifier tests pass (16/16 suite green) |
| 4  | classifyEquityGrants returns equity_grants_confirmed, no_equity_grants, or unknown | VERIFIED | `signalExtractor.js` lines 235-247; 3 tests pass |
| 5  | classifyDebtLoading returns excessive_debt, moderate_debt, no_debt_concern, or unknown | VERIFIED | `signalExtractor.js` lines 255-268; 3 tests pass |
| 6  | classifyManagement returns strong_leaders_moving, leaders_staying_at_parent, mixed, or unknown | VERIFIED | `signalExtractor.js` lines 276-297; 3 tests pass |
| 7  | storeSignal writes a signal row using INSERT OR REPLACE for idempotency | VERIFIED | `signalExtractor.js` lines 112-117, 312-320; idempotency test passes — second call with same (filing_id, signal_name) produces exactly 1 row |
| 8  | fetchForm10Document resolves the correct exhibit URL from a filing index JSON and returns parsed HTML DOM | VERIFIED | `form10Fetcher.js` 109 lines; resolves EX-99.1 > 10-12B/A > .htm fallback; returns parse(html) |
| 9  | locateSection finds named sections using three strategies | VERIFIED | `signalExtractor.js` lines 171-194; strategy 1 heading tags, strategy 2 bold paragraphs, strategy 3 full-text fallback |
| 10 | runExtract receives opportunity IDs, looks up filings, extracts signals, and returns results | VERIFIED | `extract.js` lines 14-43; JOIN query to get filing from oppId, calls extractSignalsForFiling |
| 11 | A filing that fails extraction does not crash the pipeline | VERIFIED | `extract.js` lines 25-38; per-opportunity try/catch with logger.warn, continues to next |
| 12 | runExtract with an empty array returns an empty array immediately | VERIFIED | `extract.js` line 22; confirmed by passing test: `runExtract([]) returns empty array without error` |
| 13 | Signals are stored in the DB during runExtract execution via storeSignal | VERIFIED | `extract.js` calls `extractSignalsForFiling` which calls `storeSignal` via the SIGNAL_DEFINITIONS loop in `signalExtractor.js` |

**Score:** 13/13 truths verified

---

### Required Artifacts

| Artifact | Min Lines | Actual Lines | Status | Details |
|----------|-----------|--------------|--------|---------|
| `src/db/schema.js` | — | 84 | VERIFIED | signals table with all required columns, UNIQUE constraint, and two indexes present at lines 70-81 |
| `src/__tests__/extract.test.js` | 80 | 216 | VERIFIED | 16 test cases covering all four classifiers, storeSignal insert, storeSignal idempotency, and runExtract empty-input |
| `src/ingestion/form10Fetcher.js` | 40 | 109 | VERIFIED | Exports fetchForm10Document and resolveDocumentUrl; uses edgarGetJson/edgarGetText exclusively; no bare fetch(); no Promise.all |
| `src/ingestion/signalExtractor.js` | 120 | 384 | VERIFIED | Exports classifyReasons, classifyEquityGrants, classifyDebtLoading, classifyManagement, storeSignal, locateSection, extractSignalsForFiling; all keyword arrays present |
| `src/pipeline/stages/extract.js` | 30 | 43 | VERIFIED | Real runExtract replaces stub; imports extractSignalsForFiling; JOIN query for filing lookup; sequential for-loop; per-item try/catch |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/__tests__/extract.test.js` | `src/ingestion/signalExtractor.js` | import of classifier functions | WIRED | Lines 63, 70, 76, 82, 94, 100, 106, 119, 125, 131, 144, 150, 156, 168, 188 — each test imports from `../ingestion/signalExtractor.js?vN` |
| `src/ingestion/form10Fetcher.js` | `src/ingestion/edgarClient.js` | import edgarGetJson, edgarGetText | WIRED | Line 12: `import { edgarGetJson, edgarGetText } from './edgarClient.js'` — both used in fetchForm10Document |
| `src/ingestion/signalExtractor.js` | `src/ingestion/form10Fetcher.js` | import fetchForm10Document | WIRED | Line 10: `import { fetchForm10Document } from './form10Fetcher.js'` — called at line 359 in extractSignalsForFiling |
| `src/ingestion/signalExtractor.js` | `src/db/db.js` | import db for storeSignal prepared statement | WIRED | Line 8: `import db from '../db/db.js'` — used at line 112 for module-level upsertSignal prepared statement |
| `src/pipeline/stages/extract.js` | `src/ingestion/signalExtractor.js` | import extractSignalsForFiling | WIRED | Line 9: `import { extractSignalsForFiling } from '../../ingestion/signalExtractor.js'` — called at line 33 |
| `src/pipeline/stages/extract.js` | `src/db/db.js` | import db for opportunity->filing lookup | WIRED | Line 10: `import db from '../../db/db.js'` — used at line 14 for findFilingByOpportunity prepared statement |
| `src/pipeline/runner.js` | `src/pipeline/stages/extract.js` | existing import of runExtract | WIRED | Line 4: `import { runExtract } from './stages/extract.js'` — called at line 27 in pipeline chain |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `extract.js` (runExtract) | `results` array | `extractSignalsForFiling(filing)` called after DB JOIN lookup | Yes — JOIN query on opportunities+filings, returns real filing row to feed into signalExtractor | FLOWING |
| `signalExtractor.js` (extractSignalsForFiling) | signal result objects | `fetchForm10Document(filing)` then `locateSection` + classifier | Yes — fetches live EDGAR HTML, extracts section text, keyword-matches, stores via INSERT OR REPLACE | FLOWING |
| `signalExtractor.js` (storeSignal) | DB persistence | `upsertSignal.run(...)` INSERT OR REPLACE with real params | Yes — writes filing_id, signal_name, classification, confidence, raw_excerpt to signals table | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 16 extract tests pass | `node --test src/__tests__/extract.test.js` | 16 pass, 0 fail | PASS |
| Full regression suite unaffected | `node --test src/__tests__/db.test.js ...lifecycle.test.js` | 45 pass, 0 fail | PASS |
| `runExtract([])` returns empty array | covered by test suite | assert.equal(result.length, 0) passes | PASS |
| storeSignal idempotency | covered by test suite | second INSERT OR REPLACE produces 1 row | PASS |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SIG-01 | 03-01, 03-02, 03-03 | Reason classification from Form 10 "Reasons for the Distribution" section — strategic focus vs. disposal of weak unit | SATISFIED | `classifyReasons` in signalExtractor.js uses STRATEGIC_FOCUS_KEYWORDS and WEAK_UNIT_KEYWORDS; locateSection uses `reasons_for_distribution` pattern; stored as `reason_classification`; 4 tests cover all branches |
| SIG-02 | 03-01, 03-02, 03-03 | Detects whether SpinCo management receives equity grants (bullish alignment signal) | SATISFIED | `classifyEquityGrants` in signalExtractor.js uses EQUITY_GRANT_KEYWORDS (10 patterns); locateSection uses `executive_compensation` pattern; stored as `equity_grants`; 3 tests pass |
| SIG-03 | 03-01, 03-02, 03-03 | Checks capitalization section for excessive debt on SpinCo (bearish debt-stuffing signal) | SATISFIED | `classifyDebtLoading` in signalExtractor.js uses EXCESSIVE_DEBT_KEYWORDS (10 patterns); locateSection uses `capitalization` pattern; stored as `debt_loading`; 3 tests pass |
| SIG-04 | 03-01, 03-02, 03-03 | Identifies whether strong leaders are moving to SpinCo or staying at parent (management continuity signal) | SATISFIED | `classifyManagement` in signalExtractor.js uses SPINCO_LEADERSHIP_KEYWORDS and PARENT_RETENTION_KEYWORDS; locateSection uses `management` pattern; stored as `management_continuity`; 3 tests pass |

**Requirements from REQUIREMENTS.md traceability table:** SIG-01 through SIG-04 all marked Complete for Phase 3. No orphaned requirements found — all four IDs are claimed by all three plans (03-01, 03-02, 03-03) and all are implemented.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

Scan notes:
- No TODO/FIXME/HACK/PLACEHOLDER comments in any phase-3 files
- No empty return stubs (`return null`, `return []`, `return {}`) in hot paths — the null return in form10Fetcher.js and signalExtractor.js is intentional graceful failure documented in JSDoc, not a stub
- No hardcoded empty data flowing to rendering paths
- No bare `fetch()` calls — all EDGAR requests go through edgarClient.js
- No `Promise.all()` — all fetches are sequential (EDGAR rate-cap requirement)
- storeSignal uses INSERT OR REPLACE with real bound parameters, not static data

---

### Human Verification Required

#### 1. Live EDGAR Fetch End-to-End

**Test:** Run the full pipeline against a real Form 10-12B filing for a known spinoff. Confirm that all four signals are written to the signals table with non-`not_found` confidence values.
**Expected:** Signals table contains 4 rows for the filing with meaningful classifications (e.g., `strategic_focus` with `high` confidence, `equity_grants_confirmed`).
**Why human:** Requires a live EDGAR network call; cannot verify without starting the pipeline or mocking the full EDGAR response chain.

#### 2. Section Locator on Real EDGAR HTML

**Test:** Manually inspect the parsed section text extracted by `locateSection` for a real Form 10 filing to confirm the three-strategy approach successfully locates the correct sections.
**Expected:** Each of the four patternKeys (`reasons_for_distribution`, `executive_compensation`, `capitalization`, `management`) returns a non-null text excerpt containing recognizable content from the correct section.
**Why human:** EDGAR HTML structure varies significantly across filings; programmatic verification of section-locating accuracy requires representative real documents.

---

### Gaps Summary

No gaps. All automated checks pass. The phase goal — extracting four structured signals per spinoff candidate from Form 10 text — is fully achieved:

- The signals table schema is in place with idempotency constraints.
- The Form 10 HTML fetcher resolves the correct exhibit document from the EDGAR filing index.
- All four signal classifiers are implemented as pure functions with complete keyword sets matching the research specification.
- The `locateSection` multi-strategy DOM locator handles heading tags, bold paragraphs, and full-text fallback.
- `storeSignal` persists with INSERT OR REPLACE for safe re-runs.
- `runExtract` integrates into the pipeline: it receives opportunity IDs from `runDiscover`, joins to the filings table, and calls `extractSignalsForFiling` per opportunity with per-item error containment.
- 16/16 extract tests pass. 45/45 regression tests pass. No regressions in previously passing test suites.

The two human verification items are live-network integration checks; they are not blockers for phase completion.

---

_Verified: 2026-03-29T17:50:30Z_
_Verifier: Claude (gsd-verifier)_
