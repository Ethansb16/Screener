# Phase 3: Signal Extraction - Research

**Researched:** 2026-03-29
**Domain:** EDGAR Form 10 document fetching, HTML text extraction, regex-based signal detection, SQLite schema extension
**Confidence:** MEDIUM (HTML structure is empirically unverifiable without live EDGAR access from this environment; patterns drawn from community parsing projects and SEC filing structure research)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SIG-01 | Extract reason classification (strategic focus vs. disposal of weak unit) from "Reasons for the Distribution" section | Section location strategy, keyword sets for both classifications |
| SIG-02 | Detect whether SpinCo management is receiving equity grants in the new entity | "Executive Compensation" / "Security Ownership" section keywords; equity grant phrase patterns |
| SIG-03 | Check capitalization section for excessive debt loaded onto SpinCo | "Capitalization" section location; debt ratio and language patterns |
| SIG-04 | Identify whether strong leaders are moving to SpinCo or remaining at parent | "Management" / "Directors and Officers" section; biographical movement keywords |
</phase_requirements>

---

## Summary

Phase 3 replaces the `runExtract` stub with a real pipeline stage that fetches each Form 10 document, locates four named sections, extracts bounded text, applies keyword/pattern classification, and persists structured signals. It is the highest-risk phase because Form 10 HTML is not standardized — the same logical section can appear under different heading capitalizations, different HTML tags, or be absent entirely.

The critical structural finding is that a Form 10-12B filing (the EDGAR submission) frequently does not contain the full narrative inline. Instead the main document is a short wrapper that incorporates by reference an Information Statement filed as **Exhibit 99.1**. The real content — "Reasons for the Distribution", "Executive Compensation", "Capitalization", "Security Ownership" — lives in Exhibit 99.1. The extraction implementation must therefore resolve the correct exhibit URL from the filing index before attempting to parse sections.

Signal extraction should produce structured rows in a new `signals` table (not overwrite columns in `opportunities`). This keeps the schema normalized and lets Phase 4 (Claude AI analysis) query all signals for a filing in one query. Each of the four signals should be a separate row with a `signal_name`, `classification`, `confidence`, and a `raw_excerpt` for Phase 4 to include in its prompt.

**Primary recommendation:** Fetch the filing index JSON to resolve Exhibit 99.1 (or the primary HTML document when no exhibit separation exists), strip HTML to plain text, locate each target section with a multi-strategy heading matcher (heading-tag first, then bold-paragraph fallback, then full-text search fallback), extract bounded text (~5 KB per section), and classify with keyword sets. Store four `signals` rows per filing. Fail gracefully (store `classification: 'unknown'`) when a section is not found.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-html-parser | 1.2.0 (latest) | Parse Form 10 HTML into DOM for CSS selector queries | Fastest pure-JS parser, no native deps, no browser required; lighter than cheerio |
| better-sqlite3 | 12.8.0 (installed) | Store extracted signals | Already in project |
| p-limit | 7.3.0 (installed) | Rate-limit EDGAR document fetches | Already used in edgarClient.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js built-in `node:test` | — | Unit tests for signal classifiers | Already established pattern in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-html-parser | cheerio | Cheerio has jQuery API but is 6x slower and adds ~1 MB; node-html-parser is sufficient for text extraction |
| node-html-parser | regex on raw HTML | Regex on raw HTML is brittle; node-html-parser gives structured traversal with `.text` for clean text |
| Separate `signals` table | Extra columns on `opportunities` | Extra columns pollute opportunities and make it impossible to store partial results or vary per signal |

**Installation:**
```bash
npm install node-html-parser
```

**Version verification:**
```bash
npm view node-html-parser version
# Returns: 1.2.0 (verified 2026-03-29)
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── ingestion/
│   ├── edgarClient.js          # (existing) use edgarGetText for all fetches
│   ├── edgarIngester.js        # (existing)
│   ├── classifyDeal.js         # (existing)
│   ├── lifecycleChecker.js     # (existing)
│   ├── form10Fetcher.js        # NEW: resolve + fetch exhibit HTML
│   └── signalExtractor.js      # NEW: section location + classification logic
├── pipeline/stages/
│   └── extract.js              # Replace stub with real implementation
├── db/
│   └── schema.js               # Add signals table
└── __tests__/
    └── extract.test.js         # NEW: signal extraction tests
```

### Pattern 1: Filing Index Resolution

**What:** Before parsing a Form 10, resolve which HTML document contains the narrative. The EDGAR filing index at `{accession_path}-index.json` returns a `directory.item[]` array listing all files in the submission. Find the Exhibit 99.1 entry (type `EX-99.1`) and use that URL; fall back to the first document of type `10-12B` if no exhibit is found.

**URL format for filing index JSON:**
```
https://www.sec.gov/Archives/edgar/data/{paddedCIK}/{accessionNoDashes}/{accessionNoDashes}-index.json
```

Where `accessionNoDashes` = accession number with hyphens stripped (e.g., `0001234567-24-000001` → `000123456724000001`).

**Index JSON structure (MEDIUM confidence — from community sources):**
```json
{
  "directory": {
    "item": [
      { "name": "d835366dex991.htm", "type": "EX-99.1", "sequence": "2" },
      { "name": "d835366d1012b.htm",  "type": "10-12B",  "sequence": "1" }
    ]
  }
}
```

**Document resolution logic:**
```javascript
// Priority: EX-99.1 > 10-12B (sequence 1) > any .htm file
function resolveFormDocument(indexItems, baseUrl) {
  const ex991 = indexItems.find(i => i.type === 'EX-99.1');
  if (ex991) return `${baseUrl}${ex991.name}`;
  const main = indexItems.find(i => i.type === '10-12B' || i.type === '10-12B/A');
  if (main) return `${baseUrl}${main.name}`;
  // Last resort: first .htm file
  const htm = indexItems.find(i => i.name?.endsWith('.htm'));
  return htm ? `${baseUrl}${htm.name}` : null;
}
```

**When to use:** Every time `runExtract` processes a filing. NEVER attempt to parse `primary_doc_url` directly — it points to the filing directory listing, not an HTML document.

### Pattern 2: Multi-Strategy Section Locator

**What:** Form 10 HTML section headings are not standardized. The same "Reasons for the Distribution" heading may be:
- An `<h2>`, `<h3>`, or `<h4>` tag
- A `<p>` or `<div>` with bold/uppercase inline styling
- A `<font>` tag with weight/size attributes (older filings)
- All-caps, title-case, or mixed-case

Use three strategies in priority order:

**Strategy 1 — Heading element search:**
```javascript
import { parse } from 'node-html-parser';

function findSectionByHeading(root, headingPattern) {
  // headingPattern is a case-insensitive RegExp
  const headings = root.querySelectorAll('h1,h2,h3,h4,h5,b,strong');
  return headings.find(el => headingPattern.test(el.text));
}
```

**Strategy 2 — Bold paragraph fallback:**
```javascript
// Some filings wrap headings in <p><b>...</b></p> or <p><font>...</font></p>
const boldParas = root.querySelectorAll('p');
const match = boldParas.find(p => {
  const bOrStrong = p.querySelector('b,strong,font');
  return bOrStrong && headingPattern.test(bOrStrong.text);
});
```

**Strategy 3 — Full-text search fallback (for missing sections):**
```javascript
// If no heading found, search raw text for the phrase in a 5-character window
const fullText = root.text;
const idx = fullText.search(headingPattern);
if (idx !== -1) {
  return fullText.slice(idx, idx + 5000); // extract 5 KB window
}
return null; // section genuinely absent
```

**Text extraction after finding the heading element:**
```javascript
// Collect sibling text nodes until the next heading of equal/higher level
function extractSectionText(headingEl, maxChars = 5000) {
  let text = '';
  let el = headingEl.nextElementSibling;
  while (el && text.length < maxChars) {
    const tag = el.tagName?.toLowerCase();
    if (['h1','h2','h3','h4'].includes(tag)) break; // stop at next heading
    text += el.text + '\n';
    el = el.nextElementSibling;
  }
  return text.slice(0, maxChars);
}
```

**When to use:** For every signal that requires locating a named section in the Form 10.

### Pattern 3: Signals Table Storage

**What:** A dedicated `signals` table stores one row per (filing, signal_name) pair. Each row records the classification result, the confidence level, and the raw excerpt used to produce it — so Phase 4 can assemble a structured prompt without re-parsing the HTML.

**Schema addition (ALTER TABLE safe pattern for idempotency):**
```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    filing_id    INTEGER NOT NULL REFERENCES filings(id),
    signal_name  TEXT    NOT NULL,  -- 'reason_classification' | 'equity_grants' | 'debt_loading' | 'management_continuity'
    classification TEXT,            -- signal-specific value (see Signal Design section)
    confidence   TEXT,              -- 'high' | 'medium' | 'low' | 'not_found'
    raw_excerpt  TEXT,              -- up to 5000 chars of source text
    extracted_at TEXT DEFAULT (datetime('now')),
    UNIQUE(filing_id, signal_name)
  );
  CREATE INDEX IF NOT EXISTS idx_signals_filing_id ON signals(filing_id);
  CREATE INDEX IF NOT EXISTS idx_signals_signal_name ON signals(signal_name);
`);
```

### Pattern 4: `runExtract` Stage Contract

**What:** `runExtract` receives the array of opportunity IDs returned by `runDiscover`, looks up the associated filings, processes each, stores signals, and returns the same IDs enriched for `runAnalyze`. It must not crash the pipeline when an individual filing fails (wrap each filing in try/catch).

```javascript
export async function runExtract(opportunityIds = []) {
  const results = [];
  for (const oppId of opportunityIds) {
    try {
      const signals = await extractSignalsForOpportunity(oppId);
      results.push({ oppId, signals });
    } catch (err) {
      logger.warn({ oppId, err: err.message }, 'signal extraction failed for opportunity');
    }
  }
  logger.info({ processed: results.length, total: opportunityIds.length }, 'extract stage complete');
  return results;
}
```

### Anti-Patterns to Avoid
- **Parsing `primary_doc_url` directly:** This URL points to the EDGAR filing directory, not the HTML document. Always resolve the actual document URL through the filing index.
- **Using `Promise.all()` for EDGAR fetches:** Violates the rate-limit rule in edgarClient.js. Use sequential `for...of` or wrap each call in `edgarGetText`.
- **Storing signals in `opportunities` columns:** Adds nullable columns for every signal and makes partial results impossible to distinguish from not-yet-extracted.
- **Crashing the pipeline when a section is not found:** Form 10s are often filed in draft form with placeholder sections. Store `confidence: 'not_found'` and continue.
- **Regex on raw HTML:** Tags, attributes, and comment nodes contaminate text matching. Always extract `.text` from node-html-parser after parsing.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML parsing | Custom regex-based HTML stripping | node-html-parser | Handles nested tags, entities, malformed HTML in EDGAR filings |
| Rate-limited fetch | New fetch wrapper | `edgarGetText` from edgarClient.js | Already battle-tested with retry and p-limit |
| Section boundary detection | Complex DOM walk | Multi-strategy heading matcher (see Architecture Patterns) | Form 10 structure is too variable for any single strategy |

**Key insight:** The section-location problem in Form 10 filings is inherently fuzzy. No single parsing strategy works for all filers. A ranked strategy list (heading tag → bold paragraph → full-text fallback) with a graceful `not_found` outcome is more robust than over-engineered DOM walking.

---

## Signal Design

### SIG-01: Reason Classification

**Section to target:** "Reasons for the Distribution" (also appears as "Reasons for the Spinoff", "Background of the Distribution", "Purpose of the Separation")

**Classification output:** `'strategic_focus'` | `'weak_unit_disposal'` | `'mixed'` | `'unknown'`

**Keyword sets (MEDIUM confidence — derived from SEC filing language research):**

Strategic focus indicators (bullish):
```javascript
const STRATEGIC_FOCUS_KEYWORDS = [
  /\bfocus\b.*\bcore\b/i,
  /\bcore business\b/i,
  /\benhance.*focus\b/i,
  /\benable.*management.*focus\b/i,
  /\bindependent.*operational\b/i,
  /\bpositio[n].*compet/i,
  /\bunlock.*value\b/i,
  /\bstrategic.*flexibility\b/i,
  /\bpursue.*growth\b/i,
  /\baccelerate.*strategy\b/i,
];
```

Weak unit disposal indicators (bearish):
```javascript
const WEAK_UNIT_KEYWORDS = [
  /\bnon.?core\b/i,
  /\bunderperform/i,
  /\bslow.*growth\b/i,
  /\bdifferent.*risk\s+profile\b/i,
  /\bdivest/i,
  /\bdissimilar.*business\b/i,
  /\blow.*margin\b/i,
  /\bmatured?\b.*business\b/i,
  /\bnot.*consistent\b.*strateg/i,
  /\bimped[ei]/i,           // "impede parent's strategy"
];
```

**Classification logic:** Count matches in each set. If strategic count > weak count AND strategic count >= 2 → `strategic_focus`. If weak count > strategic count AND weak count >= 1 → `weak_unit_disposal`. If both sets match → `mixed`. Otherwise → `unknown`.

### SIG-02: Equity Grants

**Section to target:** "Executive Compensation", "Equity Compensation", "Treatment of Outstanding Equity Awards", "Long-Term Incentive"

**Classification output:** `'equity_grants_confirmed'` | `'no_equity_grants'` | `'unknown'`

**Keyword sets:**
```javascript
const EQUITY_GRANT_KEYWORDS = [
  /\bstock\s+option/i,
  /\brestricted\s+stock\s+unit/i,
  /\bRSU\b/,
  /\bequity\s+(award|grant|incentive|compensation)/i,
  /\blong.term\s+incentive/i,
  /\bperformance\s+(share|unit|award)/i,
  /\bstock\s+award/i,
  /\bequity\s+plan/i,
  /\binitiall?y\s+grant/i,
  /\bnew\s+(equity|stock)\s+award/i,
];
```

**Classification logic:** If 2+ matches in equity grant keywords within the "Executive Compensation" section → `equity_grants_confirmed`. Zero matches → `no_equity_grants`. Section not found → `unknown`.

**Note:** A higher count (≥ 2) reduces false positives from boilerplate language about converted parent awards.

### SIG-03: Debt Loading

**Section to target:** "Capitalization", "Debt" (also "Pro Forma Capitalization", "Indebtedness")

**Classification output:** `'excessive_debt'` | `'moderate_debt'` | `'no_debt_concern'` | `'unknown'`

**Keyword sets:**
```javascript
const EXCESSIVE_DEBT_KEYWORDS = [
  /\bhighly\s+lever/i,
  /\bsubstantial\s+(debt|indebtedness)\b/i,
  /\bsignificant\s+(debt|indebtedness)\b/i,
  /\bconsiderable\s+(debt|indebtedness)\b/i,
  /\btransfer.*debt\b/i,
  /\bassume.*debt\b/i,
  /\bdebt.to.equity\b/i,
  /\blever[a-z]+\s+ratio\b/i,
  /\bterm\s+loan\b/i,
  /\bcredit\s+facilit/i,          // could indicate leveraged structure
];

const DEBT_CONCERN_AMPLIFIERS = [
  /\bbillion\b/i,   // scale indicator
  /\bmillion\b/i,
  /\b\d+(\.\d+)?\s*[xX]\b/,       // "3.5x leverage"
];
```

**Classification logic:** If excessive debt keywords >= 2 → `excessive_debt`. If 1 excessive debt keyword found → `moderate_debt`. Zero → `no_debt_concern`. Section absent → `unknown`.

**Note:** Dollar/leverage amounts should be captured as part of `raw_excerpt` for Phase 4 Claude analysis to assess magnitude.

### SIG-04: Management Continuity

**Section to target:** "Management", "Directors and Executive Officers", "Senior Management", "Certain Relationships" (also "Management of SpinCo", "Executive Officers of [Company]")

**Classification output:** `'strong_leaders_moving'` | `'leaders_staying_at_parent'` | `'mixed'` | `'unknown'`

**Keyword sets:**
```javascript
const SPINCO_LEADERSHIP_KEYWORDS = [
  /\bwill\s+(serve|join|become|lead|head)\b/i,
  /\b(president|chief\s+executive|ceo|cfo|coo|chairman)\s+of\s+\[spinco\]/i,
  /\btransfer.*management\b/i,
  /\b(previously|formerly)\s+(served|held).*parent\b/i,
  /\bfound(?:er|ed).*spinoff\b/i,
  /\bentrepreneur\b/i,
];

const PARENT_RETENTION_KEYWORDS = [
  /\bremain.*parent\b/i,
  /\bcontinue.*employ.*parent\b/i,
  /\bnot\s+(transition|move|transfer)\b/i,
  /\bretain.*executive\b/i,
  /\bno\s+dedicated\s+management\b/i,
];
```

**Classification logic:** leadership moving to SpinCo keyword count > parent retention → `strong_leaders_moving`. Parent retention dominant → `leaders_staying_at_parent`. Both sets match → `mixed`. Neither found → `unknown`.

**Important caveat:** This is the lowest-confidence signal because management biography sections are highly variable — some filings just list names and titles without describing transitions. Expect high `unknown` rates. Phase 4 (Claude) should re-assess from the raw_excerpt.

---

## EDGAR Document Fetching

### URL Construction (HIGH confidence)

The `primary_doc_url` stored by Phase 2 in the `filings` table is the filing **directory** URL:
```
https://www.sec.gov/Archives/edgar/data/{paddedCIK}/{accessionNoDashes}/
```

From this, derive the filing index JSON URL by appending `{accessionNoDashes}-index.json`:
```javascript
function filingIndexJsonUrl(primaryDocUrl, accessionNumber) {
  const accessionNoDashes = accessionNumber.replace(/-/g, '');
  return `${primaryDocUrl}${accessionNoDashes}-index.json`;
}
// Example:
// primaryDocUrl: "https://www.sec.gov/Archives/edgar/data/0001603978/000160397816000004/"
// accessionNumber: "0001603978-16-000004"
// result: "https://www.sec.gov/Archives/edgar/data/0001603978/000160397816000004/000160397816000004-index.json"
```

### Exhibit 99.1 vs. Inline Document (MEDIUM confidence)

From research into real 10-12B filings:
- **Large company spinoffs** (e.g., GE Vernova, Western Digital/SanDisk) file the Form 10-12B as a short wrapper; all narrative content is in Exhibit 99.1 (`d835366dex991.htm`).
- **Smaller spinoffs** sometimes include all content inline in the main `form10.htm` document.
- The filing index JSON (`directory.item[]`) distinguishes these by `type` field: `"EX-99.1"` for the exhibit, `"10-12B"` for the main document.

**Fallback chain for document resolution:**
1. Find item with `type === 'EX-99.1'` → use that document
2. Find item with `type === '10-12B'` or `type === '10-12B/A'` → use that document
3. Find first `.htm` file in directory → use that
4. Log warning and return `null` → store all four signals as `confidence: 'not_found'`

### Rate Limiting Rule

All EDGAR fetches MUST go through `edgarGetText`. The filing index JSON should use `edgarGetJson`. Per the existing rule in `edgarClient.js`: never call `fetch()` directly, never use `Promise.all()` over EDGAR endpoints.

---

## Common Pitfalls

### Pitfall 1: Parsing the Directory Listing Instead of the Document
**What goes wrong:** `primary_doc_url` in the `filings` table is the directory index URL. Fetching it returns an HTML directory listing, not the Form 10 narrative.
**Why it happens:** Phase 2 stores the directory URL (correctly — it's the stable canonical URL). Phase 3 must take one more step to resolve the actual document.
**How to avoid:** Always fetch the `{accessionNoDashes}-index.json` first; then resolve the document filename from it.
**Warning signs:** Parsed text contains "Name", "Description", "Documents" headers typical of EDGAR directory listings.

### Pitfall 2: Section Not Found Due to Heading Variation
**What goes wrong:** The heading matcher finds nothing for "Reasons for the Distribution" because the actual filing uses "Background and Reasons for the Distribution" or "Purpose of the Distribution."
**Why it happens:** SEC Form 10 instructions specify required topics but not exact heading text. Filers write their own headings.
**How to avoid:** Use broad regex patterns that match substrings: `/reasons?\s+for(\s+the)?\s+(distribution|separation|spinoff|spin-off)/i`. Include synonym terms. Always fall back to full-text search on the stripped body.
**Warning signs:** Consistently returning `not_found` for a signal across multiple real filings.

### Pitfall 3: Exhibit 99.1 Is an Amendment and Has Duplicate Sections
**What goes wrong:** Amended filings (10-12B/A) may have multiple EX-99.1 documents or a document with both old and new versions of sections.
**Why it happens:** Amendments append or replace content. EDGAR can have multiple files with the same exhibit type.
**How to avoid:** If multiple EX-99.1 entries exist, use the one with the highest sequence number (most recent amendment). If there are duplicate section headings, extract the first occurrence — it typically matches the amended version.
**Warning signs:** Keyword classification returns conflicting results (e.g., both strategic focus and weak unit in same section).

### Pitfall 4: HTML Entity Encoding in Text
**What goes wrong:** Keyword regex fails because the text contains `&amp;`, `&nbsp;`, `&#160;`, or similar entities around key phrases.
**Why it happens:** EDGAR HTML is often generated by word processors that produce entity-heavy output.
**How to avoid:** node-html-parser's `.text` property decodes HTML entities automatically. Always use `.text` (not `.innerHTML` or `.rawText`) when matching keywords.
**Warning signs:** Regexes that should match don't, but the phrase is clearly visible in the raw HTML source.

### Pitfall 5: Form 10 Filed With Tables Instead of Paragraphs
**What goes wrong:** Some financial sections (Capitalization in particular) are entirely in HTML tables. The section text extracted from siblings of the heading is empty.
**Why it happens:** Capitalization tables are financial statement-style disclosures, not narrative text.
**How to avoid:** After extracting text from sibling elements, if text length is < 100 chars, also extract `.text` from sibling `<table>` elements within the section boundary.
**Warning signs:** `raw_excerpt` for SIG-03 is very short or empty despite the section being found.

### Pitfall 6: `runExtract` Input Is Opportunity IDs, Not Filing Objects
**What goes wrong:** The stub `runExtract(filings = [])` accepts "filings" but `runDiscover` returns an array of `lastInsertRowid` opportunity IDs.
**Why it happens:** The stub was written before Phase 2 defined `runDiscover`'s return type.
**How to avoid:** Update the signature to `runExtract(opportunityIds = [])`. Look up each opportunity → its `filing_id` → the filing record → `accession_number` and `cik` → compute the index JSON URL.
**Warning signs:** Empty extraction results even though `runDiscover` returns non-empty arrays.

---

## Code Examples

### Fetch and Parse Exhibit 99.1
```javascript
// Source: edgarClient.js pattern (edgarGetJson / edgarGetText)
import { edgarGetJson, edgarGetText } from '../ingestion/edgarClient.js';
import { parse } from 'node-html-parser';

async function fetchForm10Html(filing) {
  const accessionNoDashes = filing.accession_number.replace(/-/g, '');
  const indexUrl = `${filing.primary_doc_url}${accessionNoDashes}-index.json`;

  let indexData;
  try {
    indexData = await edgarGetJson(indexUrl);
  } catch (err) {
    return null; // filing index not available
  }

  const items = indexData?.directory?.item ?? [];
  const baseUrl = filing.primary_doc_url;

  // Prefer EX-99.1, fall back to main 10-12B, fall back to first .htm
  const target =
    items.find(i => i.type === 'EX-99.1') ||
    items.find(i => i.type === '10-12B' || i.type === '10-12B/A') ||
    items.find(i => typeof i.name === 'string' && i.name.endsWith('.htm'));

  if (!target) return null;

  const html = await edgarGetText(`${baseUrl}${target.name}`);
  return parse(html);
}
```

### Multi-Strategy Section Locator
```javascript
// Source: derived from EdgarTools multi-strategy architecture (edgartools.io)
const SECTION_PATTERNS = {
  reasons_for_distribution: /reasons?\s+for(\s+the)?\s+(distribution|separation|spin.?off)/i,
  executive_compensation:   /executive\s+compensation/i,
  capitalization:           /capitali[sz]ation/i,
  management:               /(directors?\s+and\s+)?executive\s+officers?|senior\s+management/i,
};

function locateSection(root, patternKey) {
  const pattern = SECTION_PATTERNS[patternKey];

  // Strategy 1: heading elements
  const heading = root.querySelectorAll('h1,h2,h3,h4,h5,b,strong')
    .find(el => pattern.test(el.text));
  if (heading) return extractAfterHeading(heading);

  // Strategy 2: bold paragraph
  const boldPara = root.querySelectorAll('p')
    .find(p => {
      const inner = p.querySelector('b,strong,font');
      return inner && pattern.test(inner.text);
    });
  if (boldPara) return extractAfterHeading(boldPara);

  // Strategy 3: full-text window fallback
  const fullText = root.text;
  const idx = fullText.search(pattern);
  if (idx !== -1) return fullText.slice(idx, idx + 5000);

  return null; // section not found
}

function extractAfterHeading(headingEl, maxChars = 5000) {
  let text = '';
  let el = headingEl.nextElementSibling;
  const stopTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5']);
  while (el && text.length < maxChars) {
    if (stopTags.has(el.tagName?.toLowerCase())) break;
    text += el.text + '\n';
    el = el.nextElementSibling;
  }
  return text.trim().slice(0, maxChars);
}
```

### Signal Classifier Example (SIG-01)
```javascript
function classifyReasons(sectionText) {
  if (!sectionText) return { classification: 'unknown', confidence: 'not_found' };

  const strategicHits = STRATEGIC_FOCUS_KEYWORDS.filter(r => r.test(sectionText)).length;
  const weakHits = WEAK_UNIT_KEYWORDS.filter(r => r.test(sectionText)).length;

  let classification;
  if (strategicHits >= 2 && strategicHits > weakHits) classification = 'strategic_focus';
  else if (weakHits >= 1 && weakHits > strategicHits) classification = 'weak_unit_disposal';
  else if (strategicHits >= 1 && weakHits >= 1) classification = 'mixed';
  else classification = 'unknown';

  const confidence = (strategicHits + weakHits) >= 3 ? 'high'
    : (strategicHits + weakHits) >= 1 ? 'medium'
    : 'low';

  return { classification, confidence };
}
```

### Insert Signal Row
```javascript
// Uses INSERT OR REPLACE for idempotency on re-runs
const upsertSignal = db.prepare(`
  INSERT OR REPLACE INTO signals
    (filing_id, signal_name, classification, confidence, raw_excerpt, extracted_at)
  VALUES
    (@filing_id, @signal_name, @classification, @confidence, @raw_excerpt, datetime('now'))
`);

function storeSignal(filingId, signalName, classification, confidence, rawExcerpt) {
  upsertSignal.run({
    filing_id: filingId,
    signal_name: signalName,
    classification,
    confidence,
    raw_excerpt: (rawExcerpt ?? '').slice(0, 5000),
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Parse raw HTML with regex | Use node-html-parser for DOM + `.text` extraction | ~2019 | Handles entities, nested tags, malformed HTML |
| Rely on inline Form 10 content | Resolve Exhibit 99.1 via filing index JSON | ~2015 (large companies started this) | Must fetch filing index first; can't assume inline content |
| Store signals as opportunity columns | Separate `signals` table | Phase 4 requirement drove this | Clean normalized schema for AI analysis |

**Deprecated/outdated:**
- Parsing the SGML `.txt` submission wrapper: EDGAR now reliably provides HTML documents; `.txt` parsing is unnecessary complexity.
- Python-only parsing libraries (sec-parser, edgartools): Not applicable here. Equivalent multi-strategy approach can be built in ~150 lines of Node.js with node-html-parser.

---

## Open Questions

1. **Exact filing index JSON schema**
   - What we know: The URL pattern is `{primaryDocUrl}{accessionNoDashes}-index.json` and the response contains a `directory.item[]` array with `name`, `type`, `sequence` fields (from community sources).
   - What's unclear: Whether `directory.item` is always an array or can be a single object for single-document filings. Whether the `type` field exactly matches `"EX-99.1"` or uses variations.
   - Recommendation: In Wave 0, fetch a real filing index JSON to confirm schema (use curl or a one-off script). Add a fallback for `directory.item` being an object by wrapping in `Array.isArray() ? items : [items]`.

2. **Form 10 section headings in newest filings (2024-2025)**
   - What we know: Older filings consistently include "Reasons for the Distribution". Large-company filings (GE Vernova) have well-structured sections.
   - What's unclear: Whether newest filings (2025) have changed section naming conventions or increased use of iXBRL tagging that might alter HTML structure.
   - Recommendation: Test against at least 3 real 10-12B filings from 2024-2025 before locking keyword sets. The extract stage's `not_found` fallback protects the pipeline during this validation.

3. **`runExtract` input contract clarification**
   - What we know: The stub receives "filings" but `runDiscover` returns opportunity IDs. See Pitfall 6.
   - What's unclear: Whether the planner intends to change `runDiscover`'s return type or keep IDs.
   - Recommendation: Keep `runDiscover` returning opportunity IDs (matching current implementation). Update `runExtract` signature to `opportunityIds`. Query DB to join opportunity → filing → accession + CIK.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.14.0 | — |
| better-sqlite3 | Signal storage | Yes | 12.8.0 | — |
| p-limit | Rate limiting | Yes | 7.3.0 | — |
| node-html-parser | HTML parsing | No (not installed) | 1.2.0 (npm) | Must install |
| EDGAR EFTS / Archives | Document fetching | Assumed reachable | — | — |

**Missing dependencies with no fallback:**
- `node-html-parser` — must be installed before implementation (`npm install node-html-parser`). No equivalent capability without it; alternative would be regex on raw HTML (strongly inadvisable).

**Missing dependencies with fallback:**
- None beyond the above.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` |
| Config file | None (glob pattern in package.json scripts) |
| Quick run command | `node --test "src/__tests__/extract.test.js"` |
| Full suite command | `node --test "src/__tests__/*.test.js"` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SIG-01 | Classify "strategic focus" from "Reasons for Distribution" text | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-01 | Classify "weak unit disposal" from negative language | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-01 | Return `unknown` when section absent | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-02 | Detect equity grants from compensation section text | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-02 | Return `no_equity_grants` when no keywords match | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-03 | Detect excessive debt from capitalization text | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-04 | Classify management continuity direction | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-01–04 | `runExtract([])` returns `[]` without error | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-01–04 | Signals stored in DB via `storeSignal` (INSERT OR REPLACE idempotency) | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |
| SIG-01–04 | `runExtract` continues on individual filing error (try/catch) | unit | `node --test "src/__tests__/extract.test.js"` | No — Wave 0 |

**Testing strategy note:** All signal classifier tests must run on **fixture text** (hardcoded sample section text), never on live EDGAR fetches. The EDGAR HTTP calls should be mocked using `globalThis.fetch = async () => ...` following the existing `discover.test.js` pattern. This allows full classifier coverage without network access.

### Sampling Rate
- **Per task commit:** `node --test "src/__tests__/extract.test.js"`
- **Per wave merge:** `node --test "src/__tests__/*.test.js"`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/extract.test.js` — covers all SIG-01 through SIG-04 with fixture text
- [ ] `npm install node-html-parser` — required before any implementation task

*(No additional framework install needed — `node:test` already in use)*

---

## Sources

### Primary (HIGH confidence)
- Existing codebase (`src/ingestion/edgarClient.js`, `src/ingestion/edgarIngester.js`, `src/lib/edgar-utils.js`) — confirmed URL patterns, rate limit rules, existing fetch infrastructure
- `src/db/schema.js` — confirmed current schema, what columns exist
- `src/__tests__/discover.test.js` — confirmed test pattern: `node:test`, `globalThis.fetch` mock, `?v=N` ESM cache busting
- `package.json` — confirmed stack, Node 24, no HTML parser installed

### Secondary (MEDIUM confidence)
- [Downloading SEC Filings — Medium](https://medium.com/@jgfriedman99/downloading-sec-filings-591ca0cfd98d) — filing index URL format, primary document resolution
- [Spin-offs Unraveled — Harvard Law](https://corpgov.law.harvard.edu/2019/10/31/spin-offs-unraveled/) — Form 10 structure, reasons for distribution language
- [Gibson Dunn Spin-off Guide 2024](https://www.gibsondunn.com/wp-content/uploads/2024/05/WebcastSlides-Unlocking-Value-The-What-Why-and-How-of-Spin-Offs-1-MAY-2024.pdf) — Form 10 section names and required disclosures
- [Greenblatt on Spin-offs — Medium](https://medium.com/@mpf/greenblatt-on-spin-offs-72cfcdbdd6d6) — signal definitions: equity grants, leverage transfer, management incentives
- [alphanome-ai/sec-parser GitHub](https://github.com/alphanome-ai/sec-parser) — multi-strategy heading detection pattern (TOC → heading tag → bold paragraph)
- [edgartools.io docs](https://www.edgartools.io/edgartools-5/) — multi-strategy architecture reference: TOC parsing, header pattern matching, cross-reference index
- [node-html-parser npm](https://www.npmjs.com/package/node-html-parser) — confirmed v1.2.0, API for `.text`, `querySelectorAll`
- [WebSearch 2024 Exhibit 99.1 structure] — confirmed that large-company Form 10-12B filings incorporate narrative by reference from EX-99.1

### Tertiary (LOW confidence)
- Filing index JSON schema (`directory.item[]` array with `name`, `type`, `sequence`) — inferred from community sources; **must be validated against a real filing index response in Wave 0 before implementation relies on it**
- Keyword sets for SIG-01 through SIG-04 — assembled from research into actual spinoff language; accuracy requires empirical testing against real Form 10 filings

---

## Metadata

**Confidence breakdown:**
- EDGAR document fetching (URL patterns): HIGH — confirmed from edgarClient.js + community docs
- Filing index JSON schema: MEDIUM — inferred, not directly verified
- Exhibit 99.1 vs. inline content: MEDIUM — confirmed pattern for large companies; may vary for small filers
- Signal keyword sets: MEDIUM — grounded in SEC filing language research; empirical accuracy requires real-filing testing
- Architecture patterns (signals table, multi-strategy locator): HIGH — derived from existing project conventions and established library approaches
- HTML structure / heading tags in Form 10: MEDIUM — access to live EDGAR blocked in this environment; structure inferred from sec-parser/edgartools documentation

**Research date:** 2026-03-29
**Valid until:** 2026-04-29 (30 days; EDGAR HTML conventions are stable)
