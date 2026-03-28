---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, no install needed) |
| **Config file** | none — Wave 0 creates test stubs |
| **Quick run command** | `node --test src/__tests__/` |
| **Full suite command** | `node --test src/__tests__/` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test src/__tests__/`
- **After every plan wave:** Run `node --test src/__tests__/`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | INFRA-01 | unit | `node --test src/__tests__/edgarClient.test.js` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 0 | INFRA-02 | unit | `node --test src/__tests__/db.test.js` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 0 | INFRA-03 | unit | `node --test src/__tests__/scheduler.test.js` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 0 | INFRA-04 | unit | `node --test src/__tests__/runner.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/edgarClient.test.js` — stubs for INFRA-01 (User-Agent header, rate limit)
- [ ] `src/__tests__/db.test.js` — stubs for INFRA-02 (idempotent upsert, schema)
- [ ] `src/__tests__/scheduler.test.js` — stubs for INFRA-03 (cron fires, run_log written)
- [ ] `src/__tests__/runner.test.js` — stubs for INFRA-04 (four stages sequential, each independently callable)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live EDGAR request succeeds with correct User-Agent | INFRA-01 | Requires real SEC network call | Run `node -e "import('./src/edgarClient.js').then(m => m.edgarGet('/submissions/CIK0000320193.json').then(r => console.log(r.status)))"` and confirm 200 |
| Cron fires at configured time | INFRA-03 | Time-dependent | Set `CRON_SCHEDULE=* * * * *`, start server, wait 1 min, check run_log table has new entry |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
