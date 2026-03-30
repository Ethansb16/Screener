# Phase 4: AI Analysis - Research

**Researched:** 2026-03-29
**Domain:** Anthropic Message Batches API, prompt caching, Node.js ESM SDK integration
**Confidence:** HIGH

---

## Summary

Phase 4 replaces the `runAnalyze` stub with a real Claude integration that generates plain-English spinoff summaries with red flag callouts. The `@anthropic-ai/sdk@0.80.0` (current latest) is already installed. The Batch API (`anthropic.messages.batches`) submits all pending opportunities as a single asynchronous job, polls until `processing_status === 'ended'`, then streams results back and writes `claude_analysis` to the `opportunities` table.

The `claude_analysis` column already exists in `schema.js` — no schema migration is needed. Idempotency is straightforward: query `WHERE claude_analysis IS NULL` before building the batch, which guarantees already-analyzed records are never re-submitted. The Batch API costs 50% of standard pricing; combining it with prompt caching (system prompt cached at 1-hour TTL for batch jobs) yields an additional 90% reduction on cached tokens.

The optimal model for this use case is `claude-haiku-4-5-20251001` (alias: `claude-haiku-4-5`): $0.50/MTok input, $2.50/MTok output after 50% batch discount — cheapest current model that supports prompt caching. The daily spinoff volume is typically 0–5 filings, so absolute cost is negligible, but the idempotency and caching architecture is required by AI-03.

**Primary recommendation:** Implement `runAnalyze` as a three-step function: (1) query unanalyzed opportunities with their signals, (2) submit Batch API job, (3) poll-then-stream results back, writing `claude_analysis` per opportunity. Use a separate `claudeAnalyzer.js` module with the pure logic; wire it into the stage in `analyze.js`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-01 | Claude generates a plain-English summary of each spinoff explaining what happened and the opportunity thesis | Batch API with `custom_id = oppId` maps results back to DB rows; text content of assistant response stored as `claude_analysis` |
| AI-02 | Claude explicitly calls out red flags (debt stuffing, management exodus, weak-unit disposal language) in each summary | System prompt instructs Claude to name red flags explicitly when signal classifications are `excessive_debt`, `leaders_staying_at_parent`, or `weak_unit_disposal`; signal data is injected into each per-request user message |
| AI-03 | Claude API integration uses Batch API and prompt caching to minimize cost on daily batch runs; already-processed records never re-sent | `WHERE claude_analysis IS NULL` filter at query time; Batch API at 50% discount; system prompt `cache_control` with `"ttl": "1h"` to survive the batch window |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | 0.80.0 (installed, current latest) | Anthropic API client — Batch API, polling, result streaming | Official SDK; already installed |

### No New Packages Required

All dependencies are present. No `npm install` needed for Phase 4.

### Model Selection

| Model | API ID | Batch Input | Batch Output | Cache Min Tokens | Use Case |
|-------|--------|-------------|--------------|-----------------|----------|
| **claude-haiku-4-5** (recommended) | `claude-haiku-4-5-20251001` | $0.50/MTok | $2.50/MTok | 4,096 tokens | Cost-optimal for structured summary generation |
| claude-sonnet-4-6 | `claude-sonnet-4-6` | $1.50/MTok | $7.50/MTok | 2,048 tokens | Higher quality if summaries need to be richer |

Use `claude-haiku-4-5-20251001` as the default. The system prompt alone (with full red flag instructions) will exceed 4,096 tokens once written with examples; verify by checking `cache_creation_input_tokens` on first run.

**Version verification:** `npm view @anthropic-ai/sdk version` returns `0.80.0` — confirmed current as of 2026-03-29.

---

## Architecture Patterns

### Recommended File Structure

```
src/
├── ingestion/
│   ├── claudeAnalyzer.js    # NEW: pure analysis logic (buildBatch, pollBatch, streamResults)
│   └── signalExtractor.js   # existing
├── pipeline/stages/
│   └── analyze.js           # Replace stub — calls claudeAnalyzer.js
└── __tests__/
    └── analyze.test.js      # NEW: Wave 0 tests
```

### Pattern 1: Idempotent Opportunity Query

Before building the batch, only fetch rows without an existing analysis:

```javascript
// Source: schema.js (opportunities table, claude_analysis column already exists)
const getPendingOpportunities = db.prepare(`
  SELECT o.id, o.company_name, o.spinoff_target, o.signal_type
  FROM opportunities o
  WHERE o.claude_analysis IS NULL
    AND o.signal_type = 'spinoff'
`);
```

This is the idempotency guarantee required by AI-03. Runs that find zero pending rows skip the Batch API call entirely — no API call, no charge.

### Pattern 2: Fetch Signals for Pending Opportunities

```javascript
// Join signals for each pending opportunity
const getSignalsForOpp = db.prepare(`
  SELECT signal_name, classification, confidence
  FROM signals
  WHERE filing_id = (
    SELECT filing_id FROM opportunities WHERE id = ?
  )
`);
```

### Pattern 3: Batch Submission (TypeScript-style, applies to ESM JS)

```javascript
// Source: official Anthropic docs — https://platform.claude.com/docs/en/docs/build-with-claude/message-batches
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const batch = await anthropic.messages.batches.create({
  requests: opportunities.map(opp => ({
    custom_id: String(opp.id),           // use oppId as custom_id for result mapping
    params: {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,            // static instructions — cached
          cache_control: { type: 'ephemeral', ttl: '1h' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: buildUserMessage(opp)  // per-opportunity signal data — not cached
        }
      ]
    }
  }))
});
// batch.id is the batch ID; batch.processing_status starts as 'in_progress'
```

**Why `ttl: '1h'`:** The Batch API documentation explicitly recommends 1-hour cache TTL for batch jobs because batches can take longer than 5 minutes to process. Default 5-minute ephemeral cache would expire before the batch completes, losing the cache benefit for all requests processed after the first ~5 minutes.

### Pattern 4: Poll Until Ended

```javascript
// Source: official docs polling loop
const POLL_INTERVAL_MS = 60_000; // 60 seconds

async function waitForBatch(batchId) {
  while (true) {
    const batch = await anthropic.messages.batches.retrieve(batchId);
    if (batch.processing_status === 'ended') return batch;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}
```

### Pattern 5: Stream Results and Persist

```javascript
// Source: official docs result streaming
for await (const result of await anthropic.messages.batches.results(batchId)) {
  if (result.result.type === 'succeeded') {
    const oppId = Number(result.custom_id);
    const text = result.result.message.content[0].text;
    updateClaudeAnalysis.run(text, oppId);
  } else {
    logger.warn({ custom_id: result.custom_id, type: result.result.type },
      'Batch result non-success');
    // errored / expired — leave claude_analysis NULL; next run will retry
  }
}
```

Persist with:
```javascript
const updateClaudeAnalysis = db.prepare(
  `UPDATE opportunities SET claude_analysis = ? WHERE id = ?`
);
```

### Pattern 6: Analyze Stage Return Contract

The `runAnalyze` stage receives `Array<{oppId, signals}>` from `runExtract` and must return the same structure augmented for `runPersist`. Looking at `runner.js`, `runPersist(analyzed)` consumes the output. Since `runPersist` uses the DB-backed signal data (not in-memory), the analyze stage can return the same input array unchanged — the `claude_analysis` is written directly to the DB during result streaming.

```javascript
// analyze.js — replace stub
export async function runAnalyze(extracted = []) {
  if (!extracted.length) return extracted;
  await analyzeOpportunities(extracted.map(e => e.oppId));
  return extracted; // pass through for persist stage
}
```

### Pattern 7: Prompt Structure for Red Flags

The system prompt must instruct Claude to:
1. Summarize the spinoff event in plain English
2. Identify the opportunity thesis from signal data
3. Explicitly call out red flags when signals match bearish classifications

Red flag trigger conditions (from `signalExtractor.js` classifier output):

| Signal Name | Bearish Classification | Red Flag Label |
|---|---|---|
| `reason_classification` | `weak_unit_disposal` | Weak-unit disposal language |
| `debt_loading` | `excessive_debt` | Debt stuffing |
| `management_continuity` | `leaders_staying_at_parent` | Management exodus (leaders staying at parent) |
| `equity_grants` | `no_equity_grants` | No insider equity alignment |

The user message per opportunity injects the four signals as structured text so Claude can interpret them without external knowledge of the filing.

### Anti-Patterns to Avoid

- **Don't poll on every pipeline run to check batch status from a previous run.** The analyze stage should be synchronous within the pipeline run: submit batch, poll until done, write results. The batch completes within ~1 hour per docs; since daily runs happen once per day at cron time, a blocking poll of up to 1 hour is acceptable.
- **Don't use `cache_control` on the per-request user message.** Only the static system prompt should be cached; the user message contains unique per-opportunity signal data and will differ for every request.
- **Don't use `custom_id` as a business key that can collide.** Use the integer `oppId` cast to string. IDs are autoincrement — no collisions possible.
- **Don't store the batch ID in the DB between runs.** Phase 4 is synchronous: submit, poll, write. There is no resume-from-batch-ID logic needed at daily spinoff volumes (0–5 records).
- **Don't use `node:test` mock.module for the Anthropic SDK.** Node's built-in test runner has limited module mocking. The pattern used in this project is dependency injection: accept an `anthropic` client parameter (defaulting to a real client) so tests can pass a mock object directly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Batch job submission | Custom fetch loop to `/v1/messages` | `anthropic.messages.batches.create()` | SDK handles auth, retries, serialization |
| Result streaming | Manual JSONL line-by-line parser | `anthropic.messages.batches.results(batchId)` | SDK streams and deserializes JSONL automatically |
| Retry on transient errors | Manual exponential backoff | SDK's built-in retry (2 retries by default) | SDK retries `5xx` and `429` automatically |
| Prompt construction | String template with manual escaping | Plain template literals | No special escaping needed for Anthropic API |

**Key insight:** The SDK's `batches.results()` returns an async iterator that streams the JSONL result file in memory-efficient chunks. Avoid downloading the full result file manually via `results_url`.

---

## Common Pitfalls

### Pitfall 1: Cache Miss on Batch (5-Minute Default TTL)

**What goes wrong:** Using default `{ type: 'ephemeral' }` (5-minute TTL) on the system prompt. The batch takes longer than 5 minutes; requests processed after the TTL expires pay full input token cost on the system prompt.

**Why it happens:** The default ephemeral cache is designed for interactive, sub-5-minute conversations.

**How to avoid:** Use `cache_control: { type: 'ephemeral', ttl: '1h' }` on the system prompt block. Documented explicitly in the Batch API docs: "consider using the 1-hour cache duration with prompt caching for better cache hit rates when processing batches."

**Warning signs:** Check `cache_read_input_tokens` vs `cache_creation_input_tokens` in usage stats across batch results. If `cache_read_input_tokens` is 0 for most results, the cache expired.

### Pitfall 2: System Prompt Below Cache Minimum Tokens

**What goes wrong:** System prompt is under 4,096 tokens (for `claude-haiku-4-5`). The cache_control is silently ignored — no error, no cache.

**Why it happens:** The minimum token threshold for Haiku 4.5 is 4,096 tokens. A short system prompt won't be cached even with `cache_control` set.

**How to avoid:** Write a thorough system prompt with full red flag instructions and examples to exceed the 4,096-token threshold. Verify by checking `cache_creation_input_tokens > 0` in the first batch result's usage object.

**Warning signs:** Both `cache_creation_input_tokens` and `cache_read_input_tokens` are 0 in usage response.

### Pitfall 3: Batch Results in Non-Deterministic Order

**What goes wrong:** Assuming batch results arrive in the same order as the submitted requests, then mapping results by position index.

**Why it happens:** The Batch API processes requests concurrently and returns results as they complete.

**How to avoid:** Always map results using `result.custom_id` (which equals the `oppId`), not by array position.

**Warning signs:** Analysis text stored on the wrong opportunity row.

### Pitfall 4: Empty Batch Submission

**What goes wrong:** Submitting a batch with zero requests when all opportunities are already analyzed. The SDK will throw or the API will return a validation error.

**Why it happens:** No filter before building the batch request array.

**How to avoid:** Check `pending.length === 0` before calling `batches.create()`; return early with a log message.

### Pitfall 5: `ANTHROPIC_API_KEY` Not Set

**What goes wrong:** `new Anthropic()` succeeds at construction but every API call throws an authentication error.

**Why it happens:** The SDK reads `ANTHROPIC_API_KEY` from `process.env`; if not set in `.env`, the key is undefined.

**How to avoid:** The project uses `dotenv` (`src/main.js`). Ensure `.env` includes `ANTHROPIC_API_KEY`. Add an early validation check in `claudeAnalyzer.js` that throws a clear error if the key is missing.

### Pitfall 6: `runAnalyze` Blocking the Pipeline for Up to 1 Hour

**What goes wrong:** Daily cron fires at 6 AM; `runAnalyze` polls for up to 1 hour. The cron job appears "stuck."

**Why it happens:** Batch API is asynchronous and can take up to 1 hour. The pipeline is synchronous.

**How to avoid:** This is acceptable for the current design (0–5 filings per day). Document the expected polling behavior in a comment. The cron scheduler (`node-cron`) will not fire a second run while the first is still awaiting since `runner.js` is `await`ed to completion.

---

## Code Examples

### Building the System Prompt

```javascript
// Source: schema.js signal classifications + Anthropic docs pattern
// Place in claudeAnalyzer.js

export const SYSTEM_PROMPT = `You are a spinoff investment analyst specializing in the Joel Greenblatt approach to spinoff investing. Your job is to analyze SEC Form 10 signals for a spinoff transaction and produce a concise plain-English summary.

Your summary must:
1. Explain what happened (parent company, spinoff entity, transaction type)
2. State the opportunity thesis based on the signals provided
3. Explicitly call out any red flags by name

Red flag definitions:
- DEBT STUFFING: SpinCo has been loaded with excessive debt (signal: debt_loading = excessive_debt)
- MANAGEMENT EXODUS: Strong leaders are staying at the parent company rather than moving to SpinCo (signal: management_continuity = leaders_staying_at_parent)
- WEAK-UNIT DISPOSAL: The spinoff language suggests this is a disposal of an underperforming business unit rather than a strategic separation (signal: reason_classification = weak_unit_disposal)
- NO INSIDER ALIGNMENT: SpinCo management is not receiving equity grants in the new entity (signal: equity_grants = no_equity_grants)

Format your response as 2-3 paragraphs of plain English. If red flags are present, end with a "Red Flags:" section that lists each one by name with a one-sentence explanation. If no red flags, end with "No red flags detected."

Be direct and specific. Avoid financial jargon where plain language suffices.`;
```

### Building the User Message Per Opportunity

```javascript
// Source: signalExtractor.js output structure — signal_name, classification, confidence
export function buildUserMessage(opp, signals) {
  const signalLines = signals.map(s =>
    `- ${s.signal_name}: ${s.classification} (confidence: ${s.confidence})`
  ).join('\n');

  return `Analyze this spinoff opportunity:

Company: ${opp.company_name}
Spinoff Target: ${opp.spinoff_target || 'Unknown'}
Deal Type: ${opp.signal_type}

Extracted Signals:
${signalLines}

Generate a plain-English summary with red flag callouts.`;
}
```

### Full Analyze Stage

```javascript
// Source: Anthropic Batch API docs + project patterns
// src/pipeline/stages/analyze.js

import { analyzeOpportunities } from '../../ingestion/claudeAnalyzer.js';
import logger from '../../logger.js';

export async function runAnalyze(extracted = []) {
  if (!extracted.length) {
    logger.info('analyze stage: no opportunities to analyze');
    return extracted;
  }

  const oppIds = extracted.map(e => e.oppId);
  await analyzeOpportunities(oppIds);

  logger.info({ processed: oppIds.length }, 'analyze stage complete');
  return extracted;
}
```

### Dependency-Injectable Client for Testing

```javascript
// src/ingestion/claudeAnalyzer.js

import Anthropic from '@anthropic-ai/sdk';

// Default client — real API calls in production
function createDefaultClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  return new Anthropic();
}

// Accept client as parameter for testability
export async function analyzeOpportunities(oppIds, client = createDefaultClient()) {
  // ... implementation
}
```

In tests, pass a mock client object instead of calling `createDefaultClient()`.

---

## Schema Assessment

**No schema changes required.** The `claude_analysis TEXT` column already exists on the `opportunities` table in `schema.js` (line 33). The `CREATE TABLE IF NOT EXISTS` pattern means the schema is stable.

The `UPDATE opportunities SET claude_analysis = ? WHERE id = ?` pattern is the correct write path — a targeted UPDATE rather than INSERT OR REPLACE avoids touching other columns or resetting foreign key relationships.

---

## Test Strategy

### Testing Without Real API Calls

Use dependency injection. The `analyzeOpportunities(oppIds, client)` signature accepts a mock client object. Node's built-in test runner (`node:test`) does not have built-in module mocking, which is consistent with the project's existing test patterns (see `runner.test.js`, `extract.test.js`) — they use direct imports and in-memory DB, not module mocking.

### Test Patterns

```javascript
// src/__tests__/analyze.test.js

// Mock Anthropic client
function makeMockClient({ batchId = 'msgbatch_test_01', results = [] } = {}) {
  return {
    messages: {
      batches: {
        create: async () => ({ id: batchId, processing_status: 'in_progress' }),
        retrieve: async () => ({ processing_status: 'ended' }),
        results: async () => {
          async function* gen() { yield* results; }
          return gen();
        }
      }
    }
  };
}
```

### Test Cases Required

| Req ID | Behavior | Test Type | Command |
|--------|----------|-----------|---------|
| AI-01 | analyzeOpportunities writes claude_analysis to DB | unit | `node --test "src/__tests__/analyze.test.js"` |
| AI-01 | runAnalyze returns extracted array unchanged | unit | `node --test "src/__tests__/analyze.test.js"` |
| AI-02 | System prompt contains red flag trigger terms | unit (string assertion) | `node --test "src/__tests__/analyze.test.js"` |
| AI-03 | Opportunities with existing claude_analysis are skipped | unit | `node --test "src/__tests__/analyze.test.js"` |
| AI-03 | Empty opportunity list returns early (no API call) | unit | `node --test "src/__tests__/analyze.test.js"` |
| AI-03 | Batch results with type !== 'succeeded' leave claude_analysis NULL | unit | `node --test "src/__tests__/analyze.test.js"` |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `claude@0.1.1` stub (broken) | `@anthropic-ai/sdk@0.80.0` | Phase 1 | Real SDK, real API |
| Default 5-min cache TTL | `ttl: '1h'` for batch jobs | SDK 0.x feature | Caches survive batch processing window |
| `claude-haiku-3` (deprecated) | `claude-haiku-4-5-20251001` | 2025 | Haiku 3 retires April 19, 2026; Haiku 4.5 is current |

**Deprecated/outdated:**
- `claude-3-haiku-20240307`: Deprecated, retires April 19, 2026. Do NOT use.
- Standard Messages API for batch work: More expensive than Batch API (2x cost); also creates back-pressure at daily volumes.

---

## Pricing Summary

At typical daily volume (0–5 spinoffs, each with ~500 input tokens for signals + ~4,096 token system prompt):

| Cost Driver | Rate | Per Run (5 opps) |
|-------------|------|-----------------|
| Batch input (system prompt, first hit = cache write) | $0.50/MTok × 1.25 = $0.625/MTok | ~$0.003 |
| Batch input (system prompt, cache read hits 2-5) | $0.50/MTok × 0.1 = $0.05/MTok | ~$0.0002 |
| Batch input (user message, uncached, per opp) | $0.50/MTok | ~$0.001 |
| Batch output (~300 tokens per summary) | $2.50/MTok | ~$0.004 |
| **Total per daily run** | | **~$0.01 or less** |

Cost is negligible at this volume. The architecture matters for correctness (idempotency) more than for cost savings at this scale.

---

## Open Questions

1. **Batch ID persistence across crashes**
   - What we know: If the pipeline crashes during the poll loop, the batch job continues on Anthropic's servers. On the next pipeline run, `WHERE claude_analysis IS NULL` will re-submit a new batch for the same opportunities.
   - What's unclear: Whether re-submitting the same opportunity to a second batch while the first is still processing causes any issue.
   - Recommendation: Accept double-billing risk at this volume (sub-cent per incident). Store the in-progress `batch_id` in a run-level variable and log it on crash; if needed in Phase 5+, persist it to `run_log` for recovery. Out of scope for Phase 4.

2. **Signal data quality for prompt**
   - What we know: Signals are stored with `confidence: 'not_found'` when the section wasn't located in the Form 10. Claude will receive signals with `not_found` confidence.
   - What's unclear: How to instruct Claude to handle missing signals gracefully.
   - Recommendation: Include explicit instruction in system prompt: "If a signal has confidence 'not_found', note that data was unavailable for that dimension rather than inferring."

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/sdk` | All AI analysis | ✓ | 0.80.0 (installed) | — |
| `ANTHROPIC_API_KEY` | All API calls | Unknown (env var) | — | Tests use mock client; prod requires `.env` |
| Node.js ESM | Module system | ✓ | Node 22 (project standard) | — |

**Missing dependencies with no fallback:**
- `ANTHROPIC_API_KEY` in `.env` — required for production pipeline runs. Tests bypass this via dependency injection.

**Missing dependencies with fallback:**
- None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node 22) |
| Config file | none — explicit glob `src/__tests__/*.test.js` |
| Quick run command | `node --test "src/__tests__/analyze.test.js"` |
| Full suite command | `node --test "src/__tests__/*.test.js"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | `analyzeOpportunities` writes `claude_analysis` to DB for succeeded results | unit | `node --test "src/__tests__/analyze.test.js"` | ❌ Wave 0 |
| AI-01 | `runAnalyze` passes extracted array through unchanged | unit | `node --test "src/__tests__/analyze.test.js"` | ❌ Wave 0 |
| AI-02 | System prompt contains "DEBT STUFFING", "MANAGEMENT EXODUS", "WEAK-UNIT DISPOSAL" | unit (string assertion) | `node --test "src/__tests__/analyze.test.js"` | ❌ Wave 0 |
| AI-03 | Opportunities with existing `claude_analysis` are excluded from batch | unit | `node --test "src/__tests__/analyze.test.js"` | ❌ Wave 0 |
| AI-03 | Empty pending list returns early without calling `batches.create` | unit | `node --test "src/__tests__/analyze.test.js"` | ❌ Wave 0 |
| AI-03 | `errored`/`expired` batch results leave `claude_analysis` NULL (retry on next run) | unit | `node --test "src/__tests__/analyze.test.js"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test "src/__tests__/analyze.test.js"`
- **Per wave merge:** `node --test "src/__tests__/*.test.js"`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/analyze.test.js` — covers AI-01, AI-02, AI-03
- [ ] No new framework install needed — `node:test` already in use

---

## Sources

### Primary (HIGH confidence)

- Official Anthropic Batch API docs (`https://platform.claude.com/docs/en/docs/build-with-claude/message-batches`) — create, poll, stream results, pricing table, batch limitations
- Official Anthropic prompt caching docs (`https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching`) — `cache_control`, TTL options, minimum token thresholds per model, pricing structure
- Official Anthropic models overview (`https://platform.claude.com/docs/en/docs/about-claude/models/overview`) — current model IDs, pricing, Haiku 3 deprecation date
- `npm view @anthropic-ai/sdk version` → `0.80.0` — confirmed current latest as of 2026-03-29
- `src/db/schema.js` — `claude_analysis TEXT` column already present on `opportunities` table (line 33)
- `src/pipeline/stages/analyze.js` — current stub signature confirmed (`runAnalyze(opportunities)`)
- `src/pipeline/stages/extract.js` — upstream return type confirmed (`Array<{oppId, signals}>`)
- `src/ingestion/signalExtractor.js` — signal classifications and confidence values documented

### Secondary (MEDIUM confidence)

- Batch API docs tip (verbatim): "consider using the 1-hour cache duration with prompt caching for better cache hit rates when processing batches with shared context" — directly supports the `ttl: '1h'` recommendation

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — SDK version verified from npm registry; already installed
- Architecture: HIGH — Batch API patterns verified against official documentation with TypeScript examples
- Pitfalls: HIGH — Cache TTL and minimum token requirements verified against official prompt caching docs
- Pricing: HIGH — Verified from official pricing tables in Batch API docs and models overview

**Research date:** 2026-03-29
**Valid until:** 2026-04-29 (30 days — stable API; watch for SDK minor version updates)
