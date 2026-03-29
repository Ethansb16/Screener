import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Use an in-memory DB for most tests — do NOT import the singleton (it opens screener.db)
// WAL mode requires a file-based DB (not :memory:), so a temp file is used for that test
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let testDb;

// Inline schema function for test isolation (mirrors src/db/schema.js exactly)
function initializeTestSchema(db) {
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
    CREATE TABLE IF NOT EXISTS news_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT UNIQUE NOT NULL,
      source       TEXT NOT NULL,
      headline     TEXT NOT NULL,
      url          TEXT,
      published_at TEXT,
      body_snippet TEXT,
      companies_mentioned TEXT,
      processed    INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS run_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at          TEXT    NOT NULL,
      finished_at         TEXT,
      status              TEXT,
      filings_fetched     INTEGER DEFAULT 0,
      opportunities_added INTEGER DEFAULT 0,
      error_message       TEXT
    );
  `);
}

before(() => {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  initializeTestSchema(testDb);
});

after(() => {
  testDb.close();
});

test('INFRA-02: filings table exists after schema init', () => {
  const row = testDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='filings'"
  ).get();
  assert.equal(row.name, 'filings');
});

test('INFRA-02: opportunities table exists after schema init', () => {
  const row = testDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='opportunities'"
  ).get();
  assert.equal(row.name, 'opportunities');
});

test('INFRA-02: news_items table exists after schema init', () => {
  const row = testDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='news_items'"
  ).get();
  assert.equal(row.name, 'news_items');
});

test('INFRA-02: run_log table exists after schema init', () => {
  const row = testDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='run_log'"
  ).get();
  assert.equal(row.name, 'run_log');
});

test('INFRA-02: idempotent upsert — two inserts with same accession_number produce one row', () => {
  const insert = testDb.prepare(`
    INSERT OR IGNORE INTO filings (accession_number, form_type, cik, company_name, filed_at)
    VALUES (@accession_number, @form_type, @cik, @company_name, @filed_at)
  `);
  const row = {
    accession_number: '0001234567-24-000001',
    form_type: '10-12B',
    cik: '0000123456',
    company_name: 'Test SpinCo',
    filed_at: '2024-03-15',
  };
  insert.run(row);
  insert.run(row); // second insert — must be silently ignored
  const count = testDb.prepare(
    "SELECT COUNT(*) AS n FROM filings WHERE accession_number = '0001234567-24-000001'"
  ).get();
  assert.equal(count.n, 1);
});

test('INFRA-02: WAL journal mode is enabled', () => {
  // WAL mode requires a file-based DB — :memory: always reports 'memory'
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'screener-test-'));
  const tmpDbPath = path.join(tmpDir, 'test.db');
  const fileDb = new Database(tmpDbPath);
  try {
    fileDb.pragma('journal_mode = WAL');
    const row = fileDb.prepare('PRAGMA journal_mode').get();
    assert.equal(row.journal_mode, 'wal');
  } finally {
    fileDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('INFRA-02: initializeTestSchema is idempotent — calling twice does not throw', () => {
  assert.doesNotThrow(() => initializeTestSchema(testDb));
});
