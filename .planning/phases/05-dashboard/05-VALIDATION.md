---
phase: 5
slug: dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none |
| **Quick run command** | `node --test src/__tests__/dashboard.test.js` |
| **Full suite command** | `node --test src/__tests__/db.test.js src/__tests__/edgarClient.test.js src/__tests__/runner.test.js src/__tests__/scheduler.test.js src/__tests__/discover.test.js src/__tests__/classify.test.js src/__tests__/lifecycle.test.js src/__tests__/extract.test.js src/__tests__/analyze.test.js src/__tests__/dashboard.test.js` |
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
| 5-01-01 | 05-01 | 0 | DASH-01, DASH-02 | unit | `node --test src/__tests__/dashboard.test.js` | ❌ W0 | ⬜ pending |
| 5-01-02 | 05-01 | 1 | DASH-01, DASH-02 | unit | `node --test src/__tests__/dashboard.test.js` | ✅ W0 | ⬜ pending |
| 5-02-01 | 05-02 | 2 | DASH-01, DASH-02 | unit | `node --test src/__tests__/dashboard.test.js` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/dashboard.test.js` — stubs for DASH-01 (feed list HTML, HTMX fragment branching) and DASH-02 (detail view with 4 signals, null claude_analysis fallback, 404/400 responses)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser renders feed list with correct Tailwind styling and HTMX click-to-detail swap | DASH-01, DASH-02 | Visual rendering requires a browser; HTMX DOM manipulation not testable with mock req/res | Start server with `node src/main.js`, open `http://localhost:3000`, click a spinoff row, confirm detail panel updates without full page reload |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
