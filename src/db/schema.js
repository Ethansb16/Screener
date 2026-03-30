import db from './db.js';

export function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS filings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      accession_number TEXT    UNIQUE NOT NULL,
      form_type        TEXT    NOT NULL,
      cik              TEXT    NOT NULL,
      company_name     TEXT    NOT NULL,
      filed_at         TEXT    NOT NULL,
      period_of_report TEXT,
      primary_doc_url  TEXT,
      raw_text         TEXT,
      fetched_at       TEXT,
      created_at       TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_filings_form_type ON filings(form_type);
    CREATE INDEX IF NOT EXISTS idx_filings_filed_at  ON filings(filed_at);
    CREATE INDEX IF NOT EXISTS idx_filings_cik       ON filings(cik);

    CREATE TABLE IF NOT EXISTS opportunities (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      filing_id        INTEGER REFERENCES filings(id),
      source_type      TEXT    NOT NULL,
      company_name     TEXT    NOT NULL,
      ticker           TEXT,
      spinoff_target   TEXT,
      signal_type      TEXT    NOT NULL,
      signal_strength  TEXT,
      summary          TEXT,
      claude_analysis  TEXT,
      raw_source_url   TEXT,
      discovered_at    TEXT    DEFAULT (datetime('now')),
      status           TEXT    DEFAULT 'new',
      UNIQUE(filing_id, signal_type)
    );

    CREATE INDEX IF NOT EXISTS idx_opportunities_signal_type   ON opportunities(signal_type);
    CREATE INDEX IF NOT EXISTS idx_opportunities_discovered_at ON opportunities(discovered_at);
    CREATE INDEX IF NOT EXISTS idx_opportunities_status        ON opportunities(status);

    CREATE TABLE IF NOT EXISTS news_items (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash         TEXT    UNIQUE NOT NULL,
      source               TEXT    NOT NULL,
      headline             TEXT    NOT NULL,
      url                  TEXT,
      published_at         TEXT,
      body_snippet         TEXT,
      companies_mentioned  TEXT,
      processed            INTEGER DEFAULT 0,
      created_at           TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_news_items_processed    ON news_items(processed);
    CREATE INDEX IF NOT EXISTS idx_news_items_published_at ON news_items(published_at);

    CREATE TABLE IF NOT EXISTS run_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at          TEXT    NOT NULL,
      finished_at         TEXT,
      status              TEXT,
      filings_fetched     INTEGER DEFAULT 0,
      opportunities_added INTEGER DEFAULT 0,
      error_message       TEXT
    );

    CREATE TABLE IF NOT EXISTS signals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      filing_id    INTEGER NOT NULL REFERENCES filings(id),
      signal_name  TEXT    NOT NULL,
      classification TEXT,
      confidence   TEXT,
      raw_excerpt  TEXT,
      extracted_at TEXT DEFAULT (datetime('now')),
      UNIQUE(filing_id, signal_name)
    );
    CREATE INDEX IF NOT EXISTS idx_signals_filing_id ON signals(filing_id);
    CREATE INDEX IF NOT EXISTS idx_signals_signal_name ON signals(signal_name);
  `);
}
