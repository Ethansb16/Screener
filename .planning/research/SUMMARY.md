# Research Summary — Spinoff Screener

**Project:** Spinoff Investment Screener
**Domain:** Personal financial data pipeline + event-driven investing dashboard
**Researched:** 2026-03-28
**Confidence:** HIGH

---

## Critical Warnings

Things that will break the project if ignored.

**1. The `claude` npm package in the existing package.json is a stub — it is not Anthropic's SDK.**
`claude@0.1.1` is an unofficial placeholder. All Claude API calls will fail silently or throw. Replace immediately:
```bash
npm uninstall claude
npm install @anthropic-ai/sdk
```

**2. SEC EDGAR will IP-ban you if you fire concurrent requests.**
The hard cap is 10 req/s across all endpoints. `Promise.all()` over an array of CIKs will blow past this in milliseconds. The ban is silent — subsequent requests just return empty bodies, not errors. Every EDGAR request must go through a shared rate limiter with a minimum 200–300ms delay and exponential backoff with jitter on 429/503.

**3. A freshly-filed Form 10 (10-12B) is a skeleton — do not treat it as a confirmed spinoff.**
Initial filings are often missing distribution ratios, financial statements, and separation terms, all marked "to be filed by amendment." Deals can be withdrawn after SEC comment. The pipeline must track a "candidate → confirmed" lifecycle using amendment (10-12B/A) progression, not just the initial filing date.

**4. Form 4 transaction codes will produce garbage signals if read naively.**
`acquiredDisposedCode = "D"` is NOT "insider selling." Code `F` (tax withholding) also sets `D` and accounts for the majority of Form 4 volume. Only codes `P` (open-market purchase) and `S` (open-market sale) carry directional signal. Filter to `transactionCode IN ('P', 'S')` exclusively; flag code `J` separately for manual review (distribution of SpinCo shares at effective date).

**5. Claude API costs compound fast without batching and prompt caching.**
A naive daily run re-sending the same system prompt for every filing, synchronously, can run up costs 10–20x what they need to be. Use the Batch API (50% discount) and prompt caching (90% savings on repeated context) from day one. Only send filings that have `claude_analysis IS NULL` — never re-analyze already-processed records.

**6. All EDGAR requests must include a `User-Agent` header with your email.**
The SEC's stated policy classifies requests without a proper User-Agent as unidentified bots and blocks them. This is distinct from the rate limit; it affects every single request regardless of rate. Format: `User-Agent: SpinoffScreener your@email.com`.

---

## Stack Decisions

Confirmed technology choices with rationale. Full details in `.planning/research/STACK.md`.

| Technology | Role | Decision |
|------------|------|----------|
| Node.js 22 LTS | Runtime | Use. Native `fetch` built-in; LTS until April 2027. No node-fetch. |
| ESM (`"type":"module"`) | Module system | Use. Stable in Node 22; avoids CommonJS interop pain. |
| `@anthropic-ai/sdk` ^0.80.0 | Claude integration | Use. Replaces the `claude@0.1.1` stub in package.json. |
| `better-sqlite3` ^9.x | Storage | Use. Synchronous API; battle-tested; zero operational overhead for a local single-process tool. |
| `node-cron` ^3.0.x | Scheduler | Use. Standard cron syntax; correct scope for one daily job. No queue system needed. |
| Express ^4.21.x | HTTP server | Use. Zero learning curve; irrelevant performance difference at 1 concurrent user. |
| HTMX ^2.0.x (CDN) | Dashboard interactivity | Use. Server-rendered partials with no build step. |
| Tailwind CSS v4 (Play CDN) | Styling | Use. Eliminates build pipeline for a personal tool. |
| `pino` ^9.x | Logging | Use. Structured logs with levels; critical for catching silent EDGAR failures. |
| `dotenv` ^16.x | Config | Use. Standard env key management. |
| Native `fetch` | HTTP client | Use. Built into Node 22. Do not add axios or node-fetch. |
| **SEC EDGAR (data.sec.gov + efts.sec.gov)** | Primary data | Use. Free, no API key, official source. Use EFTS for keyword search; submissions API for per-company filings. |
| **Finnhub** | News / insider data | Use. Best free tier (60 calls/min); company news + insider transaction endpoints. |
| `sec-api.io` | Alternative EDGAR wrapper | **Reject.** 100 calls/month free tier is unusable. |
| React / Next.js | Frontend | **Reject.** Build pipeline unjustified for a 5-view personal tool. |
| `node:sqlite` (built-in) | Alternative DB | **Reject.** Still experimental in Node 22. Revisit at Node 24 LTS. |
| Alpha Vantage, NewsAPI | Alternative news APIs | **Reject.** Free tiers too restrictive (25 calls/day, 100 calls/day). |

**Model selection for Claude:** Use `claude-haiku-3-5` for bulk classification and summarization (cost). Use `claude-sonnet-4-5` for deeper signal analysis passes. Never use Opus for batch jobs.

---

## Architecture Decisions

Structural choices and data model. Full details in `.planning/research/ARCHITECTURE.md`.

**Overall pattern:** Single Node.js process, four layers — Ingestion, Processing, Storage, Serving — all in the same process. No microservices, no message queue, no external database.

**Pipeline stages (sequential, idempotent):**
1. EDGAR Ingestion — EFTS keyword search for `10-12B`, `8-K`, `Form 4` filings from the last 24 hours → `INSERT OR IGNORE` into `filings` (dedup on `accession_number`)
2. News Ingestion — Finnhub keyword query → `INSERT OR IGNORE` into `news_items` (dedup on SHA-256 of source + normalized headline)
3. Signal Extraction — parse unprocessed filings → write candidates to `opportunities`
4. Claude Analysis — for each `opportunities` row with `claude_analysis IS NULL`, call Claude → store JSON result
5. Run Log — write completion status to `run_log`

**Four core database tables:**
- `filings` — every discovered SEC filing; `accession_number UNIQUE` is the dedup key
- `opportunities` — one row per spinoff candidate; `UNIQUE(filing_id, signal_type)` prevents re-processing
- `news_items` — discovered news articles; `content_hash UNIQUE` is the dedup key
- `run_log` — audit trail per pipeline execution

**Key architectural rules that must hold:**
- All EDGAR requests go through a single `edgarClient.js` wrapper with rate limiting and User-Agent injection
- `filings.raw_text` is fetched once and cached; never re-download a filing whose `fetched_at IS NOT NULL`
- `claude_analysis IS NULL` filter ensures Claude is called once per opportunity, forever
- Enable `PRAGMA journal_mode = WAL` immediately on database open; prevents write-lock issues
- All EDGAR calls are server-side only; EDGAR does not have CORS headers and cannot be called from a browser
- Schedule daily cron at 6:00–7:00 AM ET, not midnight; late-evening filings (post-5:30 PM ET) receive the next day's date and need overnight processing to be visible

**Directory structure (canonical):**
```
src/
  db/              schema.js, db.js (singleton)
  ingestion/       edgarClient.js, edgarIngester.js, newsIngester.js
  processing/      signalExtractor.js, claudeAnalyzer.js
  pipeline/        runner.js
  server/          index.js, routes/
  scheduler.js
  main.js
public/            index.html, app.js, styles.css
data/              screener.db (gitignored)
.env               (gitignored)
```

---

## Feature Phasing

What goes in V1, V2, V3 based on research. Full details in `.planning/research/FEATURES.md`.

### V1 — Core Thesis, Pre-Effective Date Signal

Goal: Answer "Is this spinoff set up for success?" from Form 10 text alone, before any insider buying occurs.

| Feature | Why V1 |
|---------|--------|
| Spinoff feed (list of announced + pending spinoffs) | Core navigation; nothing works without this |
| Parent company + SpinCo names, tickers, dates | Minimum identification data |
| Deal type label (spinoff vs. carve-out vs. split-off) | Prevents false positives from the start; required for thesis validity |
| Reason classification (unlock value / shed weak unit / regulatory) | Primary bullish/bearish signal; extracted from Form 10 "Reasons" section |
| Compensation structure flag (SpinCo mgmt receiving equity?) | Core Greenblatt signal; found in Form 10 Item 6 |
| Management movement flag (executives moved to SpinCo?) | Confirms alignment; found in Form 10 management section |
| Institutional mismatch score (SpinCo size vs. parent + index) | Calculated signal; no additional data source needed |
| Overall signal badge (Bullish / Bearish / Neutral / Pending) | Summary verdict synthesizing all V1 signals |
| AI plain-English summary paragraph | Claude-generated from Form 10 summary + reason + comp section |
| Daily refresh (6 AM cron) | Core utility; tool is useless without this |
| Link to SEC filings (Form 10, 8-K) | Power user escape hatch to primary source |
| "Candidate" vs "Confirmed" status | Prevents premature signals from skeleton 10-12B filings |

### V2 — Post-Effective Date Confirmation Signal

Goal: Answer "Are insiders putting money where their mouth is after the spin is complete?"

| Feature | Why V2 |
|---------|--------|
| Form 4 open-market buy detection (codes P/S only) | Requires SpinCo to have its own EDGAR CIK (assigned at or after effective date); separate data pipeline |
| Option strike price analysis | Finer-grained comp parsing; valuable but non-blocking for V1 verdict |
| Rights offering flag | Greenblatt's highest-priority signal but relatively rare; adds edge cases |
| Parent-as-buy flag | Requires additional business quality reasoning beyond Form 10 text |
| Financial snapshot tables (pro-forma revenue, EBITDA, debt) | Reliable extraction from Form 10 financials is parsing-intensive; defer |

### V3 — Quality of Life

| Feature | Why V3 |
|---------|--------|
| Email / push notification digest | Daily browsable feed is sufficient for MVP |
| Historical performance tracking | Requires post-spin price data and time |
| Watchlist / annotation support | Useful but not required for the core research workflow |

**Explicit anti-features (never build):** DCF/valuation calculator, charting/technicals, multi-user auth, real-time alerts, general stock screener filters, automated trade execution, peer comparison engine.

---

## Key Unknowns

Things that need empirical testing during development — cannot be resolved by research alone.

**1. Form 10 text quality for AI extraction.**
Form 10 filings are multi-hundred-page HTML documents. It is unknown how consistently the "Reasons for the Distribution," "Executive Compensation," and management sections appear at predictable document positions. The AI prompt strategy (send first N chars vs. section-targeted extraction) needs testing on 5–10 real Form 10 filings before the signal extractor is designed. This is the highest-risk unknown for V1 delivery.

**2. Claude token budget per filing.**
Long Form 10s may exceed practical context limits for a single API call. The truncation strategy (first 8–10K chars of relevant sections vs. full document with summarization pass) needs cost and quality benchmarking on real filings. The Batch API + prompt caching architecture is confirmed correct; the per-filing token budget is not.

**3. EFTS search recall rate for spinoff discovery.**
The query `q="spin-off" OR "spinoff" OR "separation" AND forms=10-12B` is the recommended discovery mechanism. It is unknown what percentage of real spinoffs are captured vs. missed because companies use non-standard language. A manual cross-check against a known spinoff calendar (InsideArbitrage, StockSpinoffs.com) during early runs will validate recall.

**4. Finnhub news signal-to-noise ratio in practice.**
Research identifies Finnhub as the correct free-tier news source, but the actual false-positive rate for "spinoff" keyword hits in financial news is unknown. The second-pass filter (require SEC/regulatory language in article body) is a recommended mitigation but needs tuning against real data.

**5. Windows Task Scheduler vs. in-process node-cron reliability.**
The target machine is Windows 11. node-cron works in-process but requires the Node process to stay running. Windows Task Scheduler calling `node src/main.js` directly is more reliable for long-running personal tools but loses the unified process with the web UI. The correct choice depends on whether the tool runs as a background service or on-demand — this is a deployment decision that research cannot answer.

**6. SpinCo CIK assignment timing.**
Form 4 monitoring in V2 requires the SpinCo to have its own EDGAR CIK. Research confirms this is assigned at or after the Form 10 filing, but the exact timing (assigned at initial filing vs. only after effectiveness) needs empirical verification with a real example before V2 pipeline design is finalized.

---

## Cross-Cutting Findings

Patterns that appeared independently in multiple research files — highest confidence.

| Finding | Appears In | Implication |
|---------|-----------|-------------|
| EDGAR rate limit (10 req/s) requires shared throttle with jitter | STACK, ARCHITECTURE, PITFALLS | Single `edgarClient.js` wrapper is mandatory, not optional |
| `10-12B` is the canonical spinoff form; `8-K` alone is ambiguous | FEATURES, PITFALLS | Detection logic must treat `10-12B` as primary signal; 8-K as unconfirmed candidate |
| Claude must only be called once per opportunity (cost control) | STACK, ARCHITECTURE, PITFALLS | `claude_analysis IS NULL` filter and Batch API from day one |
| Form 10 text parsing is the foundation of every V1 signal | FEATURES, ARCHITECTURE | Signal extractor quality is the critical path for the entire project |
| `better-sqlite3` over JSON files, over PostgreSQL | STACK, ARCHITECTURE | No alternative; JSON files break at weeks of data, PostgreSQL is over-engineered |
| No frontend framework; HTMX + Express is correct | STACK, ARCHITECTURE | Build pipeline unjustified; this decision is stable |

---

## Implications for Roadmap

Suggested phase structure based on feature dependencies and architectural constraints.

### Phase 1: Foundation — Database, Pipeline Shell, EDGAR Client
**Rationale:** Everything else depends on a working EDGAR client with correct rate limiting and a database schema that supports idempotent re-runs. Build this first so every subsequent phase has a stable base.
**Delivers:** Working pipeline skeleton: EDGAR queries fire, results are stored, cron runs daily, run_log records execution.
**Key pitfalls to wire in from day one:** User-Agent header, 200ms rate limit delay, exponential backoff with jitter, `INSERT OR IGNORE` deduplication, WAL mode.
**Research flag:** Standard patterns — no additional research needed.

### Phase 2: Spinoff Discovery — Detection and Classification
**Rationale:** The feed is the product's core navigation. Without a reliable list of spinoffs, nothing else matters.
**Delivers:** Daily-refreshed list of spinoff candidates discovered from EDGAR EFTS (`10-12B`, `8-K`) and Finnhub news. Each candidate has parent/SpinCo names, filing dates, deal type classification (spinoff vs. carve-out vs. split-off), and a "candidate vs. confirmed" status.
**Key pitfalls:** Must distinguish `10-12B` initial filing (candidate) from confirmed effective spinoff. Must classify deal type to avoid treating carve-outs as spinoffs.
**Research flag:** Needs empirical validation of EFTS keyword recall against a known spinoff calendar.

### Phase 3: Signal Extraction — Form 10 Parsing
**Rationale:** This is the highest-risk, highest-value phase. The quality of the signal extractor determines whether the tool is useful or not.
**Delivers:** Automated extraction from Form 10 of: (1) reason classification, (2) compensation structure flag, (3) management movement flag, (4) institutional mismatch score. These four signals produce the overall Bullish/Bearish/Neutral badge.
**Key pitfalls:** Form 10 section positions are not standardized. Needs testing on 5–10 real filings before prompt strategy is locked in. Claude token budget per filing needs empirical calibration.
**Research flag:** Needs phase-level research on Form 10 section extraction strategies and token optimization before implementation begins.

### Phase 4: AI Summary — Claude Integration
**Rationale:** Once signals are extracted, Claude's job is to synthesize them into a plain-English paragraph and overall verdict. This phase is separated from Phase 3 because the input (extracted signals + Form 10 context) must be stable before prompt engineering begins.
**Delivers:** AI-generated summary per spinoff; overall signal verdict with explanation. Batch API + prompt caching wired in from first call.
**Key pitfalls:** Batch API submission and retrieval pattern; prompt caching setup; `claude_analysis IS NULL` filter enforced.
**Research flag:** Standard patterns — Batch API and prompt caching are well-documented.

### Phase 5: Dashboard — Feed and Detail Views
**Rationale:** Once data is flowing and signals are computed, the UI surfaces them.
**Delivers:** Express server + HTMX dashboard with: feed view (signal badge, key signal line, dates, links), filter/sort controls (signal, status, date range, institutional mismatch), detail view (all V1 signal data per spinoff), run log visibility.
**Key pitfalls:** HTMX partial updates from Express endpoints are straightforward; no build pipeline risk.
**Research flag:** Standard patterns — no additional research needed.

### Phase 6 (V2): Form 4 Insider Buy Monitoring
**Rationale:** Post-effective-date Form 4 monitoring is a separate pipeline that requires SpinCo CIK assignment and ongoing polling. Kept separate because it cannot start until effective date and adds meaningful pipeline complexity.
**Delivers:** Form 4 buy detection (transaction code P only) per SpinCo in the 30–90 days post-distribution. Updates opportunity signal strength.
**Key pitfalls:** CIK assignment timing needs empirical verification. Transaction code filtering is critical (codes P/S only; J flagged for review).
**Research flag:** Needs empirical verification of SpinCo CIK assignment timing before design.

### Phase Ordering Rationale

- Phases 1–2 are purely about data infrastructure: get filings into the database reliably before attempting any analysis.
- Phase 3 (Form 10 parsing) precedes Phase 4 (Claude) because Claude's input must be structured before prompt engineering makes sense. Reversing this order means rewriting prompts after extraction strategy changes.
- Phase 5 (Dashboard) is last among V1 phases because the data model and API contracts should be stable before the UI is designed against them.
- Phase 6 (V2 Form 4) is correctly deferred: it requires the effective date to have passed, a separate CIK watch list, and ongoing polling — a different operational pattern from the batch-and-analyze pipeline of V1.

### Research Flags

Phases needing deeper research during planning:
- **Phase 3 (Form 10 Parsing):** Form 10 section structure varies by company; AI extraction strategy and token budget need empirical calibration on real filings before implementation design is finalized.
- **Phase 2 (Discovery):** EFTS keyword recall rate needs validation against known spinoff calendars during early implementation.
- **Phase 6 (Form 4 V2):** SpinCo CIK assignment timing needs empirical verification.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 1 (Foundation):** EDGAR rate limiting, SQLite setup, cron scheduling — all well-documented with verified patterns.
- **Phase 4 (Claude Integration):** Batch API and prompt caching are official Anthropic documentation.
- **Phase 5 (Dashboard):** Express + HTMX patterns are well-established.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | SEC EDGAR APIs verified via official sources; library versions confirmed current as of March 2026; Finnhub free tier independently confirmed |
| Features | HIGH | Signals directly derived from Joel Greenblatt primary sources and SEC filing structure; Form 10 section map verified against CFR Item 402 |
| Architecture | MEDIUM-HIGH | Patterns verified; the one uncertainty is Form 10 text extraction reliability in practice |
| Pitfalls | HIGH | SEC rate limits and filing lifecycle from official SEC sources; Form 4 transaction codes from SEC XML spec; Claude cost patterns from official pricing |

**Overall confidence:** HIGH for the infrastructure and data pipeline. MEDIUM for Form 10 signal extraction quality — this requires empirical validation, not research.

### Gaps to Address

- **Form 10 section extraction reliability:** Cannot be resolved by research; requires testing 5–10 real Form 10 filings to assess section position consistency and inform AI prompt strategy. Address in Phase 3 planning.
- **EFTS recall completeness:** Unknown percentage of spinoffs use non-standard language and would be missed by keyword search. Validate by cross-referencing early pipeline output against InsideArbitrage or StockSpinoffs.com manually.
- **Claude token cost calibration:** Per-filing cost under Batch API + prompt caching is estimated but not measured. Track from the first production run and adjust max_tokens caps accordingly.
- **Windows deployment model:** Whether to run as a persistent process (node-cron in-process, exposes web UI) or OS-scheduled task (more reliable, separate from web server) is an open decision. Affects `main.js` architecture. Recommend: start with in-process node-cron; migrate to Task Scheduler if reliability issues arise.

---

## Sources

### Primary (HIGH confidence — official documentation)
- [SEC EDGAR Developer Resources](https://www.sec.gov/about/developer-resources) — API structure, rate limits, User-Agent requirement
- [EDGAR Full Text Search FAQ](https://www.sec.gov/edgar/search/efts-faq.html) — EFTS endpoint, query parameters, response structure
- [SEC EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) — submissions API, rate limits
- [SEC Form 4 Ownership XML Technical Specification v3](https://www.sec.gov/info/edgar/ownershipxmltechspec-v3.pdf) — transaction code definitions
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — current version, Node requirements
- [Claude Batch API and Prompt Caching docs](https://platform.claude.com/docs/en/about-claude/pricing) — cost structure
- [Item 402 Executive Compensation — CFR](https://www.law.cornell.edu/cfr/text/17/229.402) — Form 10 comp section structure
- [Wachtell Lipton 2025 Spin-Off Guide](https://www.wlrk.com/wp-content/uploads/2025/05/2025-Spin-Off-Guide.pdf) — Form 10 filing lifecycle, amendment cycle

### Secondary (MEDIUM confidence — practitioner sources, multiple corroborating)
- [GreenFlux SEC API integration guide](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/) — CIK padding, columnar arrays, CORS behavior
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — sync API, performance characteristics
- [Finnhub API Documentation](https://finnhub.io/docs/api/company-news) — news and insider transaction endpoints
- [2IQ Research Form 4 guide](https://www.2iqresearch.com/blog/what-is-sec-form-4-and-how-do-you-read-form-4-filings-2022-03-11) — transaction code interpretation
- [Joel Greenblatt spinoff thesis — Stock Spinoff Investing](https://stockspinoffinvesting.com/category/joel-greenblatt/) — investment thesis operationalization

### Tertiary (LOW confidence — single source or inference)
- Claude cost reduction estimates (Batch + cache: ~95% savings) — derived from official pricing math; actual savings depend on prompt structure and model choice
- EFTS keyword recall rate — no published data; inference from keyword coverage of "spin-off" vs. "separation" variants

---

*Research completed: 2026-03-28*
*Ready for roadmap: yes*
