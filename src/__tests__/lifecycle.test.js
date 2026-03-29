import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Save original fetch
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

// Helper: build a minimal submissions response with given form types
function makeSubmissionsResponse(forms) {
  return {
    filings: {
      recent: {
        form: forms,
        filingDate: forms.map((_, i) => `2025-0${(i % 9) + 1}-01`),
        accessionNumber: forms.map((_, i) => `0001234567-25-00000${i}`),
      },
    },
  };
}

// ─── checkLifecycle tests ────────────────────────────────────────────────────

test('DISC-03: checkLifecycle returns confirmed when submissions contain an EFFECT form', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeSubmissionsResponse(['10-12B', 'EFFECT'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const { checkLifecycle } = await import('../ingestion/lifecycleChecker.js?v=1');
  const result = await checkLifecycle('0001603978');
  assert.equal(result, 'confirmed');
});

test('DISC-03: checkLifecycle returns withdrawn when submissions contain an RW form', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeSubmissionsResponse(['10-12B', 'RW'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const { checkLifecycle } = await import('../ingestion/lifecycleChecker.js?v=2');
  const result = await checkLifecycle('0001603978');
  assert.equal(result, 'withdrawn');
});

test('DISC-03: checkLifecycle returns null when submissions contain neither EFFECT nor RW', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeSubmissionsResponse(['10-12B', '10-12B/A'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const { checkLifecycle } = await import('../ingestion/lifecycleChecker.js?v=3');
  const result = await checkLifecycle('0001603978');
  assert.equal(result, null);
});

test('DISC-03: checkLifecycle builds the correct submissions URL with zero-padded CIK', async () => {
  let capturedUrl = '';

  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify(makeSubmissionsResponse(['10-12B'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { checkLifecycle } = await import('../ingestion/lifecycleChecker.js?v=4');
  await checkLifecycle('0001603978');
  assert.equal(capturedUrl, 'https://data.sec.gov/submissions/CIK0001603978.json');
});

test('DISC-03: checkLifecycle handles columnar array structure correctly', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        filings: {
          recent: {
            form: ['10-12B', 'EFFECT'],
            filingDate: ['2025-01-01', '2025-06-01'],
            accessionNumber: ['0001234567-25-000001', '0001234567-25-000002'],
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );

  const { checkLifecycle } = await import('../ingestion/lifecycleChecker.js?v=5');
  const result = await checkLifecycle('0001603978');
  assert.equal(result, 'confirmed');
});

// ─── runPersist tests (DB integration) ───────────────────────────────────────

// Helper: set up schema in a real DB instance
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

// Insert a filing + opportunity row and return the opportunity id
function insertTestCandidate(db, { accession, cik, company = 'TestCo' } = {}) {
  const fResult = db.prepare(`
    INSERT INTO filings (accession_number, form_type, cik, company_name, filed_at)
    VALUES (?, '10-12B', ?, ?, '2025-03-01')
  `).run(accession, cik, company);
  const filingId = fResult.lastInsertRowid;

  const oResult = db.prepare(`
    INSERT INTO opportunities (filing_id, source_type, company_name, signal_type, status)
    VALUES (?, 'edgar', ?, '10-12B', 'new')
  `).run(filingId, company);
  return oResult.lastInsertRowid;
}

test('DISC-03: runPersist updates opportunity status to confirmed when checkLifecycle returns confirmed', async () => {
  // Use the real singleton DB (initialized via schema) and clean up after
  const { default: db } = await import('../db/db.js?v=lc1');
  const { initializeSchema } = await import('../db/schema.js?v=lc1');
  initializeSchema();

  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeSubmissionsResponse(['EFFECT'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const accession = 'TEST-LC-CONFIRMED-001';
  const cik = '0001111111';
  const oppId = insertTestCandidate(db, { accession, cik });

  const { runPersist } = await import('../pipeline/stages/persist.js?v=lc1');
  await runPersist([]);

  const row = db.prepare('SELECT status FROM opportunities WHERE id = ?').get(oppId);
  assert.equal(row.status, 'confirmed');

  // Cleanup
  db.prepare('DELETE FROM opportunities WHERE id = ?').run(oppId);
  db.prepare('DELETE FROM filings WHERE accession_number = ?').run(accession);
});

test('DISC-03: runPersist updates opportunity status to withdrawn when checkLifecycle returns withdrawn', async () => {
  const { default: db } = await import('../db/db.js?v=lc2');
  const { initializeSchema } = await import('../db/schema.js?v=lc2');
  initializeSchema();

  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeSubmissionsResponse(['RW'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const accession = 'TEST-LC-WITHDRAWN-001';
  const cik = '0001222222';
  const oppId = insertTestCandidate(db, { accession, cik });

  const { runPersist } = await import('../pipeline/stages/persist.js?v=lc2');
  await runPersist([]);

  const row = db.prepare('SELECT status FROM opportunities WHERE id = ?').get(oppId);
  assert.equal(row.status, 'withdrawn');

  // Cleanup
  db.prepare('DELETE FROM opportunities WHERE id = ?').run(oppId);
  db.prepare('DELETE FROM filings WHERE accession_number = ?').run(accession);
});

test('DISC-03: runPersist leaves status=new when checkLifecycle returns null', async () => {
  const { default: db } = await import('../db/db.js?v=lc3');
  const { initializeSchema } = await import('../db/schema.js?v=lc3');
  initializeSchema();

  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeSubmissionsResponse(['10-12B', '10-12B/A'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const accession = 'TEST-LC-NOOP-001';
  const cik = '0001333333';
  const oppId = insertTestCandidate(db, { accession, cik });

  const { runPersist } = await import('../pipeline/stages/persist.js?v=lc3');
  await runPersist([]);

  const row = db.prepare('SELECT status FROM opportunities WHERE id = ?').get(oppId);
  assert.equal(row.status, 'new');

  // Cleanup
  db.prepare('DELETE FROM opportunities WHERE id = ?').run(oppId);
  db.prepare('DELETE FROM filings WHERE accession_number = ?').run(accession);
});

test('DISC-03: runPersist processes ALL existing new opportunities, not just newly discovered ones', async () => {
  const { default: db } = await import('../db/db.js?v=lc4');
  const { initializeSchema } = await import('../db/schema.js?v=lc4');
  initializeSchema();

  globalThis.fetch = async () =>
    new Response(JSON.stringify(makeSubmissionsResponse(['EFFECT'])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const acc1 = 'TEST-LC-MULTI-001';
  const acc2 = 'TEST-LC-MULTI-002';
  const cik1 = '0001444444';
  const cik2 = '0001555555';

  const oppId1 = insertTestCandidate(db, { accession: acc1, cik: cik1, company: 'MultiCo1' });
  const oppId2 = insertTestCandidate(db, { accession: acc2, cik: cik2, company: 'MultiCo2' });

  const { runPersist } = await import('../pipeline/stages/persist.js?v=lc4');
  await runPersist([]); // pass empty array — must still process all existing 'new' opps

  const row1 = db.prepare('SELECT status FROM opportunities WHERE id = ?').get(oppId1);
  const row2 = db.prepare('SELECT status FROM opportunities WHERE id = ?').get(oppId2);
  assert.equal(row1.status, 'confirmed');
  assert.equal(row2.status, 'confirmed');

  // Cleanup
  db.prepare('DELETE FROM opportunities WHERE id IN (?, ?)').run(oppId1, oppId2);
  db.prepare('DELETE FROM filings WHERE accession_number IN (?, ?)').run(acc1, acc2);
});
