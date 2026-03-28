# Domain Pitfalls

**Domain:** SEC EDGAR financial data pipeline — spinoff screener
**Researched:** 2026-03-28
**Overall confidence:** HIGH (SEC official sources + practitioner sources + verified patterns)

---

## Critical Pitfalls

Mistakes that cause silent data corruption, missed signals, or require pipeline rewrites.

---

### Pitfall 1: Exceeding the SEC EDGAR Rate Limit and Getting IP-Banned

**What goes wrong:** Your Node.js scraper fires concurrent requests and crosses 10 requests/second. The SEC blocks your IP for a "brief period" (commonly 10 minutes). If your daily job runs at a fixed time, this can make the entire run silent-fail until the block lifts.

**Why it happens:** `Promise.all()` over an array of CIKs, or multiple modules hitting EDGAR simultaneously without a shared throttle. The limit is aggregate across all machines on the same IP.

**Consequences:** Partial data ingestion with no error thrown; silent gaps in daily refresh.

**Prevention:**
- Implement a global rate limiter (e.g., `p-limit` or `bottleneck` npm packages) capped at **8 req/s** (leave 20% headroom below the 10 req/s ceiling).
- Add jitter: `delay = baseDelay + Math.random() * 200` to avoid burst patterns.
- Set `User-Agent` to `"YourAppName your@email.com"` on every request. The SEC requires this for automated access and uses it to identify violators before blocking.
- Never use the same IP across parallel workers without a shared rate limiter.

**Detection:** HTTP 403 or connection reset after a burst; subsequent requests returning empty bodies.

**Sources:** [SEC Rate Control Limits announcement](https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits), [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)

---

### Pitfall 2: Missing the User-Agent Header — Silent Blocks or Classification as Unidentified Bot

**What goes wrong:** Requests without a proper `User-Agent` header are classified as unidentified bots. The SEC's stated policy is that unclassified bots are not allowed. Your IP may be rate-limited more aggressively or blocked preemptively.

**Why it happens:** Default `fetch` or `axios` sends a generic user agent or none at all.

**Consequences:** Intermittent 403 responses; harder to diagnose because it looks identical to a rate limit block.

**Prevention:**
```javascript
// Set this on EVERY request to EDGAR
headers: {
  'User-Agent': 'SpinoffScreener yourname@example.com',
  'Accept-Encoding': 'gzip, deflate',
  'Host': 'data.sec.gov'
}
```

**Detection:** Consistent 403s even at low request rates; works fine when tested from a browser.

**Sources:** [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data), [GreenFlux EDGAR integration guide](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/)

---

### Pitfall 3: Misreading Form 4 Transaction Codes — Treating Grants and Tax Withholding as Buying/Selling Signals

**What goes wrong:** You read `acquiredDisposedCode: "D"` and flag it as insider selling. But code `F` (tax withholding) also sets `acquiredDisposedCode` to `D` and accounts for the largest volume of Form 4 "dispositions." Code `A` (grant/award) appears as an acquisition but is mandatory compensation, not discretionary buying.

**Why it happens:** Developers treat `acquiredDisposedCode` as the only field needed, ignoring `transactionCode`.

**The full picture — transaction codes and what they actually mean:**

| Code | Meaning | Signal Value |
|------|---------|--------------|
| **P** | Open market purchase | HIGH — genuine discretionary buy |
| **S** | Open market sale | MEDIUM — could be diversification |
| **A** | Grant, award, or acquisition (Rule 16b-3(d)) | NONE — mandatory compensation |
| **F** | Tax withholding / payment of exercise price | NONE — automatic, mechanical |
| **M** | Exercise or conversion of derivative (Rule 16b-3) | LOW — precedes P or S; watch what follows |
| **X** | Exercise of in-the-money derivative | LOW without context |
| **O** | Exercise of out-of-the-money derivative | NONE practically |
| **D** | Disposition back to issuer (Rule 16b-3(e)) | NONE — forced/programmatic |
| **G** | Bona fide gift | NONE |
| **J** | Other (described in footnotes) | INVESTIGATE — catch-all, draws SEC scrutiny |
| **W** | Acquisition/disposition by will or descent | NONE |
| **Z** | Deposit/withdrawal from voting trust | NONE |
| **C** | Conversion of derivative | NONE standalone |
| **K** | Equity swap | NONE standalone — modifier code |
| **U** | Tender in change-of-control | NONE |
| **L** | Small acquisition | NONE |
| **I** | Discretionary transaction Rule 16b-3(f) | LOW |

**Consequences:** False "insider buying" or "insider selling" alerts that undermine user trust and analytical quality.

**Prevention:**
- Filter to only `transactionCode IN ('P', 'S')` for meaningful directional signals.
- For spinoff-era insider activity specifically, watch for code `J` with footnotes describing "receipt of SpinCo shares" — that is the typical code used when an insider receives shares via spinoff distribution.
- Cross-check `acquiredDisposedCode` (`A`/`D`) against `transactionCode` — a `D` with code `F` is tax withholding, not a sale.

**Detection:** Insider appears to be selling every month at vest date with round-number share counts → almost certainly code F withholding.

**Sources:** [SECDatabase transaction code definitions](https://secdatabase.com/Articles/tabid/42/ArticleID/10/Form-4-Transaction-Code-Definitions.aspx), [2IQ Research Form 4 guide](https://www.2iqresearch.com/blog/what-is-sec-form-4-and-how-do-you-read-form-4-filings-2022-03-11), [TheCorporateCounsel.net on code J scrutiny](https://www.thecorporatecounsel.net/blog/2024/08/insider-trading-watch-your-form-4-transaction-codes.html)

---

### Pitfall 4: Confusing Spinoff Filing Types — Monitoring the Wrong Forms

**What goes wrong:** You watch for `8-K` filings only and miss most spinoffs entirely. Or you watch for `Form 10` and get confused by unrelated '34 Act registrations. Or you filter for keyword "spin-off" in 8-Ks and catch nothing because many use "separation" or "distribution."

**The spinoff filing lifecycle — what actually gets filed and when:**

| Stage | Form Type | What It Is | When Filed |
|-------|-----------|-----------|-----------|
| Announce intention | 8-K (Item 1.01 or 8.01) | Material agreement or voluntary disclosure | At announcement |
| Register SpinCo | **10-12B** (or 10-12G) | Primary spinoff registration under '34 Act | Weeks to months before distribution |
| Amend registration | 10-12B/A | Response to SEC comments | Multiple rounds before effectiveness |
| Distribution | 8-K (Item 8.01) | Announces record/distribution date | Around effectiveness |
| SpinCo quarterly | 10-Q, 10-K | Post-spinoff reporting | Ongoing |

**A true spinoff files a `10-12B` or `10-12G`. This is the canonical signal.** An `8-K` alone is ambiguous and may describe many non-spinoff events.

**Consequences:** Missing early-stage spinoffs (filed Form 10 months before completion), or triggering on 8-Ks that announce cancelled, renegotiated, or alternative transactions.

**Prevention:**
- Monitor form type `10-12B` and `10-12G` as the primary spinoff signal — these are exclusively used for spinoff registrations.
- Monitor `10-12B/A` to track amendment progress (indicates deal is still alive and advancing).
- Use EDGAR full-text search (EFTS) with the query `q="spin-off" OR "spinoff" OR "separation"&forms=10-12B` as a secondary filter.
- Supplement with `8-K` filtering but treat 8-K hits as unconfirmed candidates, not confirmed spinoffs.

**Sources:** [Wachtell Lipton 2020 Spin-Off Guide](https://www.wlrk.com/wp-content/uploads/2020/05/Spin-Off-Guide-2020.pdf), [Harvard Law Spin-offs Unraveled](https://corpgov.law.harvard.edu/2019/10/31/spin-offs-unraveled/), [Pluris Form 10-12B guide](https://pluris.com/registration-statements-form-10-12b-basic-guide/)

---

### Pitfall 5: Treating All "Separation" Events as Spinoffs — False Positives from Related Corporate Actions

**What goes wrong:** Your classifier flags a filing as a spinoff when it is actually a different type of corporate separation. These differ fundamentally in investment implications.

**The taxonomy you must implement:**

| Event Type | Mechanism | SEC Filing | Investment Implication |
|------------|-----------|-----------|----------------------|
| **Spinoff (pro-rata)** | Parent distributes SpinCo shares to ALL existing shareholders; no exchange | 10-12B | Both parent and SpinCo trade independently; classic Joel Greenblatt opportunity |
| **Split-off** | Shareholders choose to exchange parent shares FOR SpinCo shares | 10-12B + tender offer materials | Creates arbitrage dynamic; typically undervalued SpinCo |
| **Equity carve-out** | SpinCo sells shares to the PUBLIC via IPO | S-1 | Parent retains majority; SpinCo has IPO dynamics, not spinoff dynamics |
| **Divestiture / asset sale** | Subsidiary sold to third party for cash | 8-K Item 1.01 | Parent receives cash; no new public entity for investors |
| **Split-up** | Parent dissolves into two or more companies entirely | 10-12B (multiple) | Rare; entire parent disappears |
| **Tracking stock** | Parent creates new class of shares tracking a division | Proxy + 8-K | No legal separation; different risk/reward |

**Key distinguishing test:** Is there a new company filing its OWN registration statement (10-12B) as a separate CIK? If yes, that is a spinoff or split-off. If the parent's S-1 references a subsidiary IPO, that is a carve-out.

**Consequences:** Treating a carve-out as a spinoff changes the entire investment thesis. Treating a divestiture as a spinoff produces false positives with no actionable opportunity.

**Prevention:**
- Parse the 10-12B filer's CIK — it should be a NEW entity, not the parent's CIK.
- Check whether the information statement describes a "pro rata distribution" (spinoff) vs. "exchange offer" (split-off) vs. "initial public offering" (carve-out).
- Look for the phrase "Distribution Ratio" — spinoffs always state how many SpinCo shares per parent share.

**Sources:** [PwC Carve-out guide](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/carve-out-financial-statements/carve-out-financial-statements/Chapter-1-Introduction-to-carve-out-financial-statements/13-Common-exit-strategies.html), [AnalystPrep corporate restructuring](https://analystprep.com/study-notes/cfa-level-2/corporate-restructuring/), [Diffzy Spin-Off vs Split-Off vs Carve-Out](https://www.diffzy.com/article/difference-between-spin-off-split-off-split-up-and-carve-out-452)

---

## Moderate Pitfalls

---

### Pitfall 6: CIK Zero-Padding and Accession Number Formatting Errors

**What goes wrong:** API calls to `data.sec.gov/submissions/CIK{cik}.json` fail silently or return 404 because the CIK is not zero-padded to 10 digits. The `company-tickers.json` endpoint returns raw integers without padding.

**Prevention:**
```javascript
// Always normalize CIK before any API call
const normalizedCIK = String(cik).padStart(10, '0');
const url = `https://data.sec.gov/submissions/CIK${normalizedCIK}.json`;

// Accession numbers: strip dashes for filing URLs, keep dashes for display
const rawAccession = '0001234567-24-000001';
const urlAccession = rawAccession.replace(/-/g, ''); // '0001234567240000001'
const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${urlAccession}/`;
```

**Sources:** [GreenFlux SEC API integration](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/), [Full Stack Accountant EDGAR intro](https://www.thefullstackaccountant.com/blog/intro-to-edgar)

---

### Pitfall 7: Submissions API Returns Columnar Arrays, Not Row Objects

**What goes wrong:** The `filings.recent` section of the submissions endpoint returns each field as a parallel array (one array for dates, one for form types, one for accession numbers). Code that treats it as an array of filing objects will fail immediately.

**Prevention:**
```javascript
const { recent } = submissions.filings;
// Reconstruct row objects from columnar arrays
const filings = recent.form.map((formType, i) => ({
  form: formType,
  filingDate: recent.filingDate[i],
  accessionNumber: recent.accessionNumber[i],
  primaryDocument: recent.primaryDocument[i],
}));
```

For companies with more than ~40 recent filings, the API also returns a `files` array listing additional JSON pages to fetch. Ignoring this means missing older filings.

**Sources:** [GreenFlux SEC API integration](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/), [SEC EDGAR APIs documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

---

### Pitfall 8: EDGAR Does Not Have CORS Headers — Cannot Call Directly From a Browser

**What goes wrong:** If any part of the stack tries to call `data.sec.gov` or `efts.sec.gov` from a browser (e.g., a React frontend), the request will be blocked by the browser's CORS policy. The SEC does not add `Access-Control-Allow-Origin` headers.

**Prevention:** All EDGAR requests must be server-side. In a Node.js backend this is a non-issue, but never proxy API calls through a frontend build or serverless edge function that runs client-side.

**Sources:** [GreenFlux SEC API integration](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/)

---

### Pitfall 9: EDGAR Filing Timing — The 5:30 PM ET Cutoff

**What goes wrong:** You run your daily scraper at 6:00 PM ET assuming same-day filings are complete, but filings submitted between 5:30 PM and 10:00 PM receive the NEXT business day's date. You may miss same-day alerts or double-count filings that appear to shift dates.

**Key timing facts:**
- EDGAR accepts filings 6:00 AM to 10:00 PM ET on business days (no federal holidays).
- Filings submitted before **5:30 PM ET** → receive today's filing date.
- Filings submitted 5:30 PM–10:00 PM ET → receive the NEXT business day's filing date (exception: Form 4/Forms 3, 4, 5 are exempt from this cutoff and can receive same-day date up to 10 PM).
- `data.sec.gov` JSON structures update in real-time as filings are disseminated; the bulk ZIP at `https://data.sec.gov/submissions/` updates nightly at ~3:00 AM ET.

**Prevention:**
- Run the daily refresh no earlier than **6:00 AM ET** to capture the prior day's late-evening filings.
- For time-sensitive Form 4 monitoring, a second pass at ~11:00 PM ET will catch same-day late filings that do receive same-day date.
- Use the filing's `filingDate` field from the API, not the submission `receivedAt` timestamp — they may differ.

**Sources:** [EDGAR Hours of Operation](https://www.securexfilings.com/edgar-hours-operation/), [M2Compliance EDGAR filing deadlines](https://www.m2compliance.com/edgar-hours.php)

---

### Pitfall 10: XBRL and Inline XBRL (iXBRL) Parsing Is Fragile

**What goes wrong:** Raw XBRL data uses non-standard company-specific tag names (e.g., `ConsolidatedStatementsofOperations` vs. `ConsolidatedStatementsOfLossIncome`). The SEC permits inline XBRL embedded directly in HTML, so the same financial data may live in a separate `.xml` file OR inside the main `.htm` filing. Code that only checks one location misses data silently.

**Known fragile areas:**
- **Tag name inconsistency:** Companies use their own XBRL element names; no two companies name their revenue line identically.
- **Only ~30% of content extractable via regex** — the rest requires full DOM parsing.
- **XBRL accounts for ~33% of filing file size** — but for spinoff screening, you rarely need XBRL. The textual content (information statement) matters more.
- **iXBRL embeds structured data inside HTML** — a parser expecting clean XML will fail on iXBRL documents.
- **Amended filings (e.g., 10-12B/A)** overwrite prior XBRL data; Company Facts API stores only the latest value for a given period.

**Prevention:**
- For spinoff screening, avoid parsing XBRL entirely at the initial detection stage. Parse the text/HTML of the information statement instead.
- When XBRL financials are needed (e.g., to assess SpinCo size), use the `data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` endpoint which pre-normalizes XBRL into JSON.
- Use `fast-xml-parser` for XML; use `cheerio` for HTML/iXBRL.

**Sources:** [SEC EDGAR Application APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [XBRL parsing extraction challenges](https://sec-api.io/resources/extract-financial-statements-from-sec-filings-and-xbrl-data-with-python)

---

### Pitfall 11: Form 10 (Spinoff) Has a Multi-Month Amendment Cycle Before It's "Real"

**What goes wrong:** You detect the initial `10-12B` filing and trigger analysis immediately. But a freshly-filed Form 10 is often a skeleton — key financials, the distribution ratio, and the separation agreement are marked "to be filed by amendment." The deal may also be withdrawn entirely after SEC comment. Triggering on the initial filing produces premature or wrong alerts.

**The lifecycle:**
1. Initial `10-12B` filed — often missing key exhibits, financial statements, and distribution terms.
2. Multiple `10-12B/A` amendments filed in response to SEC staff comment letters (typically 2–6 months).
3. Final amendment declares the registration "effective" — THIS is when the spinoff is legally confirmed.
4. Distribution date 8-K filed announcing the actual record/payable date.

**Prevention:**
- Track all `10-12B/A` amendments per CIK to monitor deal progression.
- Flag initial `10-12B` filings as "spinoff candidate — pending" rather than confirmed spinoffs.
- Only promote to "confirmed" when the registration becomes effective (SEC declares it effective, or the company files a completion 8-K).
- Watch for withdrawal: if no `10-12B/A` amendments appear for 6+ months and no effectiveness notice, the deal may have died.

**Sources:** [Wachtell Lipton Spin-Off Guide 2020](https://www.wlrk.com/wp-content/uploads/2020/05/Spin-Off-Guide-2020.pdf), [Pluris Form 10-12B Basic Guide](https://pluris.com/registration-statements-form-10-12b-basic-guide/)

---

### Pitfall 12: Claude API Costs Explode Without Batching and Prompt Caching

**What goes wrong:** Each EDGAR filing is sent to Claude in its own synchronous request with a full system prompt repeated each time. For a daily batch of 20–50 new filings, this means paying full input price for a repeated 2,000-token system prompt 50 times per run.

**Prevention:**
- Use the **Batch API** (async, up to 24-hour delivery): flat 50% cost reduction on all models. Ideal for daily refresh — submit jobs at night, retrieve results in the morning.
- Use **prompt caching** for the system prompt + context (analysis rubric, spinoff criteria). Cache write is 1.25x base price for 5-minute TTL; cache read is **0.1x base price** (90% savings). Pays off after a single cache read.
- Combine both: Batch API + prompt caching can reduce per-filing costs by up to **95%** vs. naive synchronous calls.
- Set explicit `max_tokens` caps per request type: classification tasks need ~50 tokens, summaries need ~500 tokens. Uncapped requests can run to 4,096 tokens unnecessarily.
- Pre-filter filings with a lightweight heuristic (keyword match, form type check) BEFORE sending to Claude. Only send true candidates to the LLM.

**Cost estimation baseline (as of early 2026):**
- Claude Sonnet: ~$3/M input tokens, ~$15/M output tokens (standard)
- With Batch + cache read: effectively ~$0.15–$0.30/M input tokens on repeated system prompt

**Sources:** [Claude Batch API pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Claude prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Batch processing cost reduction patterns](https://medium.com/@asimsultan2/how-to-use-claude-opus-4-efficiently-cut-costs-by-90-with-prompt-caching-batch-processing-f06708ae7467)

---

## Minor Pitfalls

---

### Pitfall 13: News API Signal-to-Noise — "Spinoff" Appears in Unrelated Financial News

**What goes wrong:** Keyword searches for "spinoff" in financial news APIs return articles about: speculative rumors, deals that were proposed but cancelled, historical references in earnings calls, opinion pieces referencing past spinoffs of other companies, and "spinoff" used metaphorically (e.g., "this product is a spinoff of their original idea").

**Prevention:**
- Require at least ONE of: `["spin-off", "spinoff", "separation", "distribution to shareholders"]` AND the company name in the same article.
- Treat news as a supplementary signal to cross-reference against EDGAR filings, never as a primary source.
- Implement a second-pass filter: article must include SEC/regulatory language ("Form 10", "registration statement", "record date", "distribution ratio") to be marked as actionable.
- Rate financial news sources by historical false-positive rate: wires (Reuters, AP, Dow Jones) have much lower noise than aggregators.

---

### Pitfall 14: Idempotency — Duplicate Processing on Pipeline Restart

**What goes wrong:** Daily refresh job fails mid-run (network error, rate limit block). On restart it re-processes filings already stored, producing duplicate records, duplicate Claude API charges, and duplicate alerts.

**Prevention:**
- Track processed accession numbers in a `processed_filings` table/set.
- Use partition-overwrite pattern for date-scoped data: re-running for the same date replaces data rather than appending.
- Each Claude Batch job ID should be stored; on startup, check if batch result is already retrieved before submitting a new batch.

**Sources:** [Airbyte idempotency in data pipelines](https://airbyte.com/data-engineering-resources/idempotency-in-data-pipelines)

---

### Pitfall 15: Retry Logic Without Jitter Causes "Thundering Herd" Back at EDGAR

**What goes wrong:** Multiple concurrent tasks all fail at the same time (e.g., brief EDGAR outage), retry with the same fixed delay, and hit the endpoint simultaneously again — causing the same failure.

**Recommended pattern:**
```javascript
async function fetchWithRetry(url, options, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status === 503) {
        throw new Error(`Rate limited: ${response.status}`);
      }
      return response;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      // Exponential backoff with full jitter
      const base = Math.min(1000 * 2 ** attempt, 30000);
      const delay = Math.random() * base;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

Retry only on: 429 (rate limit), 503 (service unavailable), 504 (timeout), network errors. Do NOT retry on: 404, 403 (likely permanent), 400.

**Sources:** [Node.js exponential backoff patterns](https://medium.com/@mnnasik7/building-resilient-node-js-services-with-exponential-backoff-5334fa5a3f7e)

---

### Pitfall 16: Form 4 XML Is Served in a Filing Index — You Must Fetch the Index First

**What goes wrong:** You try to construct the URL to the raw Form 4 XML directly. But Form 4 filings are stored with the XML inside a filing package. The document filename is not standardized — it may be `form4.xml`, `wk-form4_TIMESTAMP.xml`, or anything the filer chose.

**Prevention:**
- Fetch the filing index page first: `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/`
- Parse the index JSON (`index.json`) to find the file with type `4` or `4/A`.
- Only then fetch the actual XML document.
- Parse with `fast-xml-parser` — do not use regex on XML.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| EDGAR ingestion setup | Missing User-Agent → silent blocks | Set global request defaults before any other work |
| Spinoff detection logic | 10-12B initial filing is incomplete skeleton | Implement "candidate" vs "confirmed" states |
| Form 4 insider tracking | Code F/A misread as buy/sell signal | Whitelist only codes P, S; flag J for review |
| Spinoff classification | Carve-out or split-off misclassified | Parse for "pro rata distribution" language explicitly |
| Claude integration | Unbounded token costs on daily batch | Implement Batch API + prompt caching from day one |
| Daily refresh scheduler | Late-filing timing gap | Schedule after 6 AM ET, not midnight |
| Data deduplication | Re-processing on restart | Accession number idempotency table from day one |
| Error handling | Fixed-interval retries cause secondary rate limit | Exponential backoff with jitter on all HTTP calls |
| XBRL parsing | iXBRL embedded in HTML breaks XML-only parsers | Use cheerio for HTML; use `data.sec.gov/companyfacts` for XBRL numerics |

---

## Sources

- [SEC EDGAR Rate Control Limits](https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits)
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC Developer Resources / EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC EDGAR Ownership XML Technical Specification v3](https://www.sec.gov/info/edgar/ownershipxmltechspec-v3.pdf)
- [SECDatabase Form 4 Transaction Code Definitions](https://secdatabase.com/Articles/tabid/42/ArticleID/10/Form-4-Transaction-Code-Definitions.aspx)
- [2IQ Research: How to Read Form 4 Filings](https://www.2iqresearch.com/blog/what-is-sec-form-4-and-how-do-you-read-form-4-filings-2022-03-11)
- [TheCorporateCounsel.net: Watch Your Form 4 Transaction Codes](https://www.thecorporatecounsel.net/blog/2024/08/insider-trading-watch-your-form-4-transaction-codes.html)
- [Wachtell Lipton 2020 Spin-Off Guide](https://www.wlrk.com/wp-content/uploads/2020/05/Spin-Off-Guide-2020.pdf)
- [Harvard Law: Spin-offs Unraveled](https://corpgov.law.harvard.edu/2019/10/31/spin-offs-unraveled/)
- [PwC Carve-out Financial Statements Guide](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/carve-out-financial-statements/carve-out-financial-statements/Chapter-1-Introduction-to-carve-out-financial-statements/13-Common-exit-strategies.html)
- [GreenFlux: So You Want to Integrate with the SEC API](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/)
- [Claude API Pricing & Batch API](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude Prompt Caching Documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Airbyte: Idempotency in Data Pipelines](https://airbyte.com/data-engineering-resources/idempotency-in-data-pipelines)
- [Node.js Exponential Backoff Patterns](https://medium.com/@mnnasik7/building-resilient-node-js-services-with-exponential-backoff-5334fa5a3f7e)
- [EDGAR Hours of Operation](https://www.securexfilings.com/edgar-hours-operation/)
- [M2Compliance EDGAR Filing Deadlines](https://www.m2compliance.com/edgar-hours.php)
