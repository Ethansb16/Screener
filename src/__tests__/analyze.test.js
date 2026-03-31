import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// DB setup for AI analysis tests
// ---------------------------------------------------------------------------

let db;
let testOppId;
let testFilingId;

before(async () => {
  const { default: dbSingleton } = await import('../db/db.js?v=20');
  const { initializeSchema } = await import('../db/schema.js?v=20');
  db = dbSingleton;
  initializeSchema();

  // Clean up any leftover test data
  db.prepare("DELETE FROM signals WHERE filing_id IN (SELECT id FROM filings WHERE accession_number = 'TEST-AI-000001')").run();
  db.prepare("DELETE FROM opportunities WHERE filing_id IN (SELECT id FROM filings WHERE accession_number = 'TEST-AI-000001')").run();
  db.prepare("DELETE FROM filings WHERE accession_number = 'TEST-AI-000001'").run();

  // Insert a test filing row
  const filingResult = db.prepare(
    "INSERT INTO filings (accession_number, form_type, cik, company_name, filed_at) VALUES ('TEST-AI-000001', '10-12B', '0000099999', 'TestParent Corp', '2025-06-01')"
  ).run();
  testFilingId = Number(filingResult.lastInsertRowid);

  // Insert a test opportunity row
  const oppResult = db.prepare(
    'INSERT INTO opportunities (filing_id, source_type, company_name, signal_type) VALUES (?, ?, ?, ?)'
  ).run(testFilingId, 'edgar', 'TestParent Corp', 'spinoff');
  testOppId = Number(oppResult.lastInsertRowid);

  // Insert four signal rows
  const insertSignal = db.prepare(
    'INSERT INTO signals (filing_id, signal_name, classification, confidence) VALUES (?, ?, ?, ?)'
  );
  insertSignal.run(testFilingId, 'reason_classification', 'strategic_focus', 'high');
  insertSignal.run(testFilingId, 'equity_grants', 'equity_grants_confirmed', 'medium');
  insertSignal.run(testFilingId, 'debt_loading', 'no_debt_concern', 'low');
  insertSignal.run(testFilingId, 'management_continuity', 'strong_leaders_moving', 'high');
});

after(() => {
  if (db && testFilingId) {
    db.prepare('DELETE FROM signals WHERE filing_id = ?').run(testFilingId);
    db.prepare('DELETE FROM opportunities WHERE filing_id = ?').run(testFilingId);
    db.prepare('DELETE FROM filings WHERE id = ?').run(testFilingId);
  }
});

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function makeMockClient({ batchId = 'msgbatch_test_01', results = [], createCalled = null } = {}) {
  return {
    messages: {
      batches: {
        create: async (params) => {
          if (createCalled) createCalled.called = true;
          if (createCalled) createCalled.params = params;
          return { id: batchId, processing_status: 'in_progress' };
        },
        retrieve: async () => ({ processing_status: 'ended' }),
        results: async () => {
          async function* gen() { yield* results; }
          return gen();
        }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// AI Analysis tests
// ---------------------------------------------------------------------------

describe('AI Analysis', () => {

  // AI-01: analyzeOpportunities writes claude_analysis to DB
  test('AI-01: analyzeOpportunities writes claude_analysis to DB for succeeded result', async () => {
    const { analyzeOpportunities } = await import('../ingestion/claudeAnalyzer.js?v=20');

    const mockClient = makeMockClient({
      results: [
        {
          custom_id: String(testOppId),
          result: {
            type: 'succeeded',
            message: {
              content: [{ text: 'Test summary with analysis' }]
            }
          }
        }
      ]
    });

    await analyzeOpportunities([testOppId], mockClient);

    const row = db.prepare('SELECT claude_analysis FROM opportunities WHERE id = ?').get(testOppId);
    assert.ok(row, 'Expected to find opportunity row');
    assert.equal(row.claude_analysis, 'Test summary with analysis');

    // Reset for other tests
    db.prepare('UPDATE opportunities SET claude_analysis = NULL WHERE id = ?').run(testOppId);
  });

  // AI-01: runAnalyze returns extracted array unchanged
  test('AI-01: runAnalyze returns extracted array unchanged', async () => {
    const { runAnalyze } = await import('../pipeline/stages/analyze.js?v=20');
    const result = await runAnalyze([]);
    assert.ok(Array.isArray(result), `Expected array, got ${typeof result}`);
    assert.equal(result.length, 0);
  });

  // AI-02: SYSTEM_PROMPT contains all red flag trigger terms
  test('AI-02: SYSTEM_PROMPT contains all four red flag trigger terms', async () => {
    const { SYSTEM_PROMPT } = await import('../ingestion/claudeAnalyzer.js?v=21');
    assert.ok(SYSTEM_PROMPT.includes('DEBT STUFFING'), 'SYSTEM_PROMPT must contain "DEBT STUFFING"');
    assert.ok(SYSTEM_PROMPT.includes('MANAGEMENT EXODUS'), 'SYSTEM_PROMPT must contain "MANAGEMENT EXODUS"');
    assert.ok(SYSTEM_PROMPT.includes('WEAK-UNIT DISPOSAL'), 'SYSTEM_PROMPT must contain "WEAK-UNIT DISPOSAL"');
    assert.ok(SYSTEM_PROMPT.includes('NO INSIDER ALIGNMENT'), 'SYSTEM_PROMPT must contain "NO INSIDER ALIGNMENT"');
  });

  // AI-03: Opportunities with existing claude_analysis are excluded from batch
  test('AI-03: Opportunities with existing claude_analysis are excluded from batch submission', async () => {
    const { analyzeOpportunities } = await import('../ingestion/claudeAnalyzer.js?v=22');

    // Set a pre-existing analysis on the test opportunity
    db.prepare('UPDATE opportunities SET claude_analysis = ? WHERE id = ?').run('already done', testOppId);

    const createCalled = { called: false };
    const mockClient = makeMockClient({ createCalled });

    await analyzeOpportunities([testOppId], mockClient);

    assert.equal(createCalled.called, false, 'batches.create should NOT be called when all opportunities already have claude_analysis');

    // Reset
    db.prepare('UPDATE opportunities SET claude_analysis = NULL WHERE id = ?').run(testOppId);
  });

  // AI-03: Empty pending list returns early without calling batches.create
  test('AI-03: Empty pending list returns early without calling batches.create', async () => {
    const { analyzeOpportunities } = await import('../ingestion/claudeAnalyzer.js?v=23');

    const createCalled = { called: false };
    const mockClient = makeMockClient({ createCalled });

    await analyzeOpportunities([], mockClient);

    assert.equal(createCalled.called, false, 'batches.create should NOT be called for empty oppIds array');
  });

  // AI-03: Errored/expired batch results leave claude_analysis NULL
  test('AI-03: Errored batch result leaves claude_analysis NULL for retry on next run', async () => {
    const { analyzeOpportunities } = await import('../ingestion/claudeAnalyzer.js?v=24');

    // Ensure claude_analysis is NULL before test
    db.prepare('UPDATE opportunities SET claude_analysis = NULL WHERE id = ?').run(testOppId);

    const mockClient = makeMockClient({
      results: [
        {
          custom_id: String(testOppId),
          result: {
            type: 'errored',
            error: { message: 'test error' }
          }
        }
      ]
    });

    await analyzeOpportunities([testOppId], mockClient);

    const row = db.prepare('SELECT claude_analysis FROM opportunities WHERE id = ?').get(testOppId);
    assert.ok(row, 'Expected to find opportunity row');
    assert.equal(row.claude_analysis, null, 'claude_analysis should remain NULL for errored batch results');

    // Reset (already NULL, but be explicit)
    db.prepare('UPDATE opportunities SET claude_analysis = NULL WHERE id = ?').run(testOppId);
  });

});
