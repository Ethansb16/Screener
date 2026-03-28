# Phase 1: Foundation - Research

**Researched:** 2026-03-28
**Domain:** Node.js pipeline infrastructure — EDGAR HTTP client, SQLite schema, cron scheduler, pipeline shell
**Confidence:** HIGH

---

## Summary

Phase 1 builds the skeleton that every subsequent phase runs on: a rate-limited EDGAR HTTP client with mandatory User-Agent injection, a SQLite database with idempotent upsert semantics, a node-cron scheduler that fires the pipeline daily, and a four-stage pipeline runner (discover, extract, analyze, persist) that each stage can invoke independently.

The project's prior ecosystem research has already resolved every major decision for this phase. The standard stack is confirmed (Node.js 24.14.0, better-sqlite3, node-cron, Express, pino, dotenv, native fetch). There are no open questions about which library to use. The work is purely implementation: write the modules in the canonical directory structure, wire them together, and verify the four success criteria.

The single non-trivial action before any other work is replacing the broken `claude@0.1.1` stub in package.json with `@anthropic-ai/sdk@0.80.0`. Every other package must be added fresh — the project currently has no src/ directory, no database, no cron, and no server.

**Primary recommendation:** Implement modules in dependency order — db schema first, then edgarClient, then pipeline runner, then scheduler+server — so each can be tested in isolation before the next is wired in.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | EDGAR client sends requests with required User-Agent header and enforces ≤8 req/s rate limit | edgarClient.js with p-limit(8) + User-Agent injection; exponential backoff with jitter on 429/503 |
| INFRA-02 | SQLite database stores spinoff records with idempotent upsert (no duplicate filings on re-run) | better-sqlite3 with `INSERT OR IGNORE` on `accession_number UNIQUE`; WAL mode; four-table schema |
| INFRA-03 | Daily cron job runs pipeline automatically at a configurable time each morning | node-cron v4.x `cron.schedule('0 7 * * *', ...)` in scheduler.js; fires runPipeline(); logs to run_log |
| INFRA-04 | Pipeline shell executes stages sequentially: discover → extract signals → analyze → persist | runner.js with four async stage functions; each stage exported standalone for independent test calls |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.14.0 (installed) | Runtime | LTS-grade; native fetch built-in; confirmed installed on this machine |
| better-sqlite3 | 12.8.0 | SQLite storage | Synchronous API; fastest Node SQLite binding; 4M+ weekly downloads; zero operational overhead |
| node-cron | 4.2.1 | Cron scheduler | Standard cron syntax; actively maintained; correct scope for one daily job |
| p-limit | 7.3.0 | Rate limiting | Limits concurrent async calls; use concurrency=8 against EDGAR's 10 req/s cap |
| pino | 10.3.1 | Structured logging | Critical for catching silent EDGAR failures; 5-10x faster than Winston |
| dotenv | 17.3.1 | Env config | Standard .env loading |
| express | 5.2.1 | HTTP server | Minimal setup for API routes; serves the web dashboard in later phases |
| @anthropic-ai/sdk | 0.80.0 | Claude SDK | Replaces the broken `claude@0.1.1` stub; needed now to fix package.json |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | latest | Human-readable dev logs | Dev environment only; pipe: `node src/main.js | pino-pretty` |
| node:crypto | built-in | SHA-256 content hashing | For news_items dedup key; no install needed |
| node:path | built-in | Cross-platform path joins | Always use `path.join()` — never string concatenation for file paths on Windows |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| p-limit | bottleneck | Both work; p-limit is simpler for this use case (concurrency limit, not token bucket) |
| p-limit | manual sleep(125ms) | Sleep-based approach works but does not handle concurrent calls from multiple code paths |
| pino | console.log | No log levels, timestamps, or structured context — will cause debugging pain in the daily job |
| express v5 | express v4 | Express v5 is now `latest`; no reason to pin to v4 for a new project |
| node-cron v4 | node-cron v3 | v4 is current `latest`; prior research referenced v3 but v4 is the correct target |

**Installation (full Phase 1 dependency set):**
```bash
# Remove broken stub first
npm uninstall claude

# Install all Phase 1 dependencies
npm install @anthropic-ai/sdk better-sqlite3 node-cron p-limit pino pino-pretty dotenv express
```

**Set ESM module type in package.json:**
```json
{
  "type": "module",
  "name": "spinoff-screener",
  "version": "1.0.0"
}
```

**Version verification:** All versions above confirmed against npm registry on 2026-03-28.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── db/
│   ├── schema.js        # CREATE TABLE statements; run on startup
│   └── db.js            # better-sqlite3 singleton; opens DB, sets WAL mode
├── ingestion/
│   └── edgarClient.js   # rate-limited fetch wrapper; injects User-Agent
├── pipeline/
│   └── runner.js        # orchestrates all four stages; updates run_log
├── scheduler.js         # node-cron entry point; fires runPipeline() daily
└── main.js              # starts scheduler + Express server in same process
data/
└── screener.db          # SQLite file (gitignored)
.env                     # API keys (gitignored)
package.json
```

Phase 1 stubs out `signalExtractor.js`, `claudeAnalyzer.js`, and the Express server routes — they are created as no-op placeholders so the pipeline runner has real modules to call. Phases 2–4 fill them in.

### Pattern 1: Database Singleton

**What:** Open the SQLite database once at process start; export a single `db` object reused everywhere.

**When to use:** All code that touches the database imports from `src/db/db.js`. Never open a second connection.

```javascript
// src/db/db.js
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/screener.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
```

**Why WAL:** WAL (Write-Ahead Logging) prevents write-lock contention. Mandatory on Windows where file-lock behavior differs from Linux.

### Pattern 2: Schema Initialization on Startup

**What:** `schema.js` runs all `CREATE TABLE IF NOT EXISTS` statements when the process starts. No migration framework needed at this scale.

```javascript
// src/db/schema.js
import db from './db.js';

export function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS filings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      accession_number TEXT    UNIQUE NOT NULL,
      form_type        TEXT    NOT NULL,
      cik              TEXT    NOT NULL,
      company_name     TEXT    NOT NULL,
      filed_at         TEXT    NOT NULL,
      period_of_report TEXT,
      primary_doc_url  TEXT,
      raw_text         TEXT,
      fetched_at       TEXT,
      created_at       TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_filings_form_type ON filings(form_type);
    CREATE INDEX IF NOT EXISTS idx_filings_filed_at  ON filings(filed_at);
    CREATE INDEX IF NOT EXISTS idx_filings_cik       ON filings(cik);

    CREATE TABLE IF NOT EXISTS opportunities (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      filing_id        INTEGER REFERENCES filings(id),
      source_type      TEXT    NOT NULL,
      company_name     TEXT    NOT NULL,
      ticker           TEXT,
      spinoff_target   TEXT,
      signal_type      TEXT    NOT NULL,
      signal_strength  TEXT,
      summary          TEXT,
      claude_analysis  TEXT,
      raw_source_url   TEXT,
      discovered_at    TEXT    DEFAULT (datetime('now')),
      status           TEXT    DEFAULT 'new',
      UNIQUE(filing_id, signal_type)
    );

    CREATE INDEX IF NOT EXISTS idx_opportunities_signal_type   ON opportunities(signal_type);
    CREATE INDEX IF NOT EXISTS idx_opportunities_discovered_at ON opportunities(discovered_at);
    CREATE INDEX IF NOT EXISTS idx_opportunities_status        ON opportunities(status);

    CREATE TABLE IF NOT EXISTS news_items (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash         TEXT    UNIQUE NOT NULL,
      source               TEXT    NOT NULL,
      headline             TEXT    NOT NULL,
      url                  TEXT,
      published_at         TEXT,
      body_snippet         TEXT,
      companies_mentioned  TEXT,
      processed            INTEGER DEFAULT 0,
      created_at           TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_news_items_processed    ON news_items(processed);
    CREATE INDEX IF NOT EXISTS idx_news_items_published_at ON news_items(published_at);

    CREATE TABLE IF NOT EXISTS run_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at          TEXT    NOT NULL,
      finished_at         TEXT,
      status              TEXT,
      filings_fetched     INTEGER DEFAULT 0,
      opportunities_added INTEGER DEFAULT 0,
      error_message       TEXT
    );
  `);
}
```

### Pattern 3: EDGAR Client with Rate Limiting

**What:** Single shared HTTP wrapper. All EDGAR calls go through this module — never call `fetch()` to SEC endpoints directly from other modules.

**When to use:** Import `edgarGet` from `edgarClient.js` whenever fetching any `data.sec.gov` or `efts.sec.gov` URL.

```javascript
// src/ingestion/edgarClient.js
import pLimit from 'p-limit';

const USER_AGENT = process.env.SEC_USER_AGENT ?? 'SpinoffScreener contact@example.com';

// Hard limit: 8 concurrent requests (≤8 req/s; EDGAR cap is 10)
const limit = pLimit(8);

async function fetchWithRetry(url, attempt = 1) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'gzip, deflate',
    },
  });

  if (res.status === 429 || res.status === 503) {
    if (attempt >= 4) throw new Error(`EDGAR rate limited after ${attempt} attempts: ${url}`);
    // Exponential backoff with full jitter
    const base = Math.min(1000 * 2 ** attempt, 30_000);
    const delay = Math.random() * base;
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, attempt + 1);
  }

  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
  return res;
}

export function edgarGet(url) {
  return limit(() => fetchWithRetry(url));
}

export function edgarGetJson(url) {
  return limit(() => fetchWithRetry(url).then(r => r.json()));
}

export function edgarGetText(url) {
  return limit(() => fetchWithRetry(url).then(r => r.text()));
}
```

**Key detail on p-limit:** `pLimit(8)` limits the number of *concurrently pending* promises, not the per-second rate. For Phase 1 this is sufficient — the pipeline is sequential and never fires 8 parallel EDGAR calls. The limit is there as a safety guard for future phases where batch loops may fire many requests.

### Pattern 4: Pipeline Runner

**What:** Sequential execution of four named stages. Each stage is a standalone async function that can be called independently for testing.

```javascript
// src/pipeline/runner.js
import db from '../db/db.js';
import logger from '../logger.js';

// Phase 2+ will flesh these out
import { runDiscover } from './stages/discover.js';
import { runExtract } from './stages/extract.js';
import { runAnalyze } from './stages/analyze.js';
import { runPersist } from './stages/persist.js';

export async function runPipeline() {
  const runId = db.prepare(
    `INSERT INTO run_log (started_at, status) VALUES (datetime('now'), 'running')`
  ).run().lastInsertRowid;

  try {
    logger.info({ runId }, 'Pipeline starting');

    const discovered = await runDiscover();
    const extracted  = await runExtract(discovered);
    const analyzed   = await runAnalyze(extracted);
    await runPersist(analyzed);

    db.prepare(
      `UPDATE run_log SET finished_at = datetime('now'), status = 'success',
       filings_fetched = ? WHERE id = ?`
    ).run(discovered?.length ?? 0, runId);

    logger.info({ runId }, 'Pipeline complete');
  } catch (err) {
    db.prepare(
      `UPDATE run_log SET finished_at = datetime('now'), status = 'error', error_message = ? WHERE id = ?`
    ).run(err.message, runId);
    logger.error({ runId, err }, 'Pipeline failed');
    throw err;
  }
}
```

### Pattern 5: Idempotent Upsert

**What:** `INSERT OR IGNORE` leverages the `UNIQUE` constraint on `accession_number` to silently skip duplicate rows.

```javascript
const insertFiling = db.prepare(`
  INSERT OR IGNORE INTO filings
    (accession_number, form_type, cik, company_name, filed_at, primary_doc_url)
  VALUES
    (@accession_number, @form_type, @cik, @company_name, @filed_at, @primary_doc_url)
`);

// Running this twice with the same accession_number produces exactly one row
insertFiling.run({
  accession_number: '0001234567-24-000001',
  form_type: '10-12B',
  cik: '0000123456',
  company_name: 'Acme SpinCo Inc.',
  filed_at: '2024-03-15',
  primary_doc_url: 'https://www.sec.gov/...',
});
```

### Pattern 6: CIK Normalization

**What:** Always zero-pad CIKs to 10 digits before constructing SEC API URLs. The EDGAR submissions endpoint requires 10-digit CIKs.

```javascript
// Normalize CIK — always call this before building an EDGAR URL
export function normalizeCIK(cik) {
  return String(cik).padStart(10, '0');
}

// Accession numbers: dashes in display, no dashes in file path URLs
export function accessionToPath(accession) {
  return accession.replace(/-/g, '');
}
```

### Anti-Patterns to Avoid

- **Calling `fetch()` directly for EDGAR URLs:** Bypasses rate limiting and User-Agent injection. Always use `edgarGet()`.
- **`Promise.all()` over EDGAR endpoints:** Fires all requests concurrently, blowing past the 10 req/s cap. Use sequential iteration or `p-limit`.
- **Opening multiple `Database()` instances:** Causes WAL mode contention. Import and reuse the singleton from `db.js`.
- **String-concatenating file paths on Windows:** `'../../data/' + 'screener.db'` breaks on Windows path separators. Always use `path.join()`.
- **Treating the `claude@0.1.1` package as functional:** It is a placeholder stub published by an unrelated author. It will not make Claude API calls. Replace it before any other work.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrent request limiting | Custom semaphore/queue | `p-limit` | p-limit is battle-tested, handles promise rejection correctly, works with ESM |
| Cron scheduling | `setInterval` or manual timer loop | `node-cron` | setInterval drifts; doesn't survive daylight saving time; no cron syntax |
| SQLite access | Raw SQL via `node:sqlite` (experimental) | `better-sqlite3` | node:sqlite is still experimental in Node 24; better-sqlite3 is stable with 4M+ weekly downloads |
| Retry with jitter | Custom retry loop | Pattern in PITFALLS (no lib needed) | The pattern is simple enough to inline; adding a retry lib adds a dependency for 20 lines of code |
| Structured logging | `console.log` | `pino` | No log levels, timestamps, or JSON output — impossible to debug silent EDGAR failures without structured logs |
| Environment config | Manual `process.env` reads | `dotenv` | dotenv is the universal standard; handles `.env` file loading, type coercion, and defaults |

**Key insight:** The SEC EDGAR rate limit enforcement and User-Agent injection are the most failure-prone parts of this phase. Centralizing all EDGAR calls through a single `edgarClient.js` module is the architectural decision that prevents the entire class of silent-ban failures. This is not optional.

---

## Runtime State Inventory

Phase 1 is greenfield — there is no existing application state to migrate or rename.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no database exists yet | Create `data/screener.db` on first run |
| Live service config | None — no running services | None |
| OS-registered state | None — no scheduled tasks registered | None |
| Secrets/env vars | None — no `.env` file exists | Create `.env` with SEC_USER_AGENT, ANTHROPIC_API_KEY, PORT |
| Build artifacts | `node_modules/claude@0.1.1` — installed broken stub | `npm uninstall claude` as Task 1 |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 24.14.0 | — |
| npm | Package management | Yes | 11.9.0 | — |
| better-sqlite3 | INFRA-02 | Not yet installed | — | None (required) |
| node-cron | INFRA-03 | Not yet installed | — | None (required) |
| p-limit | INFRA-01 | Not yet installed | — | None (required) |
| pino | Logging | Not yet installed | — | None (required) |
| dotenv | Config | Not yet installed | — | None (required) |
| express | Server | Not yet installed | — | None (required) |
| @anthropic-ai/sdk | Stub fix (CRITICAL) | Not yet installed | — | None (required) |
| git | Version control | Yes | — | — |

**Missing dependencies with no fallback:**
All production dependencies are currently uninstalled. The first task must be the `npm install` command listed in the Standard Stack section.

**Note on Node.js version:** The installed version is 24.14.0, which is newer than the Node 22 LTS documented in prior research. All stack decisions (native fetch, ESM, better-sqlite3) are fully compatible with Node 24. The `node:sqlite` built-in is still marked experimental in Node 24 and should not be used — continue with `better-sqlite3`.

---

## Common Pitfalls

### Pitfall 1: EDGAR IP Ban from Concurrent Requests

**What goes wrong:** Any code that fires multiple EDGAR requests without a shared throttle can exceed 10 req/s and trigger a temporary IP ban. The ban manifests as empty response bodies (not HTTP errors), so the pipeline silently processes no data.

**Why it happens:** `Promise.all()` over an array, or two pipeline stages both making EDGAR calls without coordination.

**How to avoid:** All EDGAR calls must go through the `edgarGet()` / `edgarGetJson()` functions in `edgarClient.js`, which uses a shared `pLimit(8)` instance. Never call `fetch()` directly for EDGAR URLs.

**Warning signs:** EDGAR calls return 200 with empty/minimal JSON bodies; subsequent manual curl requests from a browser work fine.

### Pitfall 2: Missing User-Agent Header

**What goes wrong:** Requests without a properly formatted User-Agent are classified as unidentified bots by the SEC and may be pre-emptively blocked or rate-limited more aggressively.

**Why it happens:** Native `fetch()` does not set a User-Agent by default.

**How to avoid:** The `edgarClient.js` wrapper injects `User-Agent` on every request. The value must include an app name and a contact email: `SpinoffScreener contact@example.com`. Load from `SEC_USER_AGENT` env var so it can be configured without code changes.

**Warning signs:** 403 responses from EDGAR even at low request rates; works fine from browser.

### Pitfall 3: Windows Path Separators Breaking `data/screener.db` Location

**What goes wrong:** String-concatenated paths like `'../../data/screener.db'` produce incorrect results on Windows when the cwd is not what you expect.

**Why it happens:** Windows uses backslashes; `__dirname` with ESM requires a workaround (`fileURLToPath(import.meta.url)`).

**How to avoid:** In `db.js`, compute the absolute path using:
```javascript
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/screener.db');
```

**Warning signs:** `SQLITE_CANTOPEN` error; the `data/` directory exists but the file path resolves to the wrong location.

### Pitfall 4: `better-sqlite3` Native Module Rebuild

**What goes wrong:** `better-sqlite3` is a native Node.js addon (compiled C++). On Windows, npm install may fail if Visual Studio Build Tools or the Python build tools are not installed, or if the Node.js version has changed since the pre-built binary was compiled.

**Why it happens:** Node native addons are compiled for a specific Node.js ABI version. The pre-built binaries in the package cover common versions but may not match every environment.

**How to avoid:** If `npm install better-sqlite3` fails with a native build error, run:
```bash
npm install --build-from-source better-sqlite3
```
Or install Windows build tools first:
```bash
npm install --global windows-build-tools
```

**Warning signs:** `npm install` output shows `node-gyp rebuild` errors; `Error: The module ... was compiled against a different Node.js version`.

### Pitfall 5: `INSERT OR IGNORE` Silently Dropping Data Updates

**What goes wrong:** On re-run, `INSERT OR IGNORE` correctly skips the duplicate row — but also silently skips any updates to columns that may have changed (e.g., an amended filing changes `primary_doc_url`). For Phase 1 this is acceptable, but the planner should note it.

**Why it happens:** `INSERT OR IGNORE` aborts the entire insert on conflict without updating any columns.

**How to avoid:** For Phase 1, `INSERT OR IGNORE` is correct — we only want to store the first instance of each accession number. If in a future phase we need to update metadata on re-discovery, switch to `INSERT OR REPLACE` or `ON CONFLICT DO UPDATE SET ...`.

**Warning signs:** Only relevant if a filing's metadata changes after initial discovery.

### Pitfall 6: node-cron Fires Immediately on Startup if Scheduled Time Has Already Passed

**What goes wrong:** Some cron implementations fire the first execution immediately if the next scheduled time is in the future but the implementation misinterprets "now". node-cron v4 does NOT fire immediately on startup — it waits for the next matching cron tick. This is correct behavior but worth confirming.

**Why it happens:** This was a concern with older schedulers. node-cron v4 handles it correctly.

**How to avoid:** No special handling needed. Document the expected startup behavior in `scheduler.js` comments.

---

## Code Examples

### EDGAR EFTS Full-Text Search

```javascript
// Source: SEC EDGAR Full Text Search FAQ (efts.sec.gov)
// Fetch Form 10-12B filings from the last 24 hours
import { edgarGetJson } from '../ingestion/edgarClient.js';

const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
const today     = new Date().toISOString().split('T')[0];

const url = new URL('https://efts.sec.gov/LATEST/search-index');
url.searchParams.set('q', '"spin-off" OR "spinoff" OR "separation"');
url.searchParams.set('forms', '10-12B,8-K');
url.searchParams.set('dateRange', 'custom');
url.searchParams.set('startdt', yesterday);
url.searchParams.set('enddt', today);
url.searchParams.set('from', '0');
url.searchParams.set('size', '40');

const data = await edgarGetJson(url.toString());
const hits = data?.hits?.hits ?? [];
```

### EDGAR Submissions API (CIK-based filing lookup)

```javascript
// Source: SEC data.sec.gov/submissions API
import { edgarGetJson } from '../ingestion/edgarClient.js';
import { normalizeCIK } from '../lib/edgar-utils.js';

async function getRecentFilings(cik) {
  const paddedCIK = normalizeCIK(cik);
  const data = await edgarGetJson(
    `https://data.sec.gov/submissions/CIK${paddedCIK}.json`
  );

  // IMPORTANT: filings.recent uses columnar arrays, NOT row objects
  const { recent } = data.filings;
  return recent.form.map((formType, i) => ({
    form:            formType,
    filingDate:      recent.filingDate[i],
    accessionNumber: recent.accessionNumber[i],
    primaryDocument: recent.primaryDocument[i],
  }));
}
```

### SHA-256 Content Hash for News Deduplication

```javascript
// Source: Node.js built-in crypto module
import { createHash } from 'node:crypto';

export function newsContentHash(source, headline) {
  return createHash('sha256')
    .update(`${source}|${headline.toLowerCase().trim()}`)
    .digest('hex');
}
```

### Scheduler Entry Point

```javascript
// src/scheduler.js
import cron from 'node-cron';
import { runPipeline } from './pipeline/runner.js';
import logger from './logger.js';

// Daily at 7:00 AM local time
// Schedule after 6 AM ET so late-filing cutoff (5:30 PM ET prior day) is captured
const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? '0 7 * * *';

export function startScheduler() {
  if (!cron.validate(CRON_SCHEDULE)) {
    throw new Error(`Invalid cron expression: ${CRON_SCHEDULE}`);
  }

  cron.schedule(CRON_SCHEDULE, async () => {
    logger.info('Scheduled pipeline run starting');
    try {
      await runPipeline();
    } catch (err) {
      logger.error({ err }, 'Scheduled pipeline run failed');
    }
  });

  logger.info({ schedule: CRON_SCHEDULE }, 'Scheduler registered');
}
```

### Pino Logger Singleton

```javascript
// src/logger.js
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' }
    : undefined,
});

export default logger;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-fetch` polyfill | Native `fetch` (Node 18+) | Node 18 (2022) | Remove node-fetch dependency entirely |
| `node:sqlite` (experimental) | `better-sqlite3` | Still experimental in Node 24 | Use better-sqlite3; revisit at Node 26 LTS |
| Express v4 | Express v5 (latest) | Express v5 went stable in 2024 | New projects should use v5; no breaking changes for this use case |
| node-cron v3 | node-cron v4 (latest) | v4 released 2024 | Prior research cited v3; use v4 |
| `claude@0.1.1` npm stub | `@anthropic-ai/sdk@0.80.0` | Always | The `claude` package is not Anthropic's SDK |

**Deprecated/outdated from prior research notes:**
- node-cron `^3.0.x`: Prior research recommended 3.x; current latest is 4.2.1. Use 4.x.
- Express `^4.21.x`: Prior research recommended 4.x; current latest is 5.2.1. Use 5.x.

---

## Open Questions

1. **Windows Task Scheduler vs. in-process node-cron**
   - What we know: node-cron works in-process and is simpler to set up; Windows Task Scheduler is more reliable for long-lived scheduled tasks but loses the unified web server process
   - What's unclear: Whether the tool will run as a persistent background service or be started on-demand — the deployment model is an open decision flagged in STATE.md
   - Recommendation: Start with in-process node-cron (simpler, enables unified server+scheduler process). Migrate to Task Scheduler only if reliability issues arise in practice.

2. **`.env` file defaults for `SEC_USER_AGENT`**
   - What we know: The SEC requires `AppName contact@email.com` format
   - What's unclear: The actual contact email the user wants to register
   - Recommendation: Create `.env.example` with a placeholder value; require the user to copy it to `.env` and fill in their email before first run.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) — no install needed |
| Config file | None — tests run directly with `node --test` |
| Quick run command | `node --test src/**/*.test.js` |
| Full suite command | `node --test src/**/*.test.js` |

**Rationale for `node:test`:** No new dependency for a personal tool. The built-in test runner is stable in Node 24 and sufficient for unit tests on synchronous SQLite operations and the EDGAR client. If a more ergonomic API is needed, `vitest` is the alternative (fast, ESM-native, no config needed).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Every edgarGet() call sets User-Agent header | unit | `node --test src/ingestion/edgarClient.test.js` | Wave 0 |
| INFRA-01 | Concurrent calls are capped at ≤8 in-flight | unit | `node --test src/ingestion/edgarClient.test.js` | Wave 0 |
| INFRA-01 | 429 response triggers exponential backoff retry | unit | `node --test src/ingestion/edgarClient.test.js` | Wave 0 |
| INFRA-02 | Two inserts with same accession_number produce one row | unit | `node --test src/db/schema.test.js` | Wave 0 |
| INFRA-02 | WAL mode is enabled after db.js opens the database | unit | `node --test src/db/schema.test.js` | Wave 0 |
| INFRA-03 | Cron expression '0 7 * * *' validates without error | unit | `node --test src/scheduler.test.js` | Wave 0 |
| INFRA-03 | Completed pipeline run writes a 'success' row to run_log | integration | `node --test src/pipeline/runner.test.js` | Wave 0 |
| INFRA-04 | runDiscover(), runExtract(), runAnalyze(), runPersist() are each exported as standalone functions | unit | `node --test src/pipeline/runner.test.js` | Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test src/**/*.test.js`
- **Per wave merge:** `node --test src/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

All test files are missing — the `src/` directory does not exist yet.

- [ ] `src/ingestion/edgarClient.test.js` — covers INFRA-01 (User-Agent injection, rate limit, retry)
- [ ] `src/db/schema.test.js` — covers INFRA-02 (idempotent upsert, WAL mode)
- [ ] `src/scheduler.test.js` — covers INFRA-03 (cron validation)
- [ ] `src/pipeline/runner.test.js` — covers INFRA-03 (run_log write), INFRA-04 (stage exports)

Framework install: None — `node:test` is built into Node 24.

---

## Sources

### Primary (HIGH confidence)

- [SEC EDGAR Developer Resources](https://www.sec.gov/about/developer-resources) — rate limits, User-Agent requirements, API structure
- [SEC EDGAR Full Text Search FAQ](https://www.sec.gov/edgar/search/efts-faq.html) — EFTS endpoint, query parameters, response shape
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) — 10 req/s cap, User-Agent policy
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — WAL pragma, sync API, INSERT OR IGNORE pattern
- [node-cron GitHub](https://github.com/node-cron/node-cron) — v4 API, `cron.validate()`, schedule syntax
- [p-limit npm](https://www.npmjs.com/package/p-limit) — concurrency limiting for promise-based calls
- npm registry (2026-03-28) — all package versions verified current against `npm view [package] version`

### Secondary (MEDIUM confidence)

- [GreenFlux SEC API integration guide](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/) — CIK zero-padding, columnar array response format, CORS limitations
- [BetterStack: Node.js SQLite guide](https://betterstack.com/community/guides/scaling-nodejs/nodejs-sqlite/) — better-sqlite3 best practices, WAL mode, Windows compatibility
- [BetterStack: Node.js schedulers comparison](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/) — node-cron vs alternatives

### Tertiary (LOW confidence)

- Native `node:sqlite` experimental status in Node 24 — inferred from Node 22 documentation; no Node 24 changelog confirmation checked. Recommend treating `better-sqlite3` as correct regardless.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all package versions verified against npm registry; EDGAR API requirements from official SEC docs
- Architecture: HIGH — patterns verified against official library docs and prior ecosystem research
- Pitfalls: HIGH — EDGAR rate limit and User-Agent requirements from official SEC sources; Windows SQLite path issue from standard Node.js ESM patterns
- Test map: MEDIUM — test commands based on built-in `node:test` runner; test file content is design-time, not verified against a running suite

**Research date:** 2026-03-28
**Valid until:** 2026-06-28 (stable ecosystem — node-cron, better-sqlite3, EDGAR APIs change slowly)
