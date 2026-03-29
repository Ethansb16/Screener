# Phase 2: Discovery - Research

**Researched:** 2026-03-28
**Domain:** EDGAR EFTS full-text search, spinoff filing lifecycle, deal classification
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | System scans SEC EDGAR EFTS daily for Form 10-12B and spinoff-related 8-K filings | EFTS `search-index` endpoint with `forms=10-12B,10-12B/A,8-K` and keyword query confirmed — see Architecture Patterns |
| DISC-02 | System classifies each event as true spinoff, carve-out, divestiture, or split-off — only true spinoffs proceed through the pipeline | Classification by form type + text keyword lookup is the correct approach — `root_form` field plus filing text phrases confirmed — see Classification Patterns |
| DISC-03 | Each spinoff record tracks lifecycle state: Candidate → Confirmed → Withdrawn | EFFECT form type marks confirmed; RW form type marks withdrawn; 10-12B/A progression tracks active deals — see Lifecycle State Tracking |
</phase_requirements>

---

## Summary

Phase 2 replaces two pipeline stubs (`src/pipeline/stages/discover.js` and `src/pipeline/stages/persist.js`) with real EDGAR EFTS discovery logic. The phase must query the EFTS full-text search endpoint for new `10-12B`, `10-12B/A`, and spinoff-related `8-K` filings, classify each by deal type, and write them to the `filings` and `opportunities` tables with the correct lifecycle status.

The EFTS response structure is Elasticsearch-style: `hits.hits` is an array of objects each containing `_id` (the full document filename, prefixed by accession number) and `_source` (filing metadata). The `_source` contains exactly the fields needed: `adsh` (accession number), `form`, `root_form`, `cik`, `display_names`, `file_date`, `file_num`. Pagination uses `from` and `size` parameters; the endpoint returns up to 100 results per request.

Deal classification happens at two levels: form type level (10-12B always means Exchange Act registration, strongly correlated to spinoff) and text level (search for "pro rata distribution" to confirm true spinoff vs. split-off vs. carve-out). Lifecycle state transitions are driven by filing type: initial 10-12B is `Candidate`; ongoing 10-12B/A amendments confirm deal still active; an `EFFECT` notice from SEC marks `Confirmed`; an `RW` filing by the company marks `Withdrawn`. The EFTS query window should cover the prior 24 hours using `dateRange=custom` with `startdt` and `enddt` set to yesterday and today.

**Primary recommendation:** Query EFTS with `forms=10-12B,10-12B/A,8-K` and `q="spin-off" OR "spinoff" OR "separation" OR "distribution to shareholders"` daily. Use `root_form` from `_source` for quick form type identification. Track `file_num` per CIK to group all amendments and notices under one deal. Use `EFFECT` and `RW` as lifecycle signals — check the SpinCo's submissions via `data.sec.gov/submissions/CIK{cik}.json` after initial discovery.

---

## Standard Stack

### Core (all already installed from Phase 1)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `edgarClient.js` | Phase 1 output | All EFTS and data.sec.gov HTTP calls | Rate-limited, User-Agent-injected, already live — import and use directly |
| `better-sqlite3` | 12.8.0 | `INSERT OR IGNORE` filings and opportunities | Already wired with WAL mode and idempotent schema |
| `p-limit` | 7.3.0 | Concurrency cap on parallel requests | Already configured at 8 req/s in edgarClient |
| `pino` | 10.3.1 | Structured logging for discovery counts | Already available via `src/logger.js` |

### No New Dependencies Required

Phase 2 needs zero new npm packages. All required capabilities (HTTP, SQLite, logging, rate limiting) are provided by Phase 1.

```bash
# No installs needed — Phase 1 provides everything
```

### Supporting (for text classification within filing content)

| Technique | Purpose | Notes |
|-----------|---------|-------|
| String `includes()` / `indexOf()` | Keyword scanning of filing text | No library needed; filing summaries are short metadata strings from EFTS |
| Regex on `display_names` field | Extract ticker and CIK from EFTS `display_names` array | Pattern: `"CompanyName (TICKER) (CIK 0001234567)"` |

---

## Architecture Patterns

### Recommended Module Structure

```
src/
  ingestion/
    edgarClient.js        # (Phase 1) — unchanged
    edgar-utils.js        # (Phase 1) — unchanged
    edgarIngester.js      # (Phase 2 NEW) EFTS query + filing INSERT logic
  pipeline/
    stages/
      discover.js         # (Phase 2 REPLACE stub) calls edgarIngester
      persist.js          # (Phase 2 REPLACE stub) upserts opportunities
```

Phase 2 replaces the bodies of `discover.js` and `persist.js`. It also creates `edgarIngester.js` as the reusable EFTS query module, keeping stages thin.

### Pattern 1: EFTS Query for 10-12B and Spinoff 8-Ks

**What:** POST-style GET request to `efts.sec.gov/LATEST/search-index` with keyword and form type filters.

**URL structure (verified from cchummer/sec-api notebook and ARCHITECTURE.md):**
```
GET https://efts.sec.gov/LATEST/search-index
  ?q=%22spin-off%22%20OR%20%22spinoff%22%20OR%20%22separation%22
  &forms=10-12B,10-12B/A,8-K
  &dateRange=custom
  &startdt=2025-03-27
  &enddt=2025-03-28
  &from=0
  &size=100
```

**Note:** The EFTS endpoint also accepts the same parameters without `dateRange=custom` if you use `startdt`/`enddt` directly. The `dateRange=custom` parameter is the enabling flag.

**Query string for 10-12B only (no keyword filter needed — form type is sufficient):**
```
GET https://efts.sec.gov/LATEST/search-index
  ?forms=10-12B,10-12B/A
  &dateRange=custom
  &startdt=2025-03-27
  &enddt=2025-03-28
  &from=0
  &size=100
```

**Query string for spinoff 8-Ks (keyword required to narrow):**
```
GET https://efts.sec.gov/LATEST/search-index
  ?q=%22spin-off%22%20OR%20%22spinoff%22%20OR%20%22pro+rata+distribution%22
  &forms=8-K
  &dateRange=custom
  &startdt=2025-03-27
  &enddt=2025-03-28
  &from=0
  &size=100
```

**Example using edgarGetJson:**
```javascript
// Source: cchummer/sec-api notebook + ARCHITECTURE.md patterns
import { edgarGetJson } from './edgarClient.js';

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

const url = `https://efts.sec.gov/LATEST/search-index?forms=10-12B,10-12B/A&dateRange=custom&startdt=${yesterday}&enddt=${today}&from=0&size=100`;
const result = await edgarGetJson(url);
const hits = result.hits?.hits ?? [];
```

### Pattern 2: EFTS Response Structure

**Verified _source fields (from cchummer/sec-api notebook):**

```json
{
  "_id": "0001193125-16-760799:form10.htm",
  "_source": {
    "adsh":          "0001193125-16-760799",
    "root_form":     "10-12B",
    "form":          "10-12B",
    "file_num":      ["001-36426"],
    "film_num":      ["161976497"],
    "display_names": ["Company Name (TICKER) (CIK 0001603978)"],
    "ciks":          ["0001603978"],
    "sics":          ["0900"],
    "file_date":     "2016-11-07",
    "period_ending": null,
    "file_type":     "10-12B",
    "file_description": "",
    "biz_locations": ["Maynard, MA"],
    "biz_states":    ["MA"],
    "inc_states":    ["DE"]
  }
}
```

**Key field notes:**
- `adsh` — the accession number (dash-separated). This is the dedup key for `filings.accession_number`.
- `root_form` — the parent form type (e.g., `"10-12B"` even for `10-12B/A` amendments). Use `form` for the exact type.
- `display_names` — array of strings in format `"CompanyName (TICKER) (CIK 0001234567)"`. Parse with regex to extract company name, ticker, and CIK.
- `file_num` — array of SEC file numbers (e.g., `"001-36426"`). This is the key for grouping related filings (initial 10-12B + all amendments + EFFECT notice share the same `file_num`).
- `ciks` — array of CIK strings. SpinCo's own CIK is present here for 10-12B filers.
- `file_date` — ISO date string `"YYYY-MM-DD"`.

**Pagination:**
```javascript
// result.hits.total.value gives total result count
// Each request returns up to 100 hits
// Increment 'from' by 100 for subsequent pages
const total = result.hits?.total?.value ?? 0;
for (let from = 0; from < total; from += 100) {
  // fetch page
}
```

**Display name parsing:**
```javascript
// Source: _source.display_names format per notebook
function parseDisplayName(displayName) {
  // Format: "CompanyName (TICKER) (CIK 0001234567)"
  const match = displayName.match(/^(.+?)\s+\(([A-Z]{1,5})\)\s+\(CIK\s+(\d+)\)$/);
  if (match) return { companyName: match[1], ticker: match[2], cik: match[3] };
  // Some names have no ticker: "CompanyName (CIK 0001234567)"
  const noTickerMatch = displayName.match(/^(.+?)\s+\(CIK\s+(\d+)\)$/);
  if (noTickerMatch) return { companyName: noTickerMatch[1], ticker: null, cik: noTickerMatch[2] };
  return { companyName: displayName, ticker: null, cik: null };
}
```

### Pattern 3: Lifecycle State Transitions

**Candidate (initial state):** Set when first `10-12B` filing is discovered.

**Confirmed:** The SEC files an `EFFECT` notice on EDGAR under the SpinCo's CIK when the registration becomes effective. This can be queried via the SpinCo's submissions JSON:
```
GET https://data.sec.gov/submissions/CIK{paddedCIK}.json
```
Look for a row in `filings.recent` where `form === 'EFFECT'`.

Alternatively: The registration becomes automatically effective 30 days after exchange certification (10-12B) or 60 days after filing (10-12G) — so the absence of an RW filing plus passage of time can serve as a soft confirmation signal.

**Withdrawn:** When a company abandons the spinoff, it files an `RW` (Registration Withdrawal Request) on EDGAR under the SpinCo's CIK. Query submissions for `form === 'RW'`. Also watch for 8-K filings from the parent company containing text like "terminated," "abandoned," or "decided not to proceed" with the separation.

**State machine:**
```
Candidate (10-12B detected)
  ├── 10-12B/A filed → remain Candidate (deal still advancing)
  ├── EFFECT filed on SpinCo's CIK → transition to Confirmed
  └── RW filed on SpinCo's CIK → transition to Withdrawn
      OR parent 8-K with termination language → Withdrawn
```

### Pattern 4: Deal Type Classification

For DISC-02, classify deal type using a two-level strategy:

**Level 1 — Form type (no text download required):**
- `form === '10-12B'` or `form === '10-12B/A'` → candidate spinoff (may be split-off too)
- `form === '8-K'` → unconfirmed candidate; requires text review

**Level 2 — Text keyword scan (requires fetching filing index + primary document):**

| Phrase in filing text | Classification |
|-----------------------|----------------|
| `"pro rata"` or `"pro-rata distribution"` | True spinoff |
| `"exchange offer"` or `"split-off"` | Split-off |
| `"initial public offering"` or `"IPO"` in same filing as Form 10 | Carve-out |
| `"sale of"` or `"sold to"` | Divestiture (8-K only) |

**For 10-12B filings**: Default classification is `spinoff` or `split-off`; never `carve-out` (carve-outs use S-1, not Form 10). Check for "exchange offer" language to distinguish split-off.

**Lightweight approach for Phase 2:** Because fetching full filing text requires additional EDGAR calls per filing, Phase 2 can classify based on form type alone (10-12B → spinoff candidate) and defer text-based sub-classification to Phase 3 (Signal Extraction). Store `deal_type = 'pending_classification'` for 8-K-sourced candidates.

### Pattern 5: Filing Record Mapping to Schema

Map EFTS `_source` fields to the existing `filings` table:

```javascript
// Source: schema.js (Phase 1) + _source field names (verified)
const filing = {
  accession_number: hit._source.adsh,            // e.g. "0001193125-16-760799"
  form_type:        hit._source.form,             // e.g. "10-12B", "10-12B/A"
  cik:              hit._source.ciks?.[0] ?? '',  // SpinCo's CIK
  company_name:     parseDisplayName(hit._source.display_names?.[0]).companyName,
  filed_at:         hit._source.file_date,        // ISO date
  period_of_report: hit._source.period_ending,    // may be null
  primary_doc_url:  buildPrimaryDocUrl(hit._source.adsh, hit._source.ciks?.[0]),
  // raw_text and fetched_at left NULL; Phase 3 fetches full text
};
```

**Building the primary doc URL:**
```javascript
// Source: ARCHITECTURE.md pattern + Pitfall 6 (accession formatting)
import { normalizeCIK, accessionToPath } from '../lib/edgar-utils.js';

function buildPrimaryDocUrl(adsh, cik) {
  const paddedCIK = normalizeCIK(cik);
  const pathAccession = accessionToPath(adsh);
  return `https://www.sec.gov/Archives/edgar/data/${paddedCIK}/${pathAccession}/`;
}
```

### Pattern 6: Opportunity Record for Spinoff Candidates

After inserting a filing, insert an opportunity record linking to it:

```javascript
// Map to opportunities table (existing schema)
const opportunity = {
  filing_id:     insertedFilingId,
  source_type:   'sec_filing',
  company_name:  parsedName.companyName,
  ticker:        parsedName.ticker,
  spinoff_target: null,             // SpinCo details from 10-12B — Phase 3 extracts
  signal_type:   'form_10',         // or '8k_spinoff' for 8-K hits
  signal_strength: 'moderate',      // initial; Phase 3 upgrades based on signals
  summary:       `${form_type} filed by ${companyName} on ${filed_at}`,
  raw_source_url: primary_doc_url,
  status:        'new',             // lifecycle: 'new' = Candidate in DISC-03 terms
};
// INSERT OR IGNORE — UNIQUE(filing_id, signal_type) prevents duplicates
```

**Lifecycle status mapping:**

| DISC-03 State | opportunities.status value |
|---------------|---------------------------|
| Candidate     | `'new'`                   |
| Confirmed     | `'confirmed'`             |
| Withdrawn     | `'withdrawn'`             |

**Note:** The existing schema has `status TEXT DEFAULT 'new'` — the Phase 2 plan must ADD `'confirmed'` and `'withdrawn'` as valid values in code (no schema migration needed, SQLite TEXT allows any value).

### Anti-Patterns to Avoid

- **Fetching full filing text in Phase 2.** EFTS metadata is sufficient for discovery and coarse classification. Fetching `raw_text` during discovery hammers EDGAR with large HTML downloads before they are needed. Leave `raw_text = NULL`; Phase 3 fetches it.
- **Querying EFTS for `forms=10-12B` only.** Must include `10-12B/A` to detect amendment progression. Must include `8-K` (with keyword filter) for early-stage announcements.
- **Using `Promise.all()` over EDGAR calls.** edgarClient already enforces `pLimit(8)` — but callers must not bypass it by constructing raw `fetch()` calls.
- **Date range covering only today.** Filings submitted 5:30–10:00 PM ET receive the next business day's date. Use `startdt = yesterday` and `enddt = today` to catch all filings from the prior 24-hour window.
- **Treating all 10-12B filers as the parent company.** The 10-12B is filed BY the SpinCo (new entity), not the parent. The `ciks` field contains SpinCo's CIK.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EDGAR HTTP with rate limiting | Custom fetch wrapper | `edgarGetJson()` from Phase 1 `edgarClient.js` | Already has pLimit(8), User-Agent, exponential backoff with jitter |
| CIK zero-padding | String manipulation inline | `normalizeCIK()` from `src/lib/edgar-utils.js` | Already handles `padStart(10, '0')`, tested |
| Accession number URL format | Manual dash removal | `accessionToPath()` from `src/lib/edgar-utils.js` | Already handles dash-to-path conversion, tested |
| Filing deduplication | Manual duplicate check | `INSERT OR IGNORE` on `filings.accession_number UNIQUE` | Schema-level uniqueness constraint prevents duplicates across runs |
| Opportunity deduplication | Manual duplicate check | `INSERT OR IGNORE` on `UNIQUE(filing_id, signal_type)` | Schema-level constraint, already in Phase 1 schema |
| Structured logging | `console.log` | `import logger from '../logger.js'` | Pino singleton with log levels, already configured |

**Key insight:** Phase 1 pre-built every infrastructure concern for Phase 2. This phase is primarily query logic and mapping, not infrastructure.

---

## Lifecycle State Tracking (DISC-03 Deep Dive)

### What files mark each state on EDGAR

**Form type `10-12B`** — Initial registration statement. SpinCo registers its securities on an exchange. Filed by the new SpinCo entity using its own CIK. This is the Candidate trigger.

**Form type `10-12B/A`** — Amendment to registration statement. Filed in response to SEC staff comments, or to update financials as the deal progresses. Multiple rounds are common (2-6 amendments over 2-6 months). Each amendment filed = deal still active.

**Form type `EFFECT`** — SEC-published Notice of Effectiveness. The SEC's Division of Corporation Finance posts this to EDGAR under the SpinCo's CIK when the registration is declared effective. This is the Confirmed trigger. The `EFFECT` notice appears in the SpinCo's submissions (`data.sec.gov/submissions/CIK{cik}.json`) as a form type entry in `filings.recent`.

**Form type `RW`** — Registration Withdrawal Request. Filed by the company under the SpinCo's CIK when they abandon the spinoff. This is the primary Withdrawn trigger. Submitted pursuant to Rule 477. Also detectable by monitoring the parent company's 8-K filings for "terminated," "abandoned," or "will not proceed" language about the separation.

### Detection Strategy

For each known Candidate (opportunity with `status = 'new'`):
1. Fetch SpinCo's submissions: `edgarGetJson(submissionsUrl(cik))`
2. Reconstruct filings from columnar arrays (Phase 1 Pitfall 7 pattern)
3. Check for `form === 'EFFECT'` → mark as `Confirmed`
4. Check for `form === 'RW'` → mark as `Withdrawn`

This check should run in the `discover` stage after finding new filings AND as a secondary pass for existing candidates.

### Automatic Effectiveness Timeline

- **10-12B (Section 12(b)):** Automatically effective 30 days after the relevant exchange certifies the securities, or earlier with SEC acceleration.
- **10-12G (Section 12(g)):** Automatically effective 60 days after initial filing.

This timing can serve as a soft confirmation signal when EFFECT notice is not yet posted, but the hard signal is always the EFFECT form type.

### Withdrawn via 8-K (no RW filed)

Some companies announce deal termination via a parent company 8-K without filing an RW. Detection:
- Monitor the parent company's recent 8-K filings for text containing: `"terminated"`, `"abandoned"`, `"will not proceed"`, `"decided not to"` combined with `"separation"` or `"spin-off"`.
- This requires knowing the parent company's CIK — which can be derived from the 10-12B filing's content or cross-referenced from a known company ticker lookup.

**Phase 2 simplification:** A complete 8-K termination detector requires fetching and parsing parent 8-Ks, which is out of scope for Phase 2. Mark as `Withdrawn` only when an `RW` form is detected; flag "no recent amendments in 6+ months" as a separate signal for manual review in Phase 5.

---

## Common Pitfalls

### Pitfall 1: EFTS Returns `_id` Not `accession_number`

**What goes wrong:** Code tries to read `hit.accession_number` or `hit._source.accession_number` and gets `undefined`.

**Why it happens:** The EFTS response structure uses `_id` for the document filename (which has the accession number as a prefix) and `_source.adsh` for the actual dash-separated accession number.

**How to avoid:** Always read `hit._source.adsh` for the accession number. The `_id` field is `"0001193125-16-760799:form10.htm"` — parse out the accession as `_id.split(':')[0]` only as a fallback.

### Pitfall 2: `display_names` Format Is Not Guaranteed Uniform

**What goes wrong:** Regex to extract ticker and CIK from `display_names[0]` fails because some companies have no ticker listed, or have a ticker with lowercase letters, or include punctuation in the company name.

**How to avoid:** Write the parsing function defensively with two regex patterns (with-ticker and without-ticker). Always fall back to `display_names[0]` as the raw company name if neither matches. Never throw on parse failure — log a warning and continue.

**Warning signs:** `company_name` is `null` or empty in the database; `ticker` is never populated despite searching for known spinoffs.

### Pitfall 3: Date Window Misses Late-Evening Filings

**What goes wrong:** Using `startdt = enddt = today` misses filings submitted before 5:30 PM ET yesterday that received yesterday's date, or filings from 5:30–10:00 PM ET yesterday that received today's date.

**How to avoid:** Use `startdt = yesterday` and `enddt = today` always. Accept a small number of duplicates (handled by `INSERT OR IGNORE`). Never use only a single-date window.

### Pitfall 4: 10-12B Filed by SpinCo, Not Parent

**What goes wrong:** Code treats `ciks[0]` as the parent company CIK and tries to look up the parent's submission history.

**Why it happens:** The 10-12B is registered by SpinCo as a new entity. SpinCo is the filer, so `ciks[0]` is SpinCo's CIK. The parent's CIK is not in the EFTS response.

**How to avoid:** Use `ciks[0]` to track the SpinCo for EFFECT/RW monitoring. For Phase 3 parent company identification, the Form 10 text contains parent company name — extract it during signal extraction, not discovery.

### Pitfall 5: Pagination Ignored for High-Volume Days

**What goes wrong:** Code fetches only the first 100 EFTS results. On days with many spinoff-related filings (e.g., after a market event), results are silently truncated.

**How to avoid:** Always check `hits.total.value` and loop with `from` increments if `total > size`. For daily 24-hour windows with 10-12B filings, the count rarely exceeds 100 (there are typically 0-5 new 10-12B filings per day globally), so this is primarily a concern for `8-K` keyword searches which can return more hits.

### Pitfall 6: `filings.recent` Columnar Arrays on Submissions Response

**What goes wrong:** Code iterates `filings.recent` as if it's an array of objects and reads `filing.form`. But `filings.recent` is an object with parallel arrays: `{ form: [...], filingDate: [...], accessionNumber: [...] }`.

**Why it happens:** SEC submissions API design (documented in Phase 1 Pitfall 7). This affects the lifecycle state checker that reads submissions to find EFFECT/RW forms.

**How to avoid:**
```javascript
// Source: Pitfall 7 pattern from PITFALLS.md (Phase 1 research)
const { recent } = submissions.filings;
const forms = recent.form.map((formType, i) => ({
  form:            formType,
  filingDate:      recent.filingDate[i],
  accessionNumber: recent.accessionNumber[i],
}));
const effectRow = forms.find(f => f.form === 'EFFECT');
const rwRow     = forms.find(f => f.form === 'RW');
```

### Pitfall 7: Schema Has No `deal_type` or `lifecycle_status` Column

**What goes wrong:** Phase 2 needs to store deal type (`spinoff`, `split-off`, `carve-out`, `divestiture`) and lifecycle state (`Candidate`, `Confirmed`, `Withdrawn`). These are not explicitly named columns in the Phase 1 schema.

**Mapping strategy:** The existing schema can accommodate both without migration:
- `opportunities.status` stores lifecycle state (`'new'` = Candidate, `'confirmed'` = Confirmed, `'withdrawn'` = Withdrawn)
- `opportunities.signal_type` stores deal type classification (`'form_10'` for unclassified spinoff/split-off, `'8k_spinoff'` for 8-K-sourced candidates, `'carve_out'`, `'divestiture'`)
- `opportunities.signal_strength` stores classification confidence (`'strong'` when pro-rata language confirmed, `'moderate'` for form-type-only classification, `'weak'` for 8-K-only)

No schema migration is needed for Phase 2.

---

## Code Examples

### Full EFTS Query Function

```javascript
// Source: ARCHITECTURE.md EFTS Query URL Pattern + cchummer/sec-api notebook
import { edgarGetJson } from './edgarClient.js';

/**
 * Query EFTS for spinoff-related filings in the past 24 hours.
 * Returns the raw hits array from the EFTS response.
 */
export async function queryEFTSSpinoffs(formTypes = ['10-12B', '10-12B/A'], keywords = null) {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const params = new URLSearchParams({
    forms: formTypes.join(','),
    dateRange: 'custom',
    startdt: yesterday,
    enddt: today,
    from: '0',
    size: '100',
  });

  if (keywords) {
    params.set('q', keywords);
  }

  const url = `https://efts.sec.gov/LATEST/search-index?${params}`;
  const result = await edgarGetJson(url);

  const hits = result?.hits?.hits ?? [];
  const total = result?.hits?.total?.value ?? 0;

  // Paginate if needed (rare for 24-hour 10-12B windows)
  if (total > 100) {
    for (let from = 100; from < total; from += 100) {
      params.set('from', String(from));
      const page = await edgarGetJson(`https://efts.sec.gov/LATEST/search-index?${params}`);
      hits.push(...(page?.hits?.hits ?? []));
    }
  }

  return hits;
}
```

### Lifecycle State Checker

```javascript
// Source: data.sec.gov submissions API + Pitfall 7 pattern from PITFALLS.md
import { edgarGetJson } from './edgarClient.js';
import { submissionsUrl } from '../lib/edgar-utils.js';

/**
 * Check SpinCo's submission history for EFFECT or RW form types.
 * Returns 'confirmed', 'withdrawn', or 'candidate'.
 */
export async function checkLifecycleState(cik) {
  const submissions = await edgarGetJson(submissionsUrl(cik));
  const { recent } = submissions?.filings ?? {};
  if (!recent?.form) return 'candidate';

  const forms = recent.form.map((formType, i) => ({
    form: formType,
    filingDate: recent.filingDate[i],
  }));

  if (forms.some(f => f.form === 'RW')) return 'withdrawn';
  if (forms.some(f => f.form === 'EFFECT')) return 'confirmed';
  return 'candidate';
}
```

### INSERT OR IGNORE Pattern for Filings

```javascript
// Source: ARCHITECTURE.md deduplication strategy + schema.js (Phase 1)
import db from '../db/db.js';

const insertFiling = db.prepare(`
  INSERT OR IGNORE INTO filings
    (accession_number, form_type, cik, company_name, filed_at, period_of_report, primary_doc_url)
  VALUES
    (@accession_number, @form_type, @cik, @company_name, @filed_at, @period_of_report, @primary_doc_url)
`);

const insertOpportunity = db.prepare(`
  INSERT OR IGNORE INTO opportunities
    (filing_id, source_type, company_name, ticker, signal_type, signal_strength, summary, raw_source_url, status)
  VALUES
    (@filing_id, @source_type, @company_name, @ticker, @signal_type, @signal_strength, @summary, @raw_source_url, @status)
`);

// Use transaction for atomicity
const insertFilingWithOpportunity = db.transaction((filingData, opportunityData) => {
  const { lastInsertRowid } = insertFiling.run(filingData);
  // If filing was already in DB, get its ID
  const filingId = lastInsertRowid ||
    db.prepare('SELECT id FROM filings WHERE accession_number = ?')
      .get(filingData.accession_number)?.id;
  if (filingId) {
    insertOpportunity.run({ ...opportunityData, filing_id: filingId });
  }
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EDGAR RSS feeds for form type monitoring | EFTS full-text search | Available since ~2001; RSS is still current but less capable | EFTS allows keyword filtering; RSS is metadata-only |
| Manual download of full filing ZIP | Primary document URL via accession path | N/A | Phase 2 only needs EFTS metadata; full text deferred to Phase 3 |
| Polling at fixed intervals | Daily batch with 24-hour window | N/A for this project | node-cron handles scheduling; EFTS date filtering handles deduplication |

**Current as of March 2026:**
- EFTS endpoint: `efts.sec.gov/LATEST/search-index` — active and current
- `data.sec.gov/submissions/CIK{cik}.json` — active; updated in real time
- Form types `EFFECT` and `RW` — current EDGAR submission types for effectiveness/withdrawal

---

## Open Questions

1. **`file_num` field reliability for grouping related filings**
   - What we know: `file_num` in EFTS `_source` links related filings (initial 10-12B + amendments + EFFECT notice all share the same SEC file number, e.g., `"001-36426"`).
   - What's unclear: Whether `file_num` is always present and populated in EFTS results, or only for some form types.
   - Recommendation: Use `file_num` as a supplementary grouping key but do not depend on it exclusively. CIK-based lookup of submissions is the reliable fallback.

2. **8-K spinoff signal quality in practice**
   - What we know: 8-Ks containing spinoff keyword hits have high noise (rumors, historical references, metaphorical uses).
   - What's unclear: The exact false positive rate on Phase 2's specific query (`"spin-off" OR "pro rata distribution"`).
   - Recommendation: Phase 2 should store 8-K candidates with `signal_strength = 'weak'` and `status = 'new'`, explicitly labeled as requiring Phase 3 validation. Cross-reference against known spinoff calendars (InsideArbitrage, StockSpinoffs.com) after first production run.

3. **Submissions pagination for companies with long filing history**
   - What we know: `data.sec.gov/submissions/CIK{cik}.json` returns up to ~1000 most recent filings, with older ones in supplementary `files` array.
   - What's unclear: For the lifecycle state check, EFFECT and RW filings would be recent — so pagination is likely not needed for Phase 2.
   - Recommendation: For Phase 2, check only `filings.recent` in the submissions response. Add pagination in a future phase if needed.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 is code-only changes. All dependencies (EDGAR APIs, Node.js, better-sqlite3) were validated in Phase 1. No new external tools required.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | None — test command is `node --test "src/__tests__/*.test.js"` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-01 | EFTS query returns array of filing objects with required fields | unit | `npm test` | ❌ Wave 0 — `src/__tests__/discover.test.js` |
| DISC-01 | Filings are inserted into DB with `INSERT OR IGNORE` | unit | `npm test` | ❌ Wave 0 |
| DISC-01 | Re-running discover does not insert duplicate filings | unit | `npm test` | ❌ Wave 0 |
| DISC-02 | 10-12B hits are classified as `signal_type='form_10'` | unit | `npm test` | ❌ Wave 0 |
| DISC-02 | 8-K hits with spinoff keywords are classified as `signal_type='8k_spinoff'` | unit | `npm test` | ❌ Wave 0 |
| DISC-03 | Submissions with `form='EFFECT'` return `'confirmed'` lifecycle state | unit | `npm test` | ❌ Wave 0 |
| DISC-03 | Submissions with `form='RW'` return `'withdrawn'` lifecycle state | unit | `npm test` | ❌ Wave 0 |
| DISC-03 | New 10-12B filing inserts opportunity with `status='new'` | unit | `npm test` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/discover.test.js` — covers DISC-01, DISC-02, DISC-03
- [ ] `src/__tests__/edgarIngester.test.js` — covers EFTS query module unit tests (mock fetch)

Existing test infrastructure (`node:test`, in-memory DB pattern, `?v=N` ESM cache busters for mocking) is established and confirmed working from Phase 1. Wave 0 only needs test files, not framework setup.

---

## Sources

### Primary (HIGH confidence)

- `cchummer/sec-api` GitHub notebook `fulltext_search_endpoint.ipynb` — verified EFTS `_source` field names: `adsh`, `root_form`, `form`, `file_num`, `display_names`, `ciks`, `file_date`, `period_ending`, `biz_locations`. Pagination: `from` parameter, 100 results per page.
- `sec-api.io/list-of-sec-filing-types` — confirmed `EFFECT` = SEC notice of registration effectiveness; `RW` = Registration Withdrawal Request; `10-12B` = general form for Section 12(b) registration
- Phase 1 `ARCHITECTURE.md` — EFTS URL structure, `_source` field names in query URLs, rate limit strategy
- Phase 1 `PITFALLS.md` — Columnar arrays in submissions API (Pitfall 7), Form 10-12B lifecycle (Pitfall 11), rate limits (Pitfall 1)
- Phase 1 `src/ingestion/edgarClient.js` — confirmed exports: `edgarGet`, `edgarGetJson`, `edgarGetText`
- Phase 1 `src/lib/edgar-utils.js` — confirmed exports: `normalizeCIK`, `accessionToPath`, `submissionsUrl`, `filingIndexUrl`
- Phase 1 `src/db/schema.js` — confirmed table columns for mapping

### Secondary (MEDIUM confidence)

- WebSearch result: "Form 10-12B Section 12(b) automatically effective 30 days after exchange certification" — verified against PITFALLS.md Pitfall 11 and PwC SEC 3110 guide
- WebSearch result: "EFFECT filing posted to EDGAR morning after effectiveness" — corroborated by sec-api.io form type list

### Tertiary (LOW confidence)

- `file_num` grouping reliability — inferred from EFTS `_source` structure; not empirically verified in live queries
- 8-K false positive rate for spinoff keyword searches — not measured; inherently unknown until first production run

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all Phase 1 libraries, no new deps
- EFTS query structure: HIGH — verified from cchummer/sec-api notebook with actual _source field names
- Lifecycle state transitions (EFFECT/RW): HIGH — confirmed by sec-api.io form type definitions and SEC withdrawal documentation
- Deal type classification: MEDIUM — text keyword strategy is well-known; exact phrase coverage requires empirical validation
- 8-K spinoff recall rate: LOW — known unknown; needs validation against real data

**Research date:** 2026-03-28
**Valid until:** 2026-06-28 (EDGAR API structure is stable; 90-day validity is conservative)
