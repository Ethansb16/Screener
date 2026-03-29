import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Tests 1–5: classifyDeal pure logic (no DB needed)
// ---------------------------------------------------------------------------

test('DISC-02: classifyDeal returns "spinoff" for a 10-12B hit with no exchange offer language', async () => {
  const { classifyDeal } = await import('../ingestion/classifyDeal.js');

  const hit = {
    _source: {
      form: '10-12B',
      display_names: ['Acme SpinCo (ACME) (CIK 0001234567)'],
    },
  };

  assert.equal(classifyDeal(hit), 'spinoff');
});

test('DISC-02: classifyDeal returns "split-off" for a 10-12B hit where display_names contains "exchange offer"', async () => {
  const { classifyDeal } = await import('../ingestion/classifyDeal.js?v=2');

  const hit = {
    _source: {
      form: '10-12B',
      display_names: ['Acme Corp exchange offer separation (CIK 0001234567)'],
    },
  };

  assert.equal(classifyDeal(hit), 'split-off');
});

test('DISC-02: classifyDeal returns "spinoff" for a 10-12B/A amendment hit', async () => {
  const { classifyDeal } = await import('../ingestion/classifyDeal.js?v=3');

  const hit = {
    _source: {
      form: '10-12B/A',
      display_names: ['Beta SpinCo LLC (CIK 0001234567)'],
    },
  };

  assert.equal(classifyDeal(hit), 'spinoff');
});

test('DISC-02: classifyDeal returns "pending_classification" for an 8-K hit', async () => {
  const { classifyDeal } = await import('../ingestion/classifyDeal.js?v=4');

  const hit = {
    _source: {
      form: '8-K',
      display_names: ['Some Corp (CIK 0009999999)'],
    },
  };

  assert.equal(classifyDeal(hit), 'pending_classification');
});

test('DISC-02: classifyDeal returns "divestiture" for an unknown form type', async () => {
  const { classifyDeal } = await import('../ingestion/classifyDeal.js?v=5');

  const hit = {
    _source: {
      form: 'S-1',
      display_names: ['Some Carve Co (CIK 0009999998)'],
    },
  };

  assert.equal(classifyDeal(hit), 'divestiture');
});

// ---------------------------------------------------------------------------
// Tests 6–8: insertOpportunity — needs in-memory DB wired into the module
// ---------------------------------------------------------------------------

// Schema helper replicating the real schema for opportunities + filings
function setupSchema(db) {
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
  `);
}

// A sample 10-12B hit used by tests 6–8
const sampleHit = {
  _source: {
    adsh: '0001111111-25-000001',
    form: '10-12B',
    ciks: ['0001111111'],
    display_names: ['Test SpinCo Inc (TSCO) (CIK 0001111111)'],
    file_date: '2025-03-27',
    period_ending: null,
  },
};

test('DISC-02: insertOpportunity inserts a row in opportunities for a spinoff filing', async () => {
  const { default: db } = await import('../db/db.js?v=opp1');
  const { initializeSchema } = await import('../db/schema.js?v=opp1');
  initializeSchema();

  const { insertOpportunity } = await import('../ingestion/edgarIngester.js?v=opp1');

  // Clean up any pre-existing rows from prior test runs
  db.prepare("DELETE FROM filings WHERE accession_number = '0001111111-25-000001'").run();

  // Insert a parent filings row directly so we have a valid filing_id
  const filing = db.prepare(`
    INSERT INTO filings
      (accession_number, form_type, cik, company_name, filed_at, primary_doc_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('0001111111-25-000001', '10-12B', '0001111111', 'Test SpinCo Inc', '2025-03-27', 'https://www.sec.gov/Archives/edgar/data/1111111/000111111125000001/');

  const filingId = Number(filing.lastInsertRowid);
  assert.ok(filingId > 0, 'Expected positive filingId');

  const oppId = insertOpportunity(filingId, sampleHit, 'spinoff');

  const rows = db.prepare('SELECT * FROM opportunities WHERE filing_id = ?').all(filingId);
  assert.equal(rows.length, 1, 'Expected exactly 1 opportunity row');
  assert.equal(rows[0].signal_type, 'form_10', 'Expected signal_type = form_10 for spinoff');
  assert.equal(rows[0].status, 'new', 'Expected status = new');

  // Cleanup
  db.prepare('DELETE FROM opportunities WHERE filing_id = ?').run(filingId);
  db.prepare("DELETE FROM filings WHERE accession_number = '0001111111-25-000001'").run();
});

test('DISC-02: insertOpportunity is idempotent — second call for same filing_id and signal_type inserts nothing', async () => {
  const { default: db } = await import('../db/db.js?v=opp2');
  const { initializeSchema } = await import('../db/schema.js?v=opp2');
  initializeSchema();

  const { insertOpportunity } = await import('../ingestion/edgarIngester.js?v=opp2');

  db.prepare("DELETE FROM filings WHERE accession_number = '0001111111-25-000002'").run();

  const filing = db.prepare(`
    INSERT INTO filings
      (accession_number, form_type, cik, company_name, filed_at, primary_doc_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('0001111111-25-000002', '10-12B', '0001111111', 'Test SpinCo Inc', '2025-03-27', 'https://www.sec.gov/Archives/');

  const filingId = Number(filing.lastInsertRowid);

  const hitForTest = {
    _source: {
      ...sampleHit._source,
      adsh: '0001111111-25-000002',
    },
  };

  insertOpportunity(filingId, hitForTest, 'spinoff');
  insertOpportunity(filingId, hitForTest, 'spinoff'); // second call — should be ignored

  const count = db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE filing_id = ?').get(filingId).n;
  assert.equal(count, 1, 'Expected exactly 1 opportunity after two identical calls');

  // Cleanup
  db.prepare('DELETE FROM opportunities WHERE filing_id = ?').run(filingId);
  db.prepare("DELETE FROM filings WHERE accession_number = '0001111111-25-000002'").run();
});

test('DISC-02: insertOpportunity does NOT insert for deal type "carve_out"', async () => {
  const { default: db } = await import('../db/db.js?v=opp3');
  const { initializeSchema } = await import('../db/schema.js?v=opp3');
  initializeSchema();

  const { insertOpportunity } = await import('../ingestion/edgarIngester.js?v=opp3');

  db.prepare("DELETE FROM filings WHERE accession_number = '0001111111-25-000003'").run();

  const filing = db.prepare(`
    INSERT INTO filings
      (accession_number, form_type, cik, company_name, filed_at, primary_doc_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('0001111111-25-000003', '10-12B', '0001111111', 'Test SpinCo Inc', '2025-03-27', 'https://www.sec.gov/Archives/');

  const filingId = Number(filing.lastInsertRowid);

  const hitForTest = {
    _source: {
      ...sampleHit._source,
      adsh: '0001111111-25-000003',
    },
  };

  insertOpportunity(filingId, hitForTest, 'carve_out');

  const count = db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE filing_id = ?').get(filingId).n;
  assert.equal(count, 0, 'Expected 0 opportunities for carve_out deal type');

  // Cleanup
  db.prepare('DELETE FROM opportunities WHERE filing_id = ?').run(filingId);
  db.prepare("DELETE FROM filings WHERE accession_number = '0001111111-25-000003'").run();
});
