---
phase: 2
slug: discovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none |
| **Quick run command** | `node --test src/__tests__/discover.test.js` |
| **Full suite command** | `node --test src/__tests__/db.test.js src/__tests__/edgarClient.test.js src/__tests__/runner.test.js src/__tests__/scheduler.test.js src/__tests__/discover.test.js src/__tests__/classify.test.js src/__tests__/lifecycle.test.js` |
| **Estimated runtime** | ~12 seconds |

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
| 2-01-01 | 02-01 | 0 | DISC-01 | unit | `node --test src/__tests__/discover.test.js` | ❌ W0 | ⬜ pending |
| 2-01-02 | 02-01 | 1 | DISC-01 | unit | `node --test src/__tests__/discover.test.js` | ✅ W0 | ⬜ pending |
| 2-02-01 | 02-02 | 0 | DISC-02 | unit | `node --test src/__tests__/classify.test.js` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02-02 | 2 | DISC-02 | unit | `node --test src/__tests__/classify.test.js` | ✅ W0 | ⬜ pending |
| 2-03-01 | 02-03 | 0 | DISC-03 | unit | `node --test src/__tests__/lifecycle.test.js` | ❌ W0 | ⬜ pending |
| 2-03-02 | 02-03 | 2 | DISC-03 | unit | `node --test src/__tests__/lifecycle.test.js` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/discover.test.js` — stubs for DISC-01 (EFTS search, filing storage)
- [ ] `src/__tests__/classify.test.js` — stubs for DISC-02 (deal type classification)
- [ ] `src/__tests__/lifecycle.test.js` — stubs for DISC-03 (lifecycle state transitions)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live EFTS search returns real 10-12B filings | DISC-01 | Requires live SEC network call | Run `node -e "import('./src/ingestion/edgarClient.js').then(m => m.edgarSearch({q:'\"spin-off\"',forms:'10-12B',dateRange:'custom',startdt:'2024-01-01',enddt:'2024-12-31'}).then(r => console.log(JSON.stringify(r.hits?.hits?.slice(0,2), null, 2))))"` |
| EFFECT filing detected for known spinoff | DISC-03 | Requires live SEC data for known CIK | Manually check submissions for a known confirmed spinoff CIK |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
