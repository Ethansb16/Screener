# Feature Landscape

**Domain:** Personal spinoff investment screener (special situations / event-driven)
**Researched:** 2026-03-28
**Thesis:** Joel Greenblatt spinoff playbook — insider incentive alignment is the primary signal

---

## Table Stakes

Features an analyst expects to be present. Missing any of these makes the tool feel incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Spinoff list / feed | Core navigation — user needs to see what exists | Low | Must include announced + recently effective |
| Parent company name + ticker | Immediately identifies the source entity | Low | Link to parent filing on EDGAR |
| SpinCo name + proposed ticker | Identifies the new entity | Low | Ticker may be TBD before effective date |
| Announcement date | Lets user gauge how fresh an opportunity is | Low | From 8-K or news API |
| Expected / effective separation date | Sets timeline for institutional selling pressure | Low | From Form 10 or press release |
| Deal type label | Spinoff vs. carve-out vs. split-off behave differently | Low | Source from filing type |
| Insider signal indicator | The core thesis signal — must be front-and-center | Medium | See signal breakdown below |
| AI plain-English summary | One-paragraph digest of the situation | Medium | Claude-generated from Form 10 + news |
| Link to SEC filing (Form 10 / 8-K) | Power user escape hatch to primary source | Low | EDGAR direct URL |
| Daily refresh | Ensures feed is current without manual trigger | Medium | Cron job or scheduled pipeline |

---

## Differentiators

Features that go beyond what other spinoff trackers offer. These are what make the tool valuable vs. just bookmarking InsideArbitrage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Greenblatt signal score | Synthesizes all insider/incentive signals into a single verdict (bullish / bearish / neutral) | High | Requires prompt engineering + filing parsing |
| Compensation structure extraction | Pulls the comp table from Form 10 and flags whether mgmt holds spinoff equity | High | Parse Item 6 (Executive Compensation) in Form 10 |
| Management-stays flag | Detects whether senior executives move to SpinCo (bullish) or stay at parent (bearish) | Medium | Cross-reference mgmt bios in Form 10 vs. parent proxy |
| Form 4 insider buy activity | Post-distribution open-market purchases by SpinCo insiders within first 30-90 days | Medium | EDGAR Form 4 feed filtered by new SpinCo CIK |
| Option strike price note | Notes whether mgmt options are tied to the opening trade price (creates incentive to suppress initial price) | Medium | Found in "Equity Compensation Plans" section of Form 10 |
| Institutional mismatch flag | SpinCo market cap < $500M, or spin-off < 20% of parent size — signals forced selling | Low | Calculated from filing data |
| Spinoff reason classification | Categorizes reason: "unlock value" vs. "shed weak unit" vs. "regulatory/antitrust" | High | Extracted from "Reasons for Distribution" section of Form 10 |
| Parent stake retained | Whether parent retains equity post-spin (bullish signal) | Medium | Disclosed in separation agreement section of Form 10 |
| Rights offering flag | Signals a rights offering attached to the spinoff (Greenblatt's "stop and look" rule) | Low | Detect from 8-K or Form 10 text |
| Parent also flagged as buy | Alerts when parent may be worth buying pre-spin (stripped of bad unit, potential M&A target) | Medium | Derived signal; requires business quality context |

---

## Anti-Features

Features explicitly not worth building in V1 or V2.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full DCF / valuation calculator | Adds complexity, not the screener's job — user does their own valuation | Show pro-forma financials link only |
| Technicals / charting | Not relevant to the Greenblatt thesis; adds noise | Omit entirely |
| Multi-user auth / teams | Personal tool; adds significant dev overhead | No-auth single user |
| Real-time / intraday alerts | Daily is sufficient; real-time requires costly streaming infrastructure | Daily cron refresh |
| General stock screener filters | The thesis is spinoff-specific; P/E filters etc. are a distraction | Keep scope to spinoff events only |
| Automated trade execution | Research tool only; adds legal and complexity burden | Link to brokerage, not execute |
| Email / push notifications | Phase 2 at earliest; MVP is a browsable feed | Later feature if needed |
| Peer comparison engine | Value Line comps are a manual analyst step | Out of scope |

---

## Core Signal Breakdown: Greenblatt Thesis Operationalized

This section defines precisely how to detect the key signals. These drive the insider signal indicator and Greenblatt score.

### Signal 1: Management Rewarded with SpinCo Equity (BULLISH)

**Where to find it:** Form 10, Item 6 (Executive Compensation) and Exhibit 10 (Equity Incentive Plan)

**What to look for:**
- SpinCo executives hold or will receive stock options, RSUs, or restricted stock in the new entity
- Option exercise prices tied to opening trading price (standard for spinoffs — lower opening price = lower strike, so mgmt may suppress pre-open expectations)
- % of total compensation that is equity-linked (higher = stronger alignment)
- C-suite of SpinCo filled by former parent executives who chose to move to SpinCo (indicates confidence)

**Strength levels:**
- Strong bullish: Large equity grants + CEO moved from parent + Form 4 open-market buys within 90 days
- Moderate bullish: Equity grants present but no open-market buys yet
- Neutral: Standard equity plan, no signals either way

**EDGAR section text to parse:** "Executive Compensation," "Equity Compensation Plans," "Treatment of Outstanding Equity Awards"

---

### Signal 2: Management Dumping a Weak Unit (BEARISH)

**Where to find it:** Form 10, "The Distribution" / "Reasons for the Distribution" section (typically first 10-20 pages)

**What to look for:**
- SpinCo is a legacy, declining, or capital-intensive business that distracted the parent
- Parent management retains no equity in SpinCo post-spin
- SpinCo management is newly hired externally (no skin in the game yet)
- SpinCo is loaded with legacy debt from the parent (debt-stuffing pattern)
- "Reasons" section language: "allow each company to focus on its core business" (generic) vs. specific strategic upside narrative (substantive)
- Parent stock outperforms SpinCo immediately post-spin (institutional selling pressure confirming weak unit)

**EDGAR section text to parse:** "Reasons for the Distribution," "Relationship Between [Parent] and [SpinCo] After the Distribution," "Capitalization"

---

### Signal 3: Institutional Indifference / Forced Selling Setup (BULLISH CONTEXT)

**Where to find it:** Calculated, not a filing section

**What to look for:**
- SpinCo market cap projected < $500M (excluded from most institutional mandates)
- SpinCo market cap < 20% of parent market cap at time of spin
- Parent is in S&P 500 (guarantees index-fund selling of SpinCo shares)
- SpinCo sector differs from parent (e.g., industrial parent spinning off a REIT — pension funds dump misclassified assets)
- No analyst coverage yet (dark period post-spin, typically 40 days before coverage initiated)

---

### Signal 4: Antitrust / Regulatory Mandated Spin (BULLISH)

**Where to find it:** "Reasons for the Distribution," news sources

**What to look for:**
- FTC or DOJ required the separation as a merger remedy
- Government-mandated divestiture of a profitable unit (not a voluntary shedding)
- Regulatory language in the 8-K or Form 10 background section

---

## Form 10 Filing Sections: Priority Read Order

For the AI summarizer and signal extractor, sections should be parsed in this priority:

| Priority | Section | What to Extract |
|----------|---------|----------------|
| 1 | "Summary" / "Information Statement Summary" | Deal overview, separation rationale, capital structure |
| 2 | "Reasons for the Distribution" | Bullish/bearish classification of why this spin is happening |
| 3 | "Executive Compensation" (Item 6 / Item 402) | Equity grant sizes, option plans, comp tied to SpinCo performance |
| 4 | "Security Ownership of Certain Beneficial Owners and Management" | How much stock insiders will hold at effective date |
| 5 | "Management's Discussion and Analysis" | Revenue, EBITDA, margins, cash flow — 3 years pro-forma |
| 6 | "Risk Factors" | Dependency risks, debt load, competitive position |
| 7 | "Certain Relationships and Related Person Transactions" | Ongoing parent-SpinCo contracts, transition services |
| 8 | "Capitalization" | Debt allocated to SpinCo — watch for debt-stuffing |

---

## Dashboard UX Patterns

### Feed / List View (Primary View)

Recommended card-based layout with these fields visible without clicking through:

```
[SPINOFF CARD]
├── SpinCo Name                    Parent → [SpinCo]
├── Ticker(s)                      [PARENT] → [SPINCO]
├── Signal Badge                   [BULLISH / BEARISH / NEUTRAL / PENDING]
├── Separation Date                Effective: Jun 2026 (or "Announced")
├── Key Signal Line                "CEO moved to SpinCo + equity grants confirmed"
├── Institutional Setup            "SpinCo < 20% parent size — forced selling likely"
├── AI Summary (collapsed)         [1-paragraph digest — click to expand]
└── Links                          [Form 10] [8-K] [Form 4s]
```

**Why cards over table rows:** Cards give room for the key signal line and AI summary preview. A pure table works only if sorting/filtering is the primary action — for this thesis, reading the signal narrative matters more than sorting by P/E.

### Sort / Filter Options (Daily Feed)

| Filter | Values | Rationale |
|--------|--------|-----------|
| Signal | Bullish / Bearish / Neutral / Pending | Primary filter for actionable opportunities |
| Status | Announced / Filed / Effective / Post-spin | Filters by stage in process |
| Date range | Announced in last 30/60/90 days | Focus on fresh opportunities |
| Market cap tier | < $500M / $500M–$2B / > $2B | Small-cap = most mispricing opportunity |
| Institutional mismatch | Yes / No / Unknown | Forces the indiscriminate selling setup |
| Has Form 4 buys | Yes / No | Confirms post-spin open-market conviction |
| Has rights offering | Yes / No | Greenblatt's highest-priority signal |

### Sort Priorities (Default Sort)

Default: Most recently effective date (post-spin selling pressure is most acute in first 6 months)

Secondary sorts:
1. Signal = Bullish first
2. Has Form 4 buys
3. Institutional mismatch flag

### Detail View (Per Spinoff)

Full drill-down for a single spinoff should show:

```
[DETAIL PAGE]
├── Overview Section
│   ├── Deal description (AI-generated paragraph)
│   ├── Parent / SpinCo company profiles (industry, size)
│   ├── Transaction timeline (announced → filed → effective)
│   └── Reason classification (unlock value / shed weak unit / regulatory)
│
├── Insider Signal Section
│   ├── Compensation table excerpt (from Form 10)
│   ├── Executive equity grants (stock options, RSUs, % of comp)
│   ├── Key executives who moved to SpinCo
│   ├── Form 4 transactions (table: date, person, title, shares, price, type)
│   └── Greenblatt signal verdict with explanation
│
├── Setup Context Section
│   ├── SpinCo market cap (estimated)
│   ├── SpinCo as % of parent size
│   ├── Index membership status (parent in S&P?)
│   ├── Sector mismatch flag (parent vs. SpinCo sector)
│   └── Analyst coverage status
│
├── Financial Snapshot (from Form 10 pro-forma)
│   ├── Revenue (last 3 years)
│   ├── EBITDA / operating income
│   ├── Debt load (allocated to SpinCo)
│   └── Free cash flow estimate
│
└── Source Links
    ├── SEC EDGAR Form 10
    ├── SEC EDGAR 8-K (announcement)
    ├── SEC EDGAR Form 4 filings
    └── News articles (from discovery)
```

---

## Feature Dependencies

```
Spinoff Discovery (8-K / news API)
    └── triggers → Spinoff Record Created (name, parent, date, status)
                       └── triggers → Form 10 Fetch + Parse
                                          └── enables → Reason Classification
                                          └── enables → Comp Structure Extraction
                                          └── enables → Financial Snapshot
                       └── triggers → Form 4 Monitor (new CIK watch)
                                          └── enables → Form 4 Buy Detection

All signals present → enables → Greenblatt Score
Greenblatt Score + Parsed Context → enables → AI Plain-English Summary
```

Form 4 monitoring cannot start until the SpinCo has its own EDGAR CIK (assigned at Form 10 filing or effective date).

---

## MVP Recommendation (V1 Focus)

### Must Ship (V1)

1. **Spinoff feed** — daily-refreshed list of announced and recent spinoffs with parent/SpinCo names, dates, and EDGAR links
2. **Reason classification** — "unlock value" / "shed weak unit" / "regulatory" pulled from Form 10 "Reasons" section
3. **Compensation structure flag** — Does the Form 10 show SpinCo mgmt receiving equity? (Yes / No / Pending)
4. **Management movement flag** — Did senior execs move to SpinCo? (from Form 10 management section)
5. **Institutional mismatch score** — Calculated from SpinCo size vs. parent + index membership
6. **AI summary paragraph** — Claude-generated one-para digest using Form 10 summary + reason + comp data
7. **Overall signal badge** — Bullish / Bearish / Neutral derived from above signals

### Defer to V2

- Form 4 open-market buy detection (requires ongoing EDGAR polling per CIK after effective date; adds pipeline complexity)
- Option strike price analysis (finer-grained comp parsing; valuable but non-blocking)
- Parent-as-buy flag (derived from business quality — needs more AI reasoning)
- Rights offering detection (relatively rare; adds edge cases)
- Financial snapshot tables (extracting pro-forma financials from Form 10 reliably is parsing-intensive)

### Rationale for Deferral

V1 delivers the core thesis signal at announcement time: "Is this spinoff set up for success or is the parent dumping trash?" That verdict can be formed from Form 10 text alone before the effective date and before any Form 4s are filed.

V2 adds the confirmation signal: "Are insiders putting money where their mouth is after the spin?" — which requires post-effective-date monitoring of Form 4 filings and is a separate data pipeline.

---

## Sources

- [Joel Greenblatt spinoff thesis coverage — Stock Spinoff Investing](https://stockspinoffinvesting.com/category/joel-greenblatt/)
- [3 Biggest Takeaways from Greenblatt's Special Situation Class](https://stockspinoffinvesting.com/3-biggest-takeaways-from-joel-greenblatts-special-situation-class/)
- [Greenblatt on Spin-offs — MPF on Medium](https://medium.com/@mpf/greenblatt-on-spin-offs-72cfcdbdd6d6)
- [Spin-Off Checklist — ValueBob on Medium](https://valuebob.medium.com/spin-off-checklist-7a7ceb3c1b3c)
- [Spinoffs Have Dramatically Underperformed — Boyar Research](https://boyarresearch.substack.com/p/spinoffs-have-dramatically-underperformed)
- [SEC Form 10 Filing Reference — SEC.gov](https://www.sec.gov/files/form10.pdf)
- [What is an SEC Form 10 Filing? — DFin Solutions](https://www.dfinsolutions.com/knowledge-hub/thought-leadership/knowledge-resources/sec-form-10)
- [Item 402 Executive Compensation — CFR / Legal Information Institute](https://www.law.cornell.edu/cfr/text/17/229.402)
- [Upcoming Spinoffs Tracker — InsideArbitrage](https://www.insidearbitrage.com/spinoffs/)
- [Recent Spinoffs List — Stock Analysis](https://stockanalysis.com/actions/spinoffs/)
- [Upcoming Spinoffs Calendar — StockSpinoffs.com](https://www.stockspinoffs.com/upcoming-spinoffs/)
- [Unlocking Value: The What, Why and How of Spin-offs — Gibson Dunn (May 2024)](https://www.gibsondunn.com/wp-content/uploads/2024/05/WebcastSlides-Unlocking-Value-The-What-Why-and-How-of-Spin-Offs-1-MAY-2024.pdf)
- [2025 Wachtell Lipton Spin-Off Guide](https://www.wlrk.com/wp-content/uploads/2025/05/2025-Spin-Off-Guide.pdf)
- [OpenInsider — SEC Form 4 Screener](http://openinsider.com/)
