# Architecture Patterns

**Domain:** Personal financial data pipeline + spinoff screener dashboard
**Researched:** 2026-03-28
**Confidence:** MEDIUM-HIGH (official SEC docs, verified library docs, multiple corroborating sources)

---

## Recommended Architecture

A single-process Node.js application with four clearly separated layers: **Ingestion**, **Processing**, **Storage**, and **Serving**. No microservices, no message queue, no external database server — just SQLite on disk and an Express HTTP server. The scheduler (node-cron) lives in the same process and fires the pipeline daily.

```
┌─────────────────────────────────────────────────────────┐
│                     Node.js Process                      │
│                                                         │
│  ┌──────────┐   ┌────────────┐   ┌──────────────────┐  │
│  │ Scheduler│──▶│  Pipeline  │──▶│  SQLite (better- │  │
│  │(node-cron)│   │  Runner    │   │  sqlite3)        │  │
│  └──────────┘   └──────┬─────┘   └────────┬─────────┘  │
│                         │                  │             │
│              ┌──────────▼──────────┐       │             │
│              │  Ingestion Layer     │       │             │
│              │  ┌───────────────┐  │       │             │
│              │  │ EDGAR Fetcher │  │       │             │
│              │  └───────────────┘  │       │             │
│              │  ┌───────────────┐  │       │             │
│              │  │ News Fetcher  │  │       │             │
│              │  └───────────────┘  │       │             │
│              └──────────┬──────────┘       │             │
│                         │                  │             │
│              ┌──────────▼──────────┐       │             │
│              │  Processing Layer    │       │             │
│              │  ┌───────────────┐  │       │             │
│              │  │ Signal Parser │  │       │             │
│              │  └───────────────┘  │       │             │
│              │  ┌───────────────┐  │       │             │
│              │  │ Claude AI     │  │       │             │
│              │  │ Analyzer      │  │       │             │
│              │  └───────────────┘  │       │             │
│              └──────────┬──────────┘       │             │
│                         └──────────────────┘             │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Express Server  (GET /api/opportunities, etc.)   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Storage: Use SQLite (not JSON files)

**Recommendation: `better-sqlite3`**

For a solo user, SQLite is unambiguously correct. JSON flat files break down as soon as you need to:

- Query "give me all opportunities added in the last 7 days"
- Deduplicate across runs without loading the entire file
- Update a single record's `claudeAnalysis` field
- Add an index on `filingDate` for fast dashboard queries

SQLite is a single `.db` file on disk — it has zero operational overhead, no server to run, survives process restarts, and `better-sqlite3` is the fastest synchronous SQLite binding for Node.js.

**Do not use:**
- Plain JSON files — no indexing, no atomic writes, full-file loads, no query support
- PostgreSQL/MySQL — operationally heavyweight for a solo local tool
- `node:sqlite` (built-in) — synchronous only, still experimental as of Node.js 22, less documentation

**Install:**
```bash
npm install better-sqlite3
```

---

## Data Model

### Table: `filings`

Stores every discovered SEC filing. Acts as the canonical deduplication registry and raw data store.

```sql
CREATE TABLE filings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  accession_number TEXT UNIQUE NOT NULL,   -- e.g. 0001234567-24-000123 (dedup key)
  form_type       TEXT NOT NULL,           -- '8-K', '10-12B', '4', 'S-11'
  cik             TEXT NOT NULL,
  company_name    TEXT NOT NULL,
  filed_at        TEXT NOT NULL,           -- ISO 8601
  period_of_report TEXT,
  primary_doc_url TEXT,
  raw_text        TEXT,                    -- extracted filing text (nullable, fetch on demand)
  fetched_at      TEXT,                    -- when we downloaded it
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_filings_form_type ON filings(form_type);
CREATE INDEX idx_filings_filed_at  ON filings(filed_at);
CREATE INDEX idx_filings_cik       ON filings(cik);
```

### Table: `opportunities`

One row per identified spinoff opportunity. References the triggering filing. Claude analysis stored as JSON text.

```sql
CREATE TABLE opportunities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  filing_id       INTEGER REFERENCES filings(id),
  source_type     TEXT NOT NULL,           -- 'sec_filing' | 'news'
  company_name    TEXT NOT NULL,
  ticker          TEXT,
  spinoff_target  TEXT,                    -- name of entity being spun off
  signal_type     TEXT NOT NULL,           -- 'form_10' | '8k_spinoff' | 'form4_insider' | 'news_mention'
  signal_strength TEXT,                    -- 'strong' | 'moderate' | 'weak'
  summary         TEXT,                    -- human-readable one-liner
  claude_analysis TEXT,                    -- JSON blob from Claude AI
  raw_source_url  TEXT,
  discovered_at   TEXT DEFAULT (datetime('now')),
  status          TEXT DEFAULT 'new',      -- 'new' | 'reviewed' | 'dismissed'
  UNIQUE(filing_id, signal_type)           -- prevent re-inserting same signal from same filing
);

CREATE INDEX idx_opportunities_signal_type  ON opportunities(signal_type);
CREATE INDEX idx_opportunities_discovered_at ON opportunities(discovered_at);
CREATE INDEX idx_opportunities_status       ON opportunities(status);
```

### Table: `news_items`

Stores discovered news articles. Separate from SEC filings because the dedup key differs.

```sql
CREATE TABLE news_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash    TEXT UNIQUE NOT NULL,    -- SHA-256 of (source + headline) — dedup key
  source          TEXT NOT NULL,           -- e.g. 'newsapi', 'alphavantage'
  headline        TEXT NOT NULL,
  url             TEXT,
  published_at    TEXT,
  body_snippet    TEXT,
  companies_mentioned TEXT,               -- JSON array of tickers/names
  processed       INTEGER DEFAULT 0,      -- boolean: has pipeline processed this?
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_news_items_processed    ON news_items(processed);
CREATE INDEX idx_news_items_published_at ON news_items(published_at);
```

### Table: `run_log`

Audit trail for every scheduled pipeline execution.

```sql
CREATE TABLE run_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT,                       -- 'running' | 'success' | 'error'
  filings_fetched INTEGER DEFAULT 0,
  opportunities_added INTEGER DEFAULT 0,
  error_message TEXT
);
```

---

## Pipeline Stages

The pipeline is a sequential async function, called by the scheduler. Each stage is a separate module/file.

```
Stage 1: EDGAR Ingestion
  └─ Fetch new 10-12B filings (EFTS full-text search)
  └─ Fetch new 8-K filings mentioning "spin-off"
  └─ Fetch recent Form 4 filings (insider buys at spinoff-linked companies)
  └─ INSERT OR IGNORE into filings (dedup on accession_number)

Stage 2: News Ingestion
  └─ Query news API for "spinoff" + "spin-off" keywords
  └─ Compute content_hash = SHA-256(source + headline)
  └─ INSERT OR IGNORE into news_items

Stage 3: Signal Extraction
  └─ For each unprocessed filing: parse form type → extract spinoff signals
  └─ For each unprocessed news_item: extract company names, classify signal
  └─ Write signal candidates to opportunities table

Stage 4: Claude Analysis
  └─ For each opportunity with no claude_analysis:
       send filing text + context to Claude API
       store structured JSON response back in opportunities.claude_analysis

Stage 5: Done
  └─ Update run_log with completion status
```

Each stage is idempotent: re-running the pipeline on the same day produces no duplicate rows because all inserts use `INSERT OR IGNORE` with unique constraints.

---

## SEC EDGAR: Full-Text Search API vs RSS Feed

**Recommendation: Use EFTS Full-Text Search for discovery, RSS for monitoring.**

| Criterion | EFTS Full-Text Search | RSS Feeds |
|-----------|----------------------|-----------|
| **URL** | `https://efts.sec.gov/LATEST/search-index` | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-12B&output=atom` |
| **Update frequency** | Near real-time | Every 10 minutes (market hours only) |
| **Form type filter** | Yes — `forms=10-12B,8-K` param | Yes — `type=10-12B` param |
| **Keyword search** | YES — can search filing text for "spin-off" | No — metadata only |
| **Date range** | Yes — `dateRange`, `startdt`, `enddt` params | No — always "latest N" |
| **Response** | JSON with accessionNumber, cik, company, formType, filingDate, fileUrl | Atom/XML |
| **Rate limit** | 10 req/s (same as all EDGAR), lenient in practice | Same |
| **Best for** | Finding spinoff-related filings across all companies | Watching specific form types in near real-time |
| **Requires auth** | No | No |
| **Requires User-Agent header** | YES — must include email | YES |

**Use EFTS** for the daily batch job: it lets you query `q="spin-off" OR "spinoff" OR "separation"` filtered to `forms=10-12B,8-K` over the last 24 hours. This is far more targeted than RSS because it searches filing content, not just metadata.

**Use RSS as a secondary channel** if you want near-real-time alerting, but for a daily screener EFTS is strictly better.

### EFTS Query URL Pattern

```
GET https://efts.sec.gov/LATEST/search-index
  ?q=%22spin-off%22%20OR%20%22spinoff%22
  &forms=10-12B,8-K,4
  &dateRange=custom
  &startdt=2025-03-27
  &enddt=2025-03-28
  &_source=period_of_report,entity_name,file_num,form_type,period_of_report,biz_location,inc_states
  &from=0
  &size=40
```

The response is JSON with a `hits.hits` array. Each hit contains `_source` with filing metadata and `_id` which is the accession number (the dedup key).

**Important:** Always set a `User-Agent` header of the form `MyScreener/1.0 your@email.com` or EDGAR will block requests.

---

## Rate Limit Handling

SEC EDGAR enforces **10 requests/second maximum** across all endpoints. For a daily batch job this is generous — the concern is burst behavior.

**Strategy: Token bucket with 300ms minimum spacing.**

```javascript
// src/lib/edgarClient.js
const EDGAR_MIN_DELAY_MS = 300; // 3-4 req/s — well within 10/s limit

async function edgarGet(url) {
  await sleep(EDGAR_MIN_DELAY_MS);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SpinoffScreener/1.0 your@email.com' }
  });
  if (res.status === 429) {
    // Back off 10 seconds and retry once
    await sleep(10_000);
    return edgarGet(url);
  }
  return res.json();
}
```

**Caching fetched filing text:** Once raw text is written to `filings.raw_text`, never fetch it again. The `fetched_at` column is the cache marker.

```sql
-- Only fetch text for filings we haven't fetched yet
SELECT * FROM filings WHERE fetched_at IS NULL AND form_type IN ('10-12B', '8-K');
```

---

## Deduplication Strategy

### SEC Filings
- **Primary key:** `accession_number` — globally unique, assigned by SEC, immutable
- **Insert pattern:** `INSERT OR IGNORE INTO filings (accession_number, ...) VALUES (...)`
- The `UNIQUE` constraint on `accession_number` means concurrent runs cannot insert the same filing twice

### News Articles
- **Primary key:** `content_hash = SHA-256(source + '|' + headline.toLowerCase().trim())`
- URL is NOT used as the dedup key because the same story appears at many URLs
- Normalizing the headline before hashing handles minor casing/whitespace differences

```javascript
import { createHash } from 'node:crypto';

function newsHash(source, headline) {
  return createHash('sha256')
    .update(`${source}|${headline.toLowerCase().trim()}`)
    .digest('hex');
}
```

### Opportunities (cross-source)
- `UNIQUE(filing_id, signal_type)` prevents the same signal from being re-extracted from the same filing on re-runs
- For news-sourced opportunities, use `UNIQUE(content_hash, signal_type)` (add `content_hash` column)

---

## Scheduled Job

**Recommendation: `node-cron`**

For a personal daily batch job, `node-cron` is the correct choice. It is lightweight (one dependency, ~67 KB install), pure JavaScript, uses standard cron syntax, and has been stable since 2016. Croner is more featureful (timezone-aware, DST-safe) but overkill for a daily job running on a local machine in a fixed timezone.

```bash
npm install node-cron
```

```javascript
// src/scheduler.js
import cron from 'node-cron';
import { runPipeline } from './pipeline/runner.js';

// Run daily at 7:00 AM local time
cron.schedule('0 7 * * *', async () => {
  console.log('[scheduler] Starting daily pipeline run...');
  try {
    await runPipeline();
  } catch (err) {
    console.error('[scheduler] Pipeline failed:', err);
  }
});
```

**Alternative for simpler setups:** OS-level cron (`crontab` on Linux/Mac, Task Scheduler on Windows) calling `node src/pipeline/runner.js` directly. This avoids keeping a long-running process alive, but loses the ability to expose a web UI from the same process.

For this project (pipeline + web UI in one process), keep `node-cron` in-process.

---

## Frontend: Vanilla HTML + Express

**Recommendation: Vanilla HTML/CSS/JS served by Express.**

No frontend framework needed. The dashboard is read-only: load opportunities, display them in a table, filter by status. This requires maybe 200 lines of vanilla JS using `fetch()` to hit a JSON API. Adding React/Vue/Svelte introduces a build step, bundler config, and node_modules bloat for zero benefit.

**Architecture:**
```
src/
  server/
    index.js         - Express app, API routes
    routes/
      opportunities.js - GET /api/opportunities?status=new&limit=50
      run-log.js       - GET /api/run-log
  public/
    index.html       - Dashboard HTML
    app.js           - Fetch + render logic (vanilla)
    styles.css
```

**Express setup:**
```javascript
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(__dirname, '../public')));
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/run-log', runLogRouter);

app.listen(3000, () => console.log('Dashboard at http://localhost:3000'));
```

No templating engine (EJS, Handlebars) needed — the API returns JSON, the frontend renders it.

---

## Recommended Directory Structure

```
/Screener
  src/
    db/
      schema.js          - CREATE TABLE statements, run on startup
      db.js              - better-sqlite3 singleton
    ingestion/
      edgarClient.js     - rate-limited EDGAR fetch wrapper
      edgarIngester.js   - EFTS query → INSERT into filings
      newsIngester.js    - news API → INSERT into news_items
    processing/
      signalExtractor.js - parse filings → write to opportunities
      claudeAnalyzer.js  - call Claude API → update claude_analysis
    pipeline/
      runner.js          - orchestrates all stages, updates run_log
    server/
      index.js           - Express server
      routes/
        opportunities.js
        runLog.js
    scheduler.js         - node-cron entry point (daily trigger)
    main.js              - starts scheduler + server
  public/
    index.html
    app.js
    styles.css
  data/
    screener.db          - SQLite database (gitignored)
  .env                   - API keys (gitignored)
  package.json
```

---

## Scalability Considerations

| Concern | Solo daily use | If scope grows |
|---------|---------------|----------------|
| Storage | SQLite, single file | SQLite stays valid up to millions of rows; add WAL mode |
| Concurrency | Single process, synchronous SQLite | No concern for personal use |
| Claude API cost | Analyze only new opportunities | Add `claude_analysis IS NULL` filter — always true |
| EDGAR rate limits | 300ms delay between requests | Batch overnight; no concern at daily cadence |
| News API quotas | Cache `processed=0` records; only re-query API for new day | Per-source daily request budgets |
| Dashboard latency | All queries < 5ms on SQLite with indexes | Not a concern |

**Enable WAL mode** immediately — it prevents write-lock contention and is the recommended default:
```javascript
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Fetching raw filing text for every filing on every run
**What goes wrong:** You re-download multi-MB EDGAR documents daily, hammering rate limits and wasting Claude API tokens.
**Instead:** Fetch raw text once, store in `filings.raw_text`, check `fetched_at IS NULL` before fetching.

### Anti-Pattern 2: Storing all state in JSON files
**What goes wrong:** Reading/writing a 10MB JSON file to add one new opportunity. No query support. Risk of corruption on interrupted write.
**Instead:** SQLite with `INSERT OR IGNORE` and proper constraints.

### Anti-Pattern 3: Calling Claude on every run for every filing
**What goes wrong:** Exponential API cost as the database grows. Claude is called for already-analyzed filings.
**Instead:** `WHERE claude_analysis IS NULL` filter ensures Claude is only called once per opportunity.

### Anti-Pattern 4: Using RSS feed as primary discovery mechanism
**What goes wrong:** RSS gives you form type + company name but not filing content. You cannot filter for spinoff-specific language — you'd download every 8-K filed company-wide.
**Instead:** EFTS full-text search with keyword query `"spin-off" OR "spinoff"` filtered to relevant form types. Dramatically smaller result set.

### Anti-Pattern 5: Skipping the User-Agent header on EDGAR requests
**What goes wrong:** EDGAR blocks automated requests without a valid User-Agent. The SEC explicitly requires `AppName/Version contact@email.com` format.
**Instead:** Always set the header. Hardcode it in the EDGAR client module.

---

## Phase-Specific Architecture Flags

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| EDGAR ingestion | Rate limit 429s on startup burst | Add min 300ms delay between requests, retry on 429 |
| Form 10-12B text parsing | Filing HTML is deeply nested; exhibits vary | Use EFTS `fileUrl` to get primary document, not full submission ZIP |
| Claude analysis | Token limits on long filings | Summarize/truncate to first 8-10K chars of relevant sections before sending |
| News API | Quotas differ widely by provider; free tiers are small | Alpha Vantage news free tier (500 req/day) is sufficient for daily cadence |
| SQLite on Windows | Path separators in data dir | Use `path.join()` for all file paths, never string concatenation |
| Scheduler on Windows | node-cron works but Windows Task Scheduler is more reliable for system-level jobs | Keep in-process for simplicity; document the alternative |

---

## Sources

- [SEC EDGAR Full Text Search FAQ](https://www.sec.gov/edgar/search/efts-faq.html) — EFTS endpoint documentation
- [SEC EDGAR RSS Feeds](https://www.sec.gov/about/rss-feeds) — RSS feed documentation and URL patterns
- [SEC EDGAR Developer Resources](https://www.sec.gov/about/developer-resources) — Official API overview
- [SEC EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) — Rate limits (10 req/s)
- [data.sec.gov Submissions API](https://data.sec.gov/) — CIK-based submissions endpoint
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — Synchronous SQLite for Node.js (MEDIUM-HIGH confidence: official repo)
- [Node.js native SQLite docs](https://nodejs.org/api/sqlite.html) — Built-in node:sqlite (experimental as of Node 22)
- [node-cron GitHub](https://github.com/node-cron/node-cron) — Cron scheduler
- [edgar-filing-search (apifyforge)](https://github.com/apifyforge/edgar-filing-search) — EFTS endpoint structure and response fields
- [Getting Started with Native SQLite in Node.js](https://betterstack.com/community/guides/scaling-nodejs/nodejs-sqlite/) — better-sqlite3 best practices
- [Comparing best Node.js schedulers](https://blog.logrocket.com/comparing-best-node-js-schedulers/) — Scheduler comparison
- [Downloading SEC filings faster](https://medium.com/@jgfriedman99/downloading-filings-from-the-sec-100x-faster-c38a37a59296) — EDGAR rate limit patterns
