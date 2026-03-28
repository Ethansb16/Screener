# Spinoff Screener

## What This Is

A personal financial news skimmer that surfaces corporate spinoff announcements, analyzes whether insiders are being rewarded with stock in the new entity or discarding a weak business unit, and delivers a daily feed of opportunities worth investigating. Built for one user making their own investment decisions.

## Core Value

Quickly identify spinoffs where insiders are incentivized to succeed — before the broader market prices it in.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Detect spinoff announcements by cross-referencing financial news APIs and SEC filings (Form 10, 8-K)
- [ ] Analyze insider signals: SEC Form 4 filings for executive buying, and whether key players are receiving stock in the spun-off entity
- [ ] Distinguish quality signal: management rewarded with spinoff equity (bullish) vs. divesting an underperforming unit (bearish)
- [ ] Daily refresh cycle — new spinoffs and updated insider activity surfaced each morning
- [ ] Dashboard/feed UI — browsable list of active spinoff opportunities with key signal data
- [ ] AI-generated plain-English summary per spinoff explaining the opportunity and red flags

### Out of Scope

- Real-time / intraday alerts — daily refresh is sufficient for this investment style
- Multi-user accounts or sharing — personal tool only
- General stock screener features (earnings, technicals, etc.) — spinoff thesis only
- Automated trading or position management — research only

## Context

- Investment thesis is based on Joel Greenblatt's spinoff playbook: spinoffs are often overlooked, institutional sellers create mispricing, and insider incentives are the key signal separating good from bad.
- Two core insider signals to detect: (1) executives/directors buying via Form 4 filings, (2) management receiving equity grants in the new entity (reward structure = aligned incentives).
- Existing codebase has a `claude` npm dependency — Claude AI is the intended engine for summarization and signal analysis.
- Data pipeline: news APIs for fast discovery → SEC EDGAR for authoritative filing data → Claude for analysis and verdict.

## Constraints

- **Solo use**: No auth, no multi-tenancy — keep it simple
- **Data**: SEC EDGAR is free/authoritative; financial news APIs may require keys (NewsAPI, Benzinga, Alpha Vantage)
- **Cost**: Claude API calls per spinoff — keep prompts efficient; batch where possible

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Claude as AI engine | Already in package.json; good at financial text summarization | — Pending |
| Daily refresh over real-time | Spinoff investing is not a day-trading thesis — daily is sufficient | — Pending |
| Insider signal focus for v1 | Full AI verdict is v2; insider signals + discovery is the minimum useful version | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after initialization*
