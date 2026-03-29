import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// In-memory DB for test isolation
let testDb;

// Save original fetch
const originalFetch = globalThis.fetch;

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
  `);
}

before(() => {
  testDb = new Database(':memory:');
  setupSchema(testDb);
});

after(() => {
  globalThis.fetch = originalFetch;
  testDb.close();
});

// Sample EFTS hits for reuse across tests
const sampleHit1 = {
  _id: '0001193125-16-760799:form10.htm',
  _source: {
    adsh: '0001193125-16-760799',
    form: '10-12B',
    root_form: '10-12B',
    ciks: ['0001603978'],
    display_names: ['Acme SpinCo Inc (ACME) (CIK 0001603978)'],
    file_date: '2025-03-27',
    period_ending: null,
    file_num: ['001-36426'],
  },
};

const sampleHit2 = {
  _id: '0001234567-25-000001:form10.htm',
  _source: {
    adsh: '0001234567-25-000001',
    form: '10-12B/A',
    root_form: '10-12B',
    ciks: ['0001234567'],
    display_names: ['Beta SpinCo LLC (CIK 0001234567)'],
    file_date: '2025-03-27',
    period_ending: '2025-03-31',
    file_num: [],
  },
};

function makeMockEFTSResponse(hits) {
  return {
    hits: {
      total: { value: hits.length },
      hits,
    },
  };
}

test('DISC-01: queryEFTSSpinoffs returns array of hits for 10-12B forms', async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify(makeMockEFTSResponse([sampleHit1, sampleHit2])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { queryEFTSSpinoffs } = await import('../ingestion/edgarIngester.js?v=1');
  const result = await queryEFTSSpinoffs();

  assert.equal(result.length, 2);
  assert.equal(result[0]._source.adsh, '0001193125-16-760799');
});

test('DISC-01: queryEFTSSpinoffs includes startdt=yesterday and enddt=today in URL', async () => {
  let capturedUrl = '';

  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return new Response(JSON.stringify(makeMockEFTSResponse([sampleHit1])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { queryEFTSSpinoffs } = await import('../ingestion/edgarIngester.js?v=2');
  await queryEFTSSpinoffs();

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  assert.ok(capturedUrl.includes('dateRange=custom'), `URL missing dateRange=custom: ${capturedUrl}`);
  assert.ok(capturedUrl.includes(`startdt=${yesterday}`), `URL missing startdt=${yesterday}: ${capturedUrl}`);
  assert.ok(capturedUrl.includes(`enddt=${today}`), `URL missing enddt=${today}: ${capturedUrl}`);
  // forms param should be present (URL-encoded or raw)
  assert.ok(
    capturedUrl.includes('forms=10-12B') || capturedUrl.includes('forms=10-12B%2C'),
    `URL missing forms filter: ${capturedUrl}`
  );
});

test('DISC-01: insertFiling inserts one row and returns the sqlite row id', async () => {
  // Use testDb directly — we need to point insertFiling at the in-memory DB
  // Import edgarIngester with a fresh v= so it gets a fresh module
  const { insertFiling } = await import('../ingestion/edgarIngester.js?v=3');

  // Swap in-memory DB so insertFiling uses testDb
  // edgarIngester imports db singleton — we test by calling directly and checking testDb
  // Since we can't swap the singleton, call insertFiling and then check the REAL db
  // Instead, we verify the return value and query the actual singleton DB
  const { default: db } = await import('../db/db.js?v=1');
  const { initializeSchema } = await import('../db/schema.js?v=1');
  initializeSchema();

  const countBefore = db.prepare('SELECT COUNT(*) AS n FROM filings').get().n;

  const rowId = insertFiling(sampleHit1);

  assert.ok(typeof rowId === 'bigint' || typeof rowId === 'number', `Expected rowId to be a number, got ${typeof rowId}`);
  assert.ok(rowId > 0n || rowId > 0, `Expected positive rowId, got ${rowId}`);

  const rows = db.prepare('SELECT * FROM filings WHERE accession_number = ?').all('0001193125-16-760799');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accession_number, '0001193125-16-760799');
  assert.equal(rows[0].company_name, 'Acme SpinCo Inc');

  // Cleanup
  db.prepare('DELETE FROM filings WHERE accession_number = ?').run('0001193125-16-760799');
  // Restore count
  const countAfter = db.prepare('SELECT COUNT(*) AS n FROM filings').get().n;
  assert.equal(countAfter, countBefore);
});

test('DISC-01: insertFiling is idempotent — second call inserts nothing (INSERT OR IGNORE)', async () => {
  const { insertFiling } = await import('../ingestion/edgarIngester.js?v=4');
  const { default: db } = await import('../db/db.js?v=2');
  const { initializeSchema } = await import('../db/schema.js?v=2');
  initializeSchema();

  const hit = {
    _id: '0009999999-25-000001:form.htm',
    _source: {
      adsh: '0009999999-25-000001',
      form: '10-12B',
      ciks: ['0009999999'],
      display_names: ['IdempotentCo (IDEM) (CIK 0009999999)'],
      file_date: '2025-03-27',
      period_ending: null,
    },
  };

  insertFiling(hit);
  insertFiling(hit); // second call — should be ignored

  const count = db.prepare(
    "SELECT COUNT(*) AS n FROM filings WHERE accession_number = '0009999999-25-000001'"
  ).get().n;
  assert.equal(count, 1, 'Expected exactly 1 row after two insertFiling calls with same accession_number');

  // Cleanup
  db.prepare("DELETE FROM filings WHERE accession_number = '0009999999-25-000001'").run();
});

test('DISC-01: runDiscover returns array of inserted filing ids', async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify(makeMockEFTSResponse([sampleHit1, sampleHit2])), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { runDiscover } = await import('../pipeline/stages/discover.js?v=1');
  const result = await runDiscover();

  assert.ok(Array.isArray(result), `Expected array, got ${typeof result}`);
  assert.equal(result.length, 2, `Expected 2 inserted ids, got ${result.length}`);

  // Cleanup inserted rows
  const { default: db } = await import('../db/db.js?v=3');
  db.prepare("DELETE FROM filings WHERE accession_number IN ('0001193125-16-760799','0001234567-25-000001')").run();
});

test('DISC-01: runDiscover with empty EFTS response returns empty array', async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { runDiscover } = await import('../pipeline/stages/discover.js?v=2');
  const result = await runDiscover();

  assert.deepEqual(result, []);
});
