import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fixture text constants — hardcoded sample section texts
// ---------------------------------------------------------------------------

const STRATEGIC_FOCUS_FIXTURE = `The Board of Directors determined that the separation will enable each company to focus on its core business and pursue its own growth strategy. The separation will enhance management focus on the respective businesses and unlock value for shareholders by allowing each company to pursue strategic flexibility independently.`;

const WEAK_UNIT_FIXTURE = `The Company determined to separate the non-core assets which have underperformed relative to the parent's primary business segments. The division's slow growth and low margin profile are not consistent with the Company's long-term strategic direction.`;

const MIXED_REASONS_FIXTURE = `The Board believes the separation will enable the Company to focus on its core business and pursue strategic flexibility for both entities. At the same time, the non-core operations have underperformed and the Company intends to divest these assets.`;

const EQUITY_GRANTS_FIXTURE = `In connection with the separation, SpinCo will adopt a new equity incentive plan. Key executives of SpinCo will receive restricted stock unit awards and stock option grants under the new plan. The initial equity awards will include performance share units tied to SpinCo's financial metrics.`;

const NO_EQUITY_FIXTURE = `Employees of the Company will continue to participate in existing benefit plans. No changes to compensation arrangements are contemplated at this time.`;

const EXCESSIVE_DEBT_FIXTURE = `In connection with the separation, SpinCo will incur substantial indebtedness of approximately $3.5 billion under a new term loan facility and revolving credit facility. SpinCo's highly leveraged capital structure will result in a debt-to-equity ratio of approximately 3.5x.`;

const NO_DEBT_FIXTURE = `SpinCo will have a conservative capital structure with minimal debt obligations. The Company does not anticipate SpinCo requiring external financing.`;

const LEADERS_MOVING_FIXTURE = `John Smith, who currently serves as Executive Vice President of the Company, will become the Chief Executive Officer of SpinCo. Jane Doe will serve as Chief Financial Officer of SpinCo, having previously held the position of Senior Vice President at the parent company.`;

const LEADERS_STAYING_FIXTURE = `The senior leadership team will remain with the parent company. SpinCo's management positions will be filled by the current divisional management team with no dedicated senior executive transfers from the parent.`;

// ---------------------------------------------------------------------------
// DB setup for storeSignal tests
// ---------------------------------------------------------------------------

let db;
let testFilingId;

before(async () => {
  const { default: dbSingleton } = await import('../db/db.js?v=10');
  const { initializeSchema } = await import('../db/schema.js?v=10');
  db = dbSingleton;
  initializeSchema();

  // Insert a test filing row as FK target for storeSignal tests
  db.prepare("DELETE FROM signals WHERE filing_id IN (SELECT id FROM filings WHERE accession_number = 'TEST-99-000001')").run();
  db.prepare("DELETE FROM filings WHERE accession_number = 'TEST-99-000001'").run();

  const result = db.prepare(`
    INSERT INTO filings (accession_number, form_type, cik, company_name, filed_at, primary_doc_url)
    VALUES ('TEST-99-000001', '10-12B', '0000000001', 'Test SpinCo Inc', '2025-01-01', 'https://www.sec.gov/Archives/edgar/data/1/999/')
  `).run();
  testFilingId = Number(result.lastInsertRowid);
});

after(() => {
  if (db && testFilingId) {
    db.prepare('DELETE FROM signals WHERE filing_id = ?').run(testFilingId);
    db.prepare('DELETE FROM filings WHERE id = ?').run(testFilingId);
  }
});

// ---------------------------------------------------------------------------
// SIG-01: Reason Classification
// ---------------------------------------------------------------------------

describe('SIG-01: Reason Classification', () => {
  test('classifyReasons with strategic focus text returns strategic_focus', async () => {
    const { classifyReasons } = await import('../ingestion/signalExtractor.js?v=1');
    const result = classifyReasons(STRATEGIC_FOCUS_FIXTURE);
    assert.equal(result.classification, 'strategic_focus');
    assert.ok(['high', 'medium'].includes(result.confidence), `Expected high or medium confidence, got ${result.confidence}`);
  });

  test('classifyReasons with weak unit text returns weak_unit_disposal', async () => {
    const { classifyReasons } = await import('../ingestion/signalExtractor.js?v=2');
    const result = classifyReasons(WEAK_UNIT_FIXTURE);
    assert.equal(result.classification, 'weak_unit_disposal');
  });

  test('classifyReasons with mixed text returns mixed', async () => {
    const { classifyReasons } = await import('../ingestion/signalExtractor.js?v=3');
    const result = classifyReasons(MIXED_REASONS_FIXTURE);
    assert.equal(result.classification, 'mixed');
  });

  test('classifyReasons with null returns unknown/not_found', async () => {
    const { classifyReasons } = await import('../ingestion/signalExtractor.js?v=4');
    const result = classifyReasons(null);
    assert.deepEqual(result, { classification: 'unknown', confidence: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// SIG-02: Equity Grants
// ---------------------------------------------------------------------------

describe('SIG-02: Equity Grants', () => {
  test('classifyEquityGrants with equity text returns equity_grants_confirmed', async () => {
    const { classifyEquityGrants } = await import('../ingestion/signalExtractor.js?v=5');
    const result = classifyEquityGrants(EQUITY_GRANTS_FIXTURE);
    assert.equal(result.classification, 'equity_grants_confirmed');
    assert.ok(['high', 'medium'].includes(result.confidence), `Expected high or medium confidence, got ${result.confidence}`);
  });

  test('classifyEquityGrants with no equity text returns no_equity_grants', async () => {
    const { classifyEquityGrants } = await import('../ingestion/signalExtractor.js?v=6');
    const result = classifyEquityGrants(NO_EQUITY_FIXTURE);
    assert.equal(result.classification, 'no_equity_grants');
  });

  test('classifyEquityGrants with null returns unknown/not_found', async () => {
    const { classifyEquityGrants } = await import('../ingestion/signalExtractor.js?v=7');
    const result = classifyEquityGrants(null);
    assert.deepEqual(result, { classification: 'unknown', confidence: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// SIG-03: Debt Loading
// ---------------------------------------------------------------------------

describe('SIG-03: Debt Loading', () => {
  test('classifyDebtLoading with excessive debt text returns excessive_debt', async () => {
    const { classifyDebtLoading } = await import('../ingestion/signalExtractor.js?v=8');
    const result = classifyDebtLoading(EXCESSIVE_DEBT_FIXTURE);
    assert.equal(result.classification, 'excessive_debt');
    assert.ok(['high', 'medium'].includes(result.confidence), `Expected high or medium confidence, got ${result.confidence}`);
  });

  test('classifyDebtLoading with no debt text returns no_debt_concern', async () => {
    const { classifyDebtLoading } = await import('../ingestion/signalExtractor.js?v=9');
    const result = classifyDebtLoading(NO_DEBT_FIXTURE);
    assert.equal(result.classification, 'no_debt_concern');
  });

  test('classifyDebtLoading with null returns unknown/not_found', async () => {
    const { classifyDebtLoading } = await import('../ingestion/signalExtractor.js?v=10');
    const result = classifyDebtLoading(null);
    assert.deepEqual(result, { classification: 'unknown', confidence: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// SIG-04: Management Continuity
// ---------------------------------------------------------------------------

describe('SIG-04: Management Continuity', () => {
  test('classifyManagement with leaders moving text returns strong_leaders_moving', async () => {
    const { classifyManagement } = await import('../ingestion/signalExtractor.js?v=11');
    const result = classifyManagement(LEADERS_MOVING_FIXTURE);
    assert.equal(result.classification, 'strong_leaders_moving');
  });

  test('classifyManagement with leaders staying text returns leaders_staying_at_parent', async () => {
    const { classifyManagement } = await import('../ingestion/signalExtractor.js?v=12');
    const result = classifyManagement(LEADERS_STAYING_FIXTURE);
    assert.equal(result.classification, 'leaders_staying_at_parent');
  });

  test('classifyManagement with null returns unknown/not_found', async () => {
    const { classifyManagement } = await import('../ingestion/signalExtractor.js?v=13');
    const result = classifyManagement(null);
    assert.deepEqual(result, { classification: 'unknown', confidence: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// Signal Storage
// ---------------------------------------------------------------------------

describe('Signal Storage', () => {
  test('storeSignal inserts a row into the signals table with correct values', async () => {
    const { storeSignal } = await import('../ingestion/signalExtractor.js?v=14');

    storeSignal(testFilingId, 'reason_classification', 'strategic_focus', 'high', 'test excerpt');

    const row = db.prepare(
      "SELECT * FROM signals WHERE filing_id = ? AND signal_name = 'reason_classification'"
    ).get(testFilingId);

    assert.ok(row, 'Expected a row in signals table');
    assert.equal(row.filing_id, testFilingId);
    assert.equal(row.signal_name, 'reason_classification');
    assert.equal(row.classification, 'strategic_focus');
    assert.equal(row.confidence, 'high');
    assert.equal(row.raw_excerpt, 'test excerpt');

    // Cleanup
    db.prepare("DELETE FROM signals WHERE filing_id = ? AND signal_name = 'reason_classification'").run(testFilingId);
  });

  test('storeSignal called twice with same (filing_id, signal_name) produces exactly 1 row', async () => {
    const { storeSignal } = await import('../ingestion/signalExtractor.js?v=15');

    storeSignal(testFilingId, 'equity_grants', 'equity_grants_confirmed', 'high', 'first call');
    storeSignal(testFilingId, 'equity_grants', 'no_equity_grants', 'low', 'second call replaces');

    const rows = db.prepare(
      "SELECT * FROM signals WHERE filing_id = ? AND signal_name = 'equity_grants'"
    ).all(testFilingId);

    assert.equal(rows.length, 1, 'Expected exactly 1 row after two storeSignal calls');
    assert.equal(rows[0].raw_excerpt, 'second call replaces', 'Expected second call to replace first');

    // Cleanup
    db.prepare("DELETE FROM signals WHERE filing_id = ? AND signal_name = 'equity_grants'").run(testFilingId);
  });
});

// ---------------------------------------------------------------------------
// runExtract integration
// ---------------------------------------------------------------------------

describe('runExtract integration', () => {
  test('runExtract([]) returns empty array without error', async () => {
    const { runExtract } = await import('../pipeline/stages/extract.js?v=1');
    const result = await runExtract([]);
    assert.ok(Array.isArray(result), `Expected array, got ${typeof result}`);
    assert.equal(result.length, 0);
  });
});
