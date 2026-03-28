# Roadmap: Spinoff Screener

## Overview

Five phases build the Spinoff Screener from the ground up. Phase 1 establishes the EDGAR client, database schema, and pipeline skeleton — the foundation every subsequent phase runs on. Phase 2 wires in EDGAR EFTS discovery and deal classification so the feed populates with real candidates. Phase 3 extracts the four Form 10 signals (the highest-risk work in the project). Phase 4 integrates Claude Batch API to generate plain-English summaries and red flag callouts. Phase 5 surfaces everything in an HTMX/Express dashboard. Each phase delivers a complete, independently verifiable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - EDGAR client, SQLite schema, cron scheduler, and pipeline shell
- [ ] **Phase 2: Discovery** - EDGAR EFTS spinoff detection, deal classification, and lifecycle state tracking
- [ ] **Phase 3: Signal Extraction** - Form 10 parsing for all four V1 signals
- [ ] **Phase 4: AI Analysis** - Claude Batch API integration for summaries and red flag generation
- [ ] **Phase 5: Dashboard** - Express + HTMX feed and detail views

## Phase Details

### Phase 1: Foundation
**Goal**: The pipeline infrastructure is in place — EDGAR is reachable, data is stored idempotently, and the cron runs daily
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04
**Success Criteria** (what must be TRUE):
  1. An EDGAR request sent through the client includes the correct User-Agent header and is throttled to no more than 8 requests per second
  2. Running the pipeline twice with the same EDGAR response produces exactly one record in the database (idempotent upsert)
  3. The cron scheduler fires the pipeline automatically at the configured time and writes a completion entry to the run_log table
  4. The four pipeline stages (discover, extract, analyze, persist) execute sequentially and each stage can be run independently for testing
**Plans**: TBD

### Phase 2: Discovery
**Goal**: The system populates a daily-refreshed list of spinoff candidates from EDGAR, each with deal type and lifecycle status
**Depends on**: Phase 1
**Requirements**: DISC-01, DISC-02, DISC-03
**Success Criteria** (what must be TRUE):
  1. After a pipeline run, the database contains Form 10-12B and spinoff-related 8-K filings discovered from EDGAR EFTS within the last 24 hours
  2. Each discovered event is classified as spinoff, carve-out, divestiture, or split-off — only true spinoffs are promoted past the candidate stage
  3. A spinoff record moves from Candidate to Confirmed when the Form 10-12B/A amendment progression confirms effectiveness, and can transition to Withdrawn if the deal is pulled
**Plans**: TBD

### Phase 3: Signal Extraction
**Goal**: For each spinoff candidate, the system extracts four structured signals from the Form 10 text
**Depends on**: Phase 2
**Requirements**: SIG-01, SIG-02, SIG-03, SIG-04
**Success Criteria** (what must be TRUE):
  1. The system extracts and stores a reason classification (strategic focus vs. disposal of weak unit) from the "Reasons for the Distribution" section of the Form 10
  2. The system detects and stores whether SpinCo management is receiving equity grants in the new entity
  3. The system detects and stores whether excessive debt is loaded onto SpinCo based on the capitalization section
  4. The system detects and stores whether strong leaders are moving to SpinCo or remaining at parent
**Plans**: TBD

### Phase 4: AI Analysis
**Goal**: Each spinoff opportunity has a Claude-generated plain-English summary that explains the thesis and explicitly calls out red flags
**Depends on**: Phase 3
**Requirements**: AI-01, AI-02, AI-03
**Success Criteria** (what must be TRUE):
  1. Each spinoff with extracted signals has a stored plain-English summary explaining what happened and the opportunity thesis
  2. Each summary explicitly names any detected red flags (debt stuffing, management exodus, weak-unit disposal language)
  3. Claude is invoked via the Batch API with prompt caching, and opportunities with an existing claude_analysis are never re-sent — confirmed by a daily run that does not re-bill already-processed records
**Plans**: TBD

### Phase 5: Dashboard
**Goal**: Users can browse the spinoff feed and drill into any opportunity to see its full signal breakdown and AI summary
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02
**Success Criteria** (what must be TRUE):
  1. Opening the dashboard shows a browsable list of spinoff opportunities with company names, deal type, status, and a top signal indicator visible without clicking anything
  2. Clicking a spinoff opens a detail view with the full signal breakdown (all four V1 signals) and the Claude AI summary including red flag callouts
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/TBD | Not started | - |
| 2. Discovery | 0/TBD | Not started | - |
| 3. Signal Extraction | 0/TBD | Not started | - |
| 4. AI Analysis | 0/TBD | Not started | - |
| 5. Dashboard | 0/TBD | Not started | - |
