# Requirements: Spinoff Screener

**Defined:** 2026-03-28
**Core Value:** Quickly identify spinoffs where insiders are incentivized to succeed — before the broader market prices it in.

## v1 Requirements

### Infrastructure

- [x] **INFRA-01**: EDGAR client sends requests with required User-Agent header and enforces ≤8 req/s rate limit
- [x] **INFRA-02**: SQLite database stores spinoff records with idempotent upsert (no duplicate filings on re-run)
- [x] **INFRA-03**: Daily cron job runs pipeline automatically at a configurable time each morning
- [x] **INFRA-04**: Pipeline shell executes stages sequentially: discover → extract signals → analyze → persist

### Discovery

- [x] **DISC-01**: System scans SEC EDGAR EFTS daily for Form 10-12B and spinoff-related 8-K filings
- [x] **DISC-02**: System classifies each event as true spinoff, carve-out, divestiture, or split-off — only true spinoffs proceed through the pipeline
- [x] **DISC-03**: Each spinoff record tracks lifecycle state: Candidate (announced) → Confirmed (effective) → Withdrawn

### Signal Extraction

- [ ] **SIG-01**: System extracts reason classification from Form 10 "Reasons for the Distribution" section — strategic focus vs. disposal of weak unit
- [ ] **SIG-02**: System detects whether SpinCo management is receiving equity grants in the new entity (bullish alignment signal)
- [ ] **SIG-03**: System checks capitalization section for evidence of excessive debt loaded onto SpinCo (bearish debt-stuffing signal)
- [ ] **SIG-04**: System identifies whether strong leaders are moving to SpinCo or remaining at parent (management continuity signal)

### AI Analysis

- [ ] **AI-01**: Claude generates a plain-English summary of each spinoff explaining what happened and the opportunity thesis
- [ ] **AI-02**: Claude explicitly calls out red flags (debt stuffing, management exodus, weak-unit disposal language) in each summary
- [ ] **AI-03**: Claude API integration uses Batch API and prompt caching to minimize cost on daily batch runs

### Dashboard

- [ ] **DASH-01**: Web dashboard displays a browsable feed of spinoff opportunities with key signals visible at a glance (company names, deal type, status, top signal indicator)
- [ ] **DASH-02**: Each spinoff has a detail view showing full signal breakdown and the Claude AI summary with red flag callouts

## v2 Requirements

### Discovery Expansion

- **DISC-V2-01**: Cross-reference EDGAR discoveries against Finnhub news API for additional context and confirmation
- **DISC-V2-02**: Form 4 post-effective-date monitoring — track open-market insider buying after SpinCo begins trading

### Dashboard Enhancements

- **DASH-V2-01**: Greenblatt verdict badge (Bullish / Bearish / Unclear) per spinoff based on composite signal score
- **DASH-V2-02**: Filter feed by verdict or signal type
- **DASH-V2-03**: Pipeline run log — see when last refresh ran and what was discovered

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time / intraday alerts | Daily refresh sufficient for spinoff investing thesis; real-time adds complexity without edge |
| Multi-user accounts / auth | Personal tool — no login needed |
| General stock screener (earnings, technicals) | Spinoff thesis only; feature creep risk |
| Automated trading / position tracking | Research tool only |
| Mobile app | Web dashboard is sufficient for solo daily use |
| Paid financial data APIs (Bloomberg, Refinitiv) | SEC EDGAR is free and authoritative; Finnhub free tier sufficient |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| DISC-01 | Phase 2 | Complete |
| DISC-02 | Phase 2 | Complete |
| DISC-03 | Phase 2 | Complete |
| SIG-01 | Phase 3 | Pending |
| SIG-02 | Phase 3 | Pending |
| SIG-03 | Phase 3 | Pending |
| SIG-04 | Phase 3 | Pending |
| AI-01 | Phase 4 | Pending |
| AI-02 | Phase 4 | Pending |
| AI-03 | Phase 4 | Pending |
| DASH-01 | Phase 5 | Pending |
| DASH-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 after initial definition*
