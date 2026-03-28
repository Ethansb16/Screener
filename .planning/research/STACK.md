# Technology Stack

**Project:** Spinoff Investment Screener
**Researched:** 2026-03-28
**Overall Confidence:** HIGH (SEC EDGAR APIs verified via official sources; library versions current as of research date)

---

## Recommended Stack

### Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22.x LTS | Runtime | LTS until April 2027; native `fetch` built-in (no node-fetch needed); native `node:sqlite` is now unflagged-but-experimental — use `better-sqlite3` instead for now |
| ESM / `"type": "module"` | — | Module system | Native ES modules in Node 22 are stable; avoids CommonJS interop friction with modern libraries |

---

### Data Ingestion — SEC EDGAR (Free, No Key)

The SEC runs two distinct free APIs. Use both.

#### API 1: `data.sec.gov` — Structured Submissions

| Endpoint | What it returns |
|----------|----------------|
| `https://data.sec.gov/submissions/CIK##########.json` | All filings for a company (paginated), including form type, date, accession number |
| `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | XBRL financial facts (balance sheet items, etc.) |

- **Authentication:** None. Must set a descriptive `User-Agent` header (SEC requirement): `User-Agent: YourAppName contact@youremail.com`
- **Rate limit:** 10 requests/second hard cap. Exceeding it triggers a temporary IP block (10-minute cooldown). Stay at 5 req/s to be safe.
- **Form types relevant to spinoffs:** `8-K` (material events), `10-12B`/`10-12G` (Form 10 spinoff registrations), `4` (insider transactions)
- **Update frequency:** Submissions updated with <1s delay; XBRL with <1 min delay

#### API 2: EFTS (`efts.sec.gov`) — Full-Text Search

| Endpoint | What it returns |
|----------|----------------|
| `https://efts.sec.gov/LATEST/search-index?q="spin-off"&forms=8-K&dateRange=custom&startdt=2025-01-01&enddt=2025-12-31` | Filings matching keyword search, filterable by form type and date range |

- **Authentication:** None
- **Pagination:** Up to 50 results per page (`hits.hits._source` structure); use `from` parameter
- **Coverage:** All electronically submitted filings since ~1993
- **Boolean operators supported:** AND, OR, NOT, phrase quotes, wildcards
- **Recommended query strings for spinoffs:** `"spin-off" OR "spinoff" OR "separation" OR "distribution to shareholders"`
- **Rate limit:** Same 10 req/s cap as data.sec.gov; add 150ms between requests in batch loops

**Do NOT use sec-api.io for EDGAR ingestion.** Their free tier is 100 calls/month — unusable for daily polling. The raw SEC endpoints above are free and unlimited (within rate limits).

---

### Data Ingestion — Financial News

**Recommendation: Finnhub (free tier)**

| Technology | Free Tier | Cost to Scale | Why |
|------------|-----------|--------------|-----|
| **Finnhub** | 60 calls/min; company news, insider transactions, market news | $0–$50/mo | Best free tier for this use case; has insider transaction endpoint that mirrors Form 4 data; official JS client available |
| Alpha Vantage | 25 calls/day | $50/mo | Free tier is virtually unusable for daily polling |
| Polygon.io | 5 calls/min, EOD only | $29/mo (starter) | Good for price data, not news; free tier too restrictive for news |
| Benzinga | Free tier has headline + teaser only (no full body) | Custom quote | Good news depth but opaque pricing; free tier too limited |
| NewsAPI.org | 100 calls/day (dev plan), no commercial use | $449/mo | No financial-specific filtering; dev plan blocks production deployment |

**Finnhub endpoints to use:**

```
GET https://finnhub.io/api/v1/company-news?symbol=TICKER&from=2025-01-01&to=2025-01-31&token=API_KEY
GET https://finnhub.io/api/v1/stock/insider-transactions?symbol=TICKER&token=API_KEY
GET https://finnhub.io/api/v1/news?category=general&token=API_KEY   (market-wide news stream)
```

- Official JS client: `finnhub` npm package (maintained by Finnhub)
- Insider transaction endpoint overlaps with SEC Form 4, giving a second ingestion path for insider signals

---

### HTTP Client

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Native `fetch`** | Node 22 built-in | All HTTP requests to SEC EDGAR + news APIs | Zero dependencies; Node 22 fetch is stable and production-ready; no need for axios or got for simple REST calls |
| `axios` | 1.x (optional) | If retries/interceptors become needed | Only add if you need automatic retry logic or request interceptors; don't add preemptively |

**Do NOT add `node-fetch`.** It was a polyfill for pre-v18 Node. Unnecessary in Node 22.

---

### AI Analysis

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@anthropic-ai/sdk` | ^0.80.0 (current as of March 2026) | Claude API calls for filing summarization | Official SDK; requires Node 18+; current package replaces the `claude` ^0.1.1 stub in the existing package.json |

**Note:** The existing `package.json` has `claude: ^0.1.1` — this is an unofficial/placeholder package, not Anthropic's SDK. Replace it with `@anthropic-ai/sdk`.

```bash
npm uninstall claude
npm install @anthropic-ai/sdk
```

**Model to use:** `claude-sonnet-4-5` or `claude-haiku-3-5` — Haiku for cost efficiency on bulk summarization, Sonnet for deeper analysis passes. Do not use Opus for batch jobs; cost-prohibitive.

---

### Scheduler

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `node-cron` | ^3.0.x | Daily job trigger | Simplest cron-syntax scheduler for a solo project; no persistence needed for a daily once-a-day job; actively maintained; ~4M weekly downloads |

**Why not alternatives:**
- `node-schedule`: More flexible but heavier; overkill for a single daily cron
- `BullMQ` / `Agenda`: Queue persistence systems; over-engineered for a personal tool with no distributed workers
- `@nestjs/schedule`: Only relevant if you adopt NestJS as your framework (not recommended here — see Web Framework section)

**Pattern for a daily 6am job:**
```javascript
import cron from 'node-cron';
cron.schedule('0 6 * * *', async () => { await runDailyScreener(); });
```

---

### Web Framework + Dashboard

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Express** | ^4.21.x | HTTP server + API routes | Widest ecosystem, zero learning curve for a solo project; no perf justification for Fastify/Hono at 1 user |
| **HTMX** | ^2.0.x (CDN) | Dashboard interactivity | Server-rendered HTML with partial updates via `hx-get`; zero build step; perfect for "refresh table" / "load details" interactions |
| **Tailwind CSS** | v4.x (CDN) | Styling | Play CDN is fine for a personal tool with no production SLA; eliminates build pipeline entirely |

**Why not React/Vue/Next.js:** A solo personal screener dashboard has ~5 views (summary table, filing detail, AI summary, history). React's build pipeline, component state, and bundler complexity is not justified. HTMX + server-rendered Express templates (use `ejs` or raw HTML strings) covers all needed interactivity without webpack/vite.

**Why not Hono or Fastify:** Performance benchmarks are irrelevant at 1 concurrent user. Express has the most middleware and the lowest research overhead.

**Template engine:** Use `ejs` (`npm install ejs`) for simple server-side HTML rendering. Avoid Handlebars (verbose syntax) or Pug (whitespace-sensitive, unfamiliar).

---

### Database / Storage

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **`better-sqlite3`** | ^9.x | Local persistent storage | Synchronous API; fastest SQLite wrapper for Node; no async complexity; perfectly suited for a single-process daily job; stores screener results, processed filing records, AI summaries |

**Why not Node's built-in `node:sqlite`:** Still experimental as of Node 22 (was unflagged in v22.13.0 but still marked experimental). `better-sqlite3` is battle-tested with 4M+ weekly downloads. Revisit native module when Node 24 LTS stabilizes it (Oct 2025 onward).

**Why not lowdb (JSON file):** No query capability; will become unwieldy once you accumulate months of daily runs. SQLite gives you free SQL filtering (`WHERE form_type = '8-K' AND filed_at > ?`).

**Why not PostgreSQL/MySQL:** Overkill for a local personal tool. No server to run, no connection pooling needed.

**Schema hint:** Three core tables — `filings` (raw EDGAR hits), `opportunities` (deduplicated spinoff candidates), `ai_summaries` (Claude output keyed to opportunity_id).

---

### Configuration + Environment

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `dotenv` | ^16.x | API key management | Standard; loads `.env` into `process.env`; zero friction |

**`.env` keys needed:**
```
ANTHROPIC_API_KEY=
FINNHUB_API_KEY=
SEC_USER_AGENT="SpinoffScreener your@email.com"
PORT=3000
```

---

### Logging

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **`pino`** | ^9.x | Structured logging | 5–10x faster than Winston; JSON output; `pino-pretty` for readable dev output; important for catching EDGAR rate limit errors and API failures in the daily job |

```bash
npm install pino pino-pretty
```

**Why not `console.log`:** No log levels, no timestamps, no structured error context — will become painful when debugging why a daily job silently skipped 3 filings.

**Why not Winston:** More configuration for no benefit at this scale. Pino's defaults are better.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| News API | Finnhub (free) | Alpha Vantage | AV free tier = 25 calls/day; unusable |
| News API | Finnhub (free) | Benzinga | Opaque pricing; free tier body-less |
| EDGAR wrapper | Raw `data.sec.gov` | `sec-api.io` npm | 100 calls/month free; paid starts at $55/mo |
| HTTP client | Native `fetch` | `axios` | axios adds no value over native fetch for simple REST |
| Scheduler | `node-cron` | `BullMQ` | Queue infrastructure for 1 daily job is over-engineered |
| Frontend | HTMX + Express | React/Next.js | Full SPA for a 5-screen personal tool is unjustified complexity |
| Database | `better-sqlite3` | `lowdb` | No query capability; will hit limits after weeks of data |
| Database | `better-sqlite3` | PostgreSQL | Requires server; unnecessary for local/single-user |
| AI SDK | `@anthropic-ai/sdk` | `claude` (npm) | `claude@0.1.1` is an unofficial stub, not Anthropic's SDK |
| Logging | `pino` | `winston` | Heavier config for same output at this scale |

---

## Full Dependency List

```bash
# Replace the claude stub first
npm uninstall claude

# Core runtime dependencies
npm install @anthropic-ai/sdk dotenv express ejs better-sqlite3 node-cron pino pino-pretty

# News API
npm install finnhub   # optional — can use native fetch with raw API calls instead
```

**Total production deps: ~7–8 packages.** Deliberately minimal.

No TypeScript is recommended for a personal tool — adds compile step complexity with no real benefit for a solo codebase of this size. Plain ESM JavaScript with JSDoc annotations if type hints are desired.

---

## SEC EDGAR API Quick Reference

### Endpoint 1: Company Submissions (find Form 4s, 8-Ks for a known company)

```
GET https://data.sec.gov/submissions/CIK0000000000.json
Headers: { "User-Agent": "SpinoffScreener you@email.com" }
```

Response: JSON with `filings.recent` array containing `form`, `filingDate`, `accessionNumber`, `primaryDocument` columns (parallel arrays by index).

### Endpoint 2: Full-Text Search (keyword scan across all filings)

```
GET https://efts.sec.gov/LATEST/search-index?q=%22spin-off%22+OR+%22spinoff%22&forms=8-K,10-12B&dateRange=custom&startdt=2025-01-01&enddt=2025-12-31&hits.hits._source=period_of_report,entity_name,file_date,form_type,file_num
```

Response: `{ hits: { hits: [ { _source: { entity_name, form_type, file_date, ... } } ] } }`

### Endpoint 3: Filing Document Access

```
GET https://www.sec.gov/Archives/edgar/data/{CIK}/{accession-number-no-dashes}/{primary-document}
Headers: { "User-Agent": "SpinoffScreener you@email.com" }
```

Returns raw HTML/XML of the actual filing. Feed this text to Claude for summarization.

### Rate Limit Compliance

```javascript
// Utility: sleep between SEC requests
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// In any batch loop over EDGAR endpoints:
await sleep(200); // 5 req/s — safely under the 10 req/s cap
```

---

## Sources

- [SEC EDGAR Developer Resources](https://www.sec.gov/about/developer-resources) — official API documentation
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) — rate limits and user-agent requirements
- [EDGAR Full Text Search FAQ](https://www.sec.gov/edgar/search/efts-faq.html) — EFTS endpoint documentation
- [Finnhub API Documentation](https://finnhub.io/docs/api/company-news) — news and insider transaction endpoints
- [sec-api.io Pricing](https://sec-api.io/pricing) — confirms 100 calls/month free tier
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — current version 0.80.0
- [Financial Data APIs Compared 2026](https://www.ksred.com/the-complete-guide-to-financial-data-apis-building-your-own-stock-market-data-pipeline-in-2025/) — Alpha Vantage / Polygon / Finnhub comparison
- [Best Financial Data APIs 2026](https://www.nb-data.com/p/best-financial-data-apis-in-2026) — FMP, Tiingo, Finnhub, EODHD analysis
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — sync API, performance characteristics
- [Node.js native SQLite status](https://betterstack.com/community/guides/scaling-nodejs/nodejs-sqlite/) — confirms experimental status in Node 22
- [Axios vs Fetch 2025](https://blog.logrocket.com/axios-vs-fetch-2025/) — native fetch recommendation for Node 18+
- [node-cron vs node-schedule vs croner](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/) — scheduler comparison
- [Pino vs Winston](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/) — logger comparison
- [HTMX vs React](https://www.contentful.com/blog/htmx-react-use-cases/) — frontend approach tradeoffs
- [Tailwind CSS v4 CDN](https://tailwindcss.com/docs/installation/play-cdn) — Play CDN approach
