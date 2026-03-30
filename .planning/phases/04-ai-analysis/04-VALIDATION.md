---
phase: 4
slug: ai-analysis
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none |
| **Quick run command** | `node --test src/__tests__/analyze.test.js` |
| **Full suite command** | `node --test src/__tests__/db.test.js src/__tests__/edgarClient.test.js src/__tests__/runner.test.js src/__tests__/scheduler.test.js src/__tests__/discover.test.js src/__tests__/classify.test.js src/__tests__/lifecycle.test.js src/__tests__/extract.test.js src/__tests__/analyze.test.js` |
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
| 4-01-01 | 04-01 | 0 | AI-01, AI-02, AI-03 | unit | `node --test src/__tests__/analyze.test.js` | ❌ W0 | ⬜ pending |
| 4-01-02 | 04-01 | 1 | AI-01, AI-02, AI-03 | unit | `node --test src/__tests__/analyze.test.js` | ✅ W0 | ⬜ pending |
| 4-02-01 | 04-02 | 2 | AI-01, AI-02, AI-03 | unit | `node --test src/__tests__/analyze.test.js` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/analyze.test.js` — stubs for AI-01 (claude_analysis written to DB), AI-02 (system prompt red flag callouts), AI-03 (idempotency, early return, errored results handling)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Batch API call succeeds and writes analysis to DB | AI-01, AI-03 | Requires real ANTHROPIC_API_KEY and live API | Set `ANTHROPIC_API_KEY` in `.env`, insert a test opportunity, run `node -e "import('./src/pipeline/stages/analyze.js').then(m => m.runAnalyze([1]))"` and confirm `claude_analysis` populated |
| System prompt caching activates (cache read tokens > 0) | AI-03 | Requires live API with cache TTL validation | Run pipeline twice; check `usage.cache_read_input_tokens > 0` in second run logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
