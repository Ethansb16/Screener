# Phase 5: Dashboard - Research

**Researched:** 2026-03-30
**Domain:** Express 5 + HTMX partial swaps + Tailwind CSS Play CDN — server-rendered feed and detail views
**Confidence:** HIGH

## Summary

Phase 5 builds the only user-facing surface in the application: a browsable spinoff feed and a drill-down detail view. The stack is already decided and partially wired in `src/main.js` — Express 5.2.1 with a placeholder `GET /` route and the DB singleton available. The work here is to add a `src/web/` module containing a router, query functions, and inline HTML template strings that return either full-page HTML or HTMX fragments depending on the `HX-Request` header.

HTMX works without a template engine: the server returns HTML strings from `res.send()`. Express 5's async error propagation (rejected promises auto-forwarded to the error handler) means route handlers can `await` DB queries without `try/catch` boilerplate. Tailwind Play CDN (`@tailwindcss/browser@4`) is included via a script tag in the base layout — no build step required. This is development-only per Tailwind docs, which is acceptable for a personal daily-use tool.

The four signals (`reason_classification`, `equity_grants`, `debt_loading`, `management_continuity`) live in the `signals` table keyed by `filing_id`. The `claude_analysis` text lives in `opportunities.claude_analysis`. A JOIN across `opportunities`, `signals`, and `filings` is all the data access this phase needs.

**Primary recommendation:** Implement as a single Express Router (`src/web/router.js`) with two routes: `GET /` for the feed list and `GET /opportunities/:id` for the detail view. Both routes check `req.headers['hx-request']` to decide between full-page and fragment responses. No template engine, no new npm packages.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | Web dashboard displays a browsable feed of spinoff opportunities with key signals visible at a glance (company names, deal type, status, top signal indicator) | Feed query JOINs opportunities + signals; top signal derived from signal_strength or first signal classification. Express GET / route returns table/card list. |
| DASH-02 | Each spinoff has a detail view showing full signal breakdown and the Claude AI summary with red flag callouts | Detail query fetches all 4 signals + claude_analysis by opportunity ID. GET /opportunities/:id returns full signal table + formatted analysis text. |
</phase_requirements>

---

## Standard Stack

### Core (already installed — no new packages required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.1 | HTTP router and server | Already installed; Phase 1 wired it into main.js |
| htmx.org | 2.0.8 (CDN) | Partial page swaps without JavaScript | Project decision; no build step needed |
| @tailwindcss/browser | 4 (CDN) | Utility CSS via Play CDN | Project decision; development-only tool, acceptable for personal use |
| better-sqlite3 | 12.8.0 | Synchronous DB queries | Already installed; used by all prior phases |
| pino | 10.3.1 | Request logging | Already installed; singleton at src/logger.js |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:test | built-in (Node 24) | Dashboard route tests | Unit testing route handlers with mock request/response |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline HTML template literals | EJS, Handlebars, Pug | No new dependency; string templates are sufficient for a small personal tool with two views |
| Play CDN Tailwind | Build-step Tailwind CLI | Build step adds complexity with no benefit for a solo dev tool |

**Installation:** No new packages. All required libraries are already in `package.json`.

**Version verification (confirmed 2026-03-30):**
- `npm view express version` → 5.2.1 (installed)
- `npm view htmx.org version` → 2.0.8 (CDN, not npm)

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── web/
│   ├── router.js          # Express Router — GET / and GET /opportunities/:id
│   ├── queries.js         # DB query functions (listOpportunities, getOpportunityDetail)
│   └── templates.js       # HTML template functions (layout, feedRow, detailView)
├── db/
│   ├── db.js              # existing singleton
│   └── schema.js          # existing schema
├── pipeline/              # existing pipeline stages
├── main.js                # existing — mount router.js here
└── ...
```

### Pattern 1: HX-Request Header Branching

**What:** One route handler returns full-page HTML for direct navigation and an HTML fragment for HTMX requests.

**When to use:** Every route that can be triggered both by initial page load and by HTMX click.

**Example:**
```javascript
// Source: https://htmx.org/docs/ (HX-Request header) + Express 5 docs
router.get('/opportunities/:id', async (req, res) => {
  const opp = getOpportunityDetail(Number(req.params.id));
  if (!opp) return res.status(404).send('<p>Not found</p>');

  const fragment = renderDetail(opp);
  if (req.headers['hx-request']) {
    res.send(fragment);                  // HTMX partial swap
  } else {
    res.send(renderLayout(fragment));    // full page for direct URL load
  }
});
```

### Pattern 2: Feed List with HTMX Click-to-Detail

**What:** Each feed row has `hx-get`, `hx-target`, and `hx-push-url` attributes so clicking a row swaps the detail panel and updates the browser URL.

**When to use:** Master-detail UI pattern where detail loads inline without full page reload.

**Example:**
```html
<!-- Feed row — server renders this per opportunity -->
<tr
  hx-get="/opportunities/42"
  hx-target="#detail-panel"
  hx-swap="innerHTML"
  hx-push-url="/opportunities/42"
  class="cursor-pointer hover:bg-gray-50"
>
  <td>Acme Corp</td>
  <td>spinoff</td>
  <td>new</td>
  <td>strategic_focus</td>
</tr>

<!-- Detail panel — starts empty or with placeholder text -->
<div id="detail-panel">
  <p class="text-gray-400">Select a spinoff to view details.</p>
</div>
```

### Pattern 3: Express Router Mounted on Main

**What:** Dashboard routes live in their own Router module, mounted at `/` in main.js.

**When to use:** Keeps main.js as a thin bootstrap file; dashboard logic is isolated and testable.

**Example:**
```javascript
// src/main.js — replace the placeholder GET / with:
import { dashboardRouter } from './web/router.js';
app.use('/', dashboardRouter);
```

### Pattern 4: Synchronous better-sqlite3 Queries in Async Route

**What:** better-sqlite3 is synchronous; Express 5 route handlers are async for readability but the DB calls are not actually awaited (they return immediately).

**When to use:** All DB access in route handlers. Do NOT wrap in `new Promise()` — it adds overhead for no gain.

```javascript
// src/web/queries.js
import db from '../db/db.js';

export function listOpportunities() {
  return db.prepare(`
    SELECT o.id, o.company_name, o.signal_type, o.status,
           o.discovered_at, o.spinoff_target,
           s.classification AS top_signal_classification,
           s.signal_name    AS top_signal_name
    FROM opportunities o
    LEFT JOIN signals s
      ON s.filing_id = o.filing_id
     AND s.signal_name = 'reason_classification'
    ORDER BY o.discovered_at DESC
  `).all();
}

export function getOpportunityDetail(id) {
  const opp = db.prepare(`
    SELECT o.*, f.company_name AS parent_company, f.filed_at, f.accession_number
    FROM opportunities o
    JOIN filings f ON f.id = o.filing_id
    WHERE o.id = ?
  `).get(id);
  if (!opp) return null;

  const signals = db.prepare(`
    SELECT signal_name, classification, confidence, raw_excerpt
    FROM signals
    WHERE filing_id = (SELECT filing_id FROM opportunities WHERE id = ?)
    ORDER BY signal_name
  `).all(id);

  return { ...opp, signals };
}
```

### Pattern 5: Base Layout Template

**What:** A function returning the full HTML shell with HTMX CDN and Tailwind CDN script tags. Fragments do not include this wrapper.

```javascript
// src/web/templates.js
export function renderLayout(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spinoff Screener</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js"></script>
</head>
<body class="bg-gray-50 text-gray-900 p-6">
${bodyContent}
</body>
</html>`;
}
```

### Anti-Patterns to Avoid

- **Template engine for two small views:** Installing EJS/Handlebars for two routes adds a dependency with no benefit. Use tagged template literals.
- **Wrapping better-sqlite3 in Promise:** The driver is synchronous by design; wrapping it adds overhead without any async benefit.
- **Returning full layout for every HTMX request:** Always check `req.headers['hx-request']` and return only the fragment. Returning a full HTML document inside an HTMX swap target breaks the page.
- **Using `res.send(status, body)` (Express 4 signature):** Express 5 removed this. Use `res.status(404).send(body)`.
- **Forgetting `Vary: HX-Request` header:** When the same URL returns different content depending on whether the request is from HTMX, set this header so proxies cache correctly. For a personal tool this is low risk but is the correct pattern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS utility classes | Custom CSS stylesheet | Tailwind Play CDN | Already decided; reinventing will take longer and produce worse results |
| Partial page swap | Custom fetch + innerHTML | HTMX `hx-get` + `hx-target` | Already decided; HTMX handles history, indicators, and swap strategies |
| HTML escaping | Custom escape function | Template literal with manual escaping for user-controlled fields | `company_name` and `claude_analysis` come from SEC filings and Claude — they may contain `<`, `>`, `&`. Escape these before inserting into HTML. |
| XSS prevention in analysis text | Sanitization library | `String.replace()` with the 5 entities (`&`, `<`, `>`, `"`, `'`) | A minimal inline escape for the 5 HTML entities is sufficient here; no full sanitization library needed |

**Key insight:** The only tricky hand-rolling concern is HTML escaping of data from the DB. `claude_analysis` is plain text from Claude — it should not contain HTML, but defensive escaping costs nothing and prevents broken layouts if the text ever contains `<` or `>`.

---

## Common Pitfalls

### Pitfall 1: HTMX fragment includes full `<html>` document

**What goes wrong:** The server returns a full HTML page (with `<html>`, `<head>`) in response to an HTMX swap request, so the inner page content renders as raw escaped HTML or duplicates the layout.

**Why it happens:** Forgetting to branch on `req.headers['hx-request']`.

**How to avoid:** Every route that can be reached via HTMX swap must check the `HX-Request` header and return only the inner fragment if it is present.

**Warning signs:** Detail panel shows `<!DOCTYPE html>` text or the page title appears inside the content area.

### Pitfall 2: Express 5 path parameter syntax

**What goes wrong:** Using `/opportunities/:id(\\d+)` (Express 4 regex syntax) causes a route registration error in Express 5.

**Why it happens:** Express 5 removed regex-embedded route patterns for security (ReDoS prevention).

**How to avoid:** Use plain `:id` and validate the parameter value inside the handler with `Number.isInteger(Number(req.params.id))`.

**Warning signs:** `TypeError: Invalid route pattern` on server startup.

### Pitfall 3: Signals table has no row for an opportunity

**What goes wrong:** The `LEFT JOIN signals` returns `null` for `top_signal_classification` for opportunities where signal extraction has not yet run (status `new`).

**Why it happens:** The signals table is populated by Phase 3; a newly discovered filing may not have signals yet.

**How to avoid:** Use `LEFT JOIN` (not `INNER JOIN`) and handle `null` gracefully in the template with a fallback like `'—'` or `'pending'`.

**Warning signs:** Feed rows for recent discoveries show blank signal columns; `getOpportunityDetail()` returns `signals: []`.

### Pitfall 4: `claude_analysis` is `null` for unanalyzed opportunities

**What goes wrong:** Template renders `"null"` literally in the detail view.

**Why it happens:** `claude_analysis` is nullable; `String(null)` in a template literal produces the string `"null"`.

**How to avoid:** Always guard: `opp.claude_analysis ?? 'Analysis pending — check back after the next pipeline run.'`

**Warning signs:** Detail view shows the text "null" in the AI summary section.

### Pitfall 5: Tailwind Play CDN v3 vs v4 class differences

**What goes wrong:** If you accidentally use the v3 CDN tag (`@tailwindcss/browser@3`) but reference v4-only utilities, or vice versa, classes are silently dropped.

**Why it happens:** The two CDN URLs look similar but target different Tailwind major versions.

**How to avoid:** Use the v4 CDN tag `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4` consistently. v4 changes: JIT is always on, configuration is now CSS-first (`@theme`), and most v3 utility classes still work.

**Warning signs:** Specific classes that should produce visible styling produce nothing.

### Pitfall 6: `req.params.id` is a string, not a number

**What goes wrong:** Passing `req.params.id` directly to a prepared statement that expects an integer causes SQLite to do a type coercion. Mostly harmless, but `Number(req.params.id)` is the correct idiom given the existing codebase pattern.

**Why it happens:** Express route parameters are always strings.

**How to avoid:** `const id = Number(req.params.id);` followed by `if (!Number.isInteger(id)) return res.status(400).send('Invalid id');`.

---

## Code Examples

Verified patterns from official sources:

### HTMX Feed Row with Click-to-Detail
```html
<!-- Source: https://htmx.org/attributes/hx-get/ and https://htmx.org/attributes/hx-push-url/ -->
<tr
  hx-get="/opportunities/{{ id }}"
  hx-target="#detail-panel"
  hx-swap="innerHTML"
  hx-push-url="true"
  class="cursor-pointer hover:bg-slate-100 border-b"
>
  <td class="py-2 px-4">{{ company_name }}</td>
  <td class="py-2 px-4">{{ signal_type }}</td>
  <td class="py-2 px-4">{{ status }}</td>
  <td class="py-2 px-4">{{ top_signal_classification }}</td>
</tr>
```

### Express 5 Async Route with DB Query
```javascript
// Source: https://expressjs.com/2024/10/15/v5-release.html (async error propagation)
router.get('/opportunities/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).send('<p>Invalid opportunity ID</p>');
  }
  const detail = getOpportunityDetail(id);    // synchronous — better-sqlite3
  if (!detail) return res.status(404).send('<p>Opportunity not found</p>');

  const fragment = renderDetail(detail);
  if (req.headers['hx-request']) {
    res.send(fragment);
  } else {
    res.send(renderLayout(renderFeedPage(detail, fragment)));
  }
});
```

### HTML Escape Utility (no library needed)
```javascript
// 5-entity escape sufficient for server-rendered DB content
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

### Signal Classification Display Mapping
```javascript
// Maps DB classification values to human-readable labels + color hints
const SIGNAL_LABELS = {
  // reason_classification
  strategic_focus:       { label: 'Strategic Focus',       color: 'text-green-700' },
  weak_unit_disposal:    { label: 'Weak Unit Disposal',    color: 'text-red-700'   },
  mixed:                 { label: 'Mixed',                  color: 'text-yellow-700'},
  // equity_grants
  equity_grants_confirmed: { label: 'Equity Grants',       color: 'text-green-700' },
  no_equity_grants:        { label: 'No Equity Grants',    color: 'text-red-700'   },
  // debt_loading
  no_debt_concern:       { label: 'No Debt Concern',       color: 'text-green-700' },
  moderate_debt:         { label: 'Moderate Debt',         color: 'text-yellow-700'},
  excessive_debt:        { label: 'Excessive Debt',        color: 'text-red-700'   },
  // management_continuity
  strong_leaders_moving: { label: 'Leaders Moving to SpinCo', color: 'text-green-700' },
  leaders_staying_at_parent: { label: 'Leaders Staying at Parent', color: 'text-red-700' },
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express `app.use(express.json())` auto-parsing body | Same; no change for GET-only dashboard | - | No impact |
| Express 4 regex route syntax `/:id(\\d+)` | Express 5: plain `:id` + in-handler validation | Express 5.0 (Oct 2024) | Must NOT use regex in route paths |
| `res.send(404, body)` | `res.status(404).send(body)` | Express 5.0 | Must use status method chaining |
| Tailwind Play CDN v3: `<script src="https://cdn.tailwindcss.com">` | v4: `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">` | Tailwind v4 (early 2025) | Different script tag; v4 utilities mostly backward-compatible |
| HTMX 1.x CDN URL | HTMX 2.x: `https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js` | HTMX 2.0 | 2.x has minor breaking changes from 1.x but same core API for this use case |

**Deprecated/outdated:**
- Express 4 `res.send(status, body)` two-argument form: removed in Express 5
- Tailwind v3 Play CDN `https://cdn.tailwindcss.com`: still works but v4 CDN is current

---

## Open Questions

1. **"Top signal indicator" definition for DASH-01**
   - What we know: DASH-01 requires a "top signal indicator" visible in the feed without clicking
   - What's unclear: Is this the `reason_classification` (most investment-relevant), `signal_strength` on the opportunity, or a composite score?
   - Recommendation: Use `reason_classification` as the primary top signal in the feed. It is the most interpretable single signal and is always present when signals have been extracted. The `signal_strength` column on `opportunities` is often `null` from the existing codebase.

2. **Red flag rendering in `claude_analysis` text**
   - What we know: `claude_analysis` is plain text from Claude following the SYSTEM_PROMPT format, with a `Red Flags:` section at the end if red flags exist
   - What's unclear: Should red flag names be visually highlighted or rendered as plain text?
   - Recommendation: Detect lines starting with `-` after `Red Flags:` in the text and render them with a red badge or colored text. The Claude output format is deterministic (from SYSTEM_PROMPT), so string splitting on `Red Flags:` is reliable.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.14.0 | — |
| Express 5 | Web server | Yes | 5.2.1 (installed) | — |
| better-sqlite3 | DB queries | Yes | 12.8.0 (installed) | — |
| pino | Logging | Yes | 10.3.1 (installed) | — |
| HTMX (CDN) | Partial swaps | Yes (CDN, requires internet) | 2.0.8 | Static copy of htmx.min.js vendored into src/web/public/ |
| Tailwind (CDN) | Styling | Yes (CDN, requires internet) | @tailwindcss/browser@4 | Fallback to minimal inline styles if offline |
| curl | Connectivity check | Yes | available | — |

**Missing dependencies with no fallback:** None — all are installed or CDN-available.

**Missing dependencies with fallback:**
- HTMX CDN: If offline, vendor `htmx.min.js` as a static file served from Express `express.static`. Low priority for a development tool.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node 24) |
| Config file | none — invoked directly |
| Quick run command | `node --test "src/__tests__/*.test.js"` |
| Full suite command | `node --test "src/__tests__/*.test.js"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | `GET /` returns HTML containing opportunity list with company_name, signal_type, status visible | unit (mock DB) | `node --test "src/__tests__/dashboard.test.js"` | No — Wave 0 |
| DASH-01 | `GET /` with HTMX header returns fragment only (no `<html>` wrapper) | unit | `node --test "src/__tests__/dashboard.test.js"` | No — Wave 0 |
| DASH-02 | `GET /opportunities/:id` returns HTML with all 4 signal names + claude_analysis text | unit (mock DB) | `node --test "src/__tests__/dashboard.test.js"` | No — Wave 0 |
| DASH-02 | `GET /opportunities/:id` with nonexistent id returns 404 | unit | `node --test "src/__tests__/dashboard.test.js"` | No — Wave 0 |
| DASH-02 | `GET /opportunities/:id` with non-integer id returns 400 | unit | `node --test "src/__tests__/dashboard.test.js"` | No — Wave 0 |
| DASH-02 | Detail fragment with null claude_analysis shows fallback text (not "null") | unit | `node --test "src/__tests__/dashboard.test.js"` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test "src/__tests__/dashboard.test.js"`
- **Per wave merge:** `node --test "src/__tests__/*.test.js"`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/dashboard.test.js` — covers DASH-01 and DASH-02 using mock DB queries
- [ ] `src/web/` directory — router.js, queries.js, templates.js (all new files)

### How to Test Express Routes Without a Running Server

The existing test suite (analyze.test.js, etc.) imports modules directly and exercises functions. For dashboard routes, inject mock query functions to avoid hitting the live DB:

```javascript
// Approach: Export testable render functions separately from Express wiring
// Test renderFeedPage(opportunities) and renderDetail(opp) as pure functions
// Test route handler behavior by constructing mock req/res objects

// Mock req/res pattern used throughout project (per node:test conventions):
const mockRes = {
  status(code) { this._status = code; return this; },
  send(body)   { this._body = body; return this; },
};
const mockReq = { params: { id: '1' }, headers: {} };
```

---

## Sources

### Primary (HIGH confidence)
- Express 5 release announcement — https://expressjs.com/2024/10/15/v5-release.html — breaking changes, async handling, path syntax
- HTMX official docs — https://htmx.org/docs/ — hx-get, hx-target, hx-swap, hx-push-url, HX-Request header, CDN URL
- Tailwind CSS Play CDN docs — https://tailwindcss.com/docs/installation/play-cdn — v4 script tag, limitations
- Codebase (src/db/schema.js, src/ingestion/claudeAnalyzer.js, src/main.js) — data shapes, existing patterns

### Secondary (MEDIUM confidence)
- WebSearch: HTMX + Express Node.js integration patterns — https://dev.to/kasir-barati/htmx-and-expressjs-36dk
- WebSearch: HTMX partial swap patterns — https://www.utilitygods.com/blog/htmx-partial-swap/

### Tertiary (LOW confidence — for general awareness only)
- WebSearch: "hx-indicator" patterns for loading state — not needed for v1 but available if desired

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Express 5.2.1 and better-sqlite3 are installed; HTMX 2.0.8 CDN URL verified; Tailwind v4 CDN verified
- Architecture: HIGH — patterns derived from existing codebase conventions + official HTMX and Express 5 docs
- Pitfalls: HIGH — Express 5 breaking changes sourced from official release notes; HTMX HX-Request pattern from official docs; null-handling pitfalls derived from schema inspection

**Research date:** 2026-03-30
**Valid until:** 2026-06-30 (stable libraries; Tailwind and HTMX CDN URLs are pinned to major versions)
