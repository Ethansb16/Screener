---
phase: 3
slug: signal-extraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none |
| **Quick run command** | `node --test src/__tests__/extract.test.js` |
| **Full suite command** | `node --test src/__tests__/db.test.js src/__tests__/edgarClient.test.js src/__tests__/runner.test.js src/__tests__/scheduler.test.js src/__tests__/discover.test.js src/__tests__/classify.test.js src/__tests__/lifecycle.test.js src/__tests__/extract.test.js` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick command for the relevant test file
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 03-01 | 0 | SIG-01–04 | unit | `node --test src/__tests__/extract.test.js` | ❌ W0 | ⬜ pending |
| 3-01-02 | 03-01 | 1 | SIG-01–04 | unit | `node --test src/__tests__/extract.test.js` | ✅ W0 | ⬜ pending |
| 3-02-01 | 03-02 | 0 | SIG-01 | unit | `node --test src/__tests__/extract.test.js` | ❌ W0 | ⬜ pending |
| 3-02-02 | 03-02 | 2 | SIG-01 | unit | `node --test src/__tests__/extract.test.js` | ✅ W0 | ⬜ pending |
| 3-03-01 | 03-03 | 2 | SIG-02 | unit | `node --test src/__tests__/extract.test.js` | ✅ W0 | ⬜ pending |
| 3-04-01 | 03-04 | 2 | SIG-03 | unit | `node --test src/__tests__/extract.test.js` | ✅ W0 | ⬜ pending |
| 3-05-01 | 03-05 | 2 | SIG-04 | unit | `node --test src/__tests__/extract.test.js` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/extract.test.js` — stubs for SIG-01–04 (signal classifiers, storeSignal idempotency, runExtract)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Form 10 document fetch resolves Exhibit 99.1 for a real filing | SIG-01–04 | Requires live EDGAR network call with real accession number | Run `node -e "import('./src/ingestion/formFetcher.js').then(m => m.fetchForm10Text('0001193125-16-760799').then(t => console.log(t.slice(0,500))))"` |
| Section heading locator finds "Reasons for the Distribution" in a 2024-2025 Form 10 | SIG-01 | Requires real filing HTML — structure varies per filer | Manually test against 3 real 10-12B filings and confirm `classification` is not `unknown` for each |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
