import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// DB setup for dashboard tests
// ---------------------------------------------------------------------------

let db;
let testOppId;
let testFilingId;

before(async () => {
  const { default: dbSingleton } = await import('../db/db.js?v=30');
  const { initializeSchema } = await import('../db/schema.js?v=30');
  db = dbSingleton;
  initializeSchema();

  // Clean up any leftover test data (in reverse dependency order)
  db.prepare("DELETE FROM signals WHERE filing_id IN (SELECT id FROM filings WHERE accession_number = 'TEST-DASH-000001')").run();
  db.prepare("DELETE FROM opportunities WHERE filing_id IN (SELECT id FROM filings WHERE accession_number = 'TEST-DASH-000001')").run();
  db.prepare("DELETE FROM filings WHERE accession_number = 'TEST-DASH-000001'").run();

  // Insert a test filing row
  const filingResult = db.prepare(
    "INSERT INTO filings (accession_number, form_type, cik, company_name, filed_at) VALUES ('TEST-DASH-000001', '10-12B', '0000088888', 'DashTest Corp', '2025-07-01')"
  ).run();
  testFilingId = Number(filingResult.lastInsertRowid);

  // Insert a test opportunity row
  const oppResult = db.prepare(
    "INSERT INTO opportunities (filing_id, source_type, company_name, signal_type, status, claude_analysis) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    testFilingId,
    'edgar',
    'DashTest Corp',
    'spinoff',
    'new',
    'Summary text.\n\nRed Flags:\n- Excessive debt loading'
  );
  testOppId = Number(oppResult.lastInsertRowid);

  // Insert 4 signal rows
  const insertSignal = db.prepare(
    'INSERT INTO signals (filing_id, signal_name, classification, confidence) VALUES (?, ?, ?, ?)'
  );
  insertSignal.run(testFilingId, 'reason_classification', 'strategic_focus', 'high');
  insertSignal.run(testFilingId, 'equity_grants', 'equity_grants_confirmed', 'medium');
  insertSignal.run(testFilingId, 'debt_loading', 'excessive_debt', 'high');
  insertSignal.run(testFilingId, 'management_continuity', 'strong_leaders_moving', 'medium');
});

after(() => {
  if (db && testFilingId) {
    db.prepare('DELETE FROM signals WHERE filing_id = ?').run(testFilingId);
    db.prepare('DELETE FROM opportunities WHERE filing_id = ?').run(testFilingId);
    db.prepare('DELETE FROM filings WHERE id = ?').run(testFilingId);
  }
});

// ---------------------------------------------------------------------------
// Query tests
// ---------------------------------------------------------------------------

describe('queries', () => {

  test('listOpportunities returns rows with expected columns', async () => {
    const { listOpportunities } = await import('../web/queries.js?v=30');
    const rows = listOpportunities();
    const row = rows.find(r => r.company_name === 'DashTest Corp');
    assert.ok(row, 'Expected to find DashTest Corp in listOpportunities results');
    assert.ok('id' in row, 'Row should have id property');
    assert.ok('company_name' in row, 'Row should have company_name property');
    assert.ok('signal_type' in row, 'Row should have signal_type property');
    assert.ok('status' in row, 'Row should have status property');
    assert.ok('top_signal_classification' in row, 'Row should have top_signal_classification property');
    assert.equal(row.top_signal_classification, 'strategic_focus', 'top_signal_classification should be strategic_focus');
  });

  test('getOpportunityDetail returns full detail with signals', async () => {
    const { getOpportunityDetail } = await import('../web/queries.js?v=30');
    const result = getOpportunityDetail(testOppId);
    assert.ok(result !== null, 'Expected result to not be null');
    assert.equal(result.company_name, 'DashTest Corp', 'company_name should be DashTest Corp');
    assert.ok(result.claude_analysis.includes('Red Flags'), 'claude_analysis should contain "Red Flags"');
    assert.equal(result.signals.length, 4, 'signals should have 4 entries');
    assert.ok(
      result.signals.some(s => s.signal_name === 'reason_classification'),
      'signals should include reason_classification'
    );
  });

  test('getOpportunityDetail returns null for nonexistent id', async () => {
    const { getOpportunityDetail } = await import('../web/queries.js?v=30');
    const result = getOpportunityDetail(999999);
    assert.equal(result, null, 'Expected null for nonexistent id');
  });

});

// ---------------------------------------------------------------------------
// Template tests (added in Task 2)
// ---------------------------------------------------------------------------

describe('templates', () => {

  test('esc escapes HTML entities', async () => {
    const { esc } = await import('../web/templates.js?v=30');
    assert.equal(esc('<b>"hi"</b>'), '&lt;b&gt;&quot;hi&quot;&lt;/b&gt;');
  });

  test('esc returns empty string for null', async () => {
    const { esc } = await import('../web/templates.js?v=30');
    assert.equal(esc(null), '');
  });

  test('renderLayout includes HTMX and Tailwind CDN', async () => {
    const { renderLayout } = await import('../web/templates.js?v=30');
    const output = renderLayout('<p>test</p>');
    assert.ok(output.includes('htmx.org@2.0.8'), 'Should include htmx.org@2.0.8');
    assert.ok(output.includes('@tailwindcss/browser@4'), 'Should include @tailwindcss/browser@4');
    assert.ok(output.includes('<!DOCTYPE html>'), 'Should include DOCTYPE html');
    assert.ok(output.includes('<p>test</p>'), 'Should include body content');
  });

  test('renderFeedPage renders opportunity rows with hx-get', async () => {
    const { renderFeedPage } = await import('../web/templates.js?v=30');
    const opps = [{
      id: 1,
      company_name: 'Test Corp',
      signal_type: 'spinoff',
      status: 'new',
      top_signal_classification: 'strategic_focus'
    }];
    const output = renderFeedPage(opps);
    assert.ok(output.includes('hx-get="/opportunities/1"'), 'Should include hx-get attribute');
    assert.ok(output.includes('Test Corp'), 'Should include company name');
    assert.ok(output.includes('Strategic Focus'), 'Should include signal label');
  });

  test('renderFeedPage handles null top_signal_classification', async () => {
    const { renderFeedPage } = await import('../web/templates.js?v=30');
    const opps = [{
      id: 2,
      company_name: 'Unknown Corp',
      signal_type: 'spinoff',
      status: 'new',
      top_signal_classification: null
    }];
    const output = renderFeedPage(opps);
    assert.ok(output.includes('Pending'), 'Should show Pending for null classification');
  });

  test('renderDetail renders all 4 signals', async () => {
    const { renderDetail } = await import('../web/templates.js?v=30');
    const opp = {
      id: 1,
      company_name: 'Signal Corp',
      signal_type: 'spinoff',
      status: 'new',
      discovered_at: '2025-07-01',
      filed_at: '2025-07-01',
      accession_number: 'TEST-000001',
      claude_analysis: 'Analysis text.',
      signals: [
        { signal_name: 'reason_classification', classification: 'strategic_focus', confidence: 'high' },
        { signal_name: 'equity_grants', classification: 'equity_grants_confirmed', confidence: 'medium' },
        { signal_name: 'debt_loading', classification: 'no_debt_concern', confidence: 'low' },
        { signal_name: 'management_continuity', classification: 'strong_leaders_moving', confidence: 'high' }
      ]
    };
    const output = renderDetail(opp);
    // Check for signal names or their labels
    assert.ok(
      output.includes('reason_classification') || output.includes('Strategic Focus'),
      'Should include reason_classification or its label'
    );
    assert.ok(
      output.includes('equity_grants') || output.includes('Equity Grants'),
      'Should include equity_grants or its label'
    );
    assert.ok(
      output.includes('debt_loading') || output.includes('No Debt Concern'),
      'Should include debt_loading or its label'
    );
    assert.ok(
      output.includes('management_continuity') || output.includes('Leaders Moving'),
      'Should include management_continuity or its label'
    );
  });

  test('renderDetail shows fallback for null claude_analysis', async () => {
    const { renderDetail } = await import('../web/templates.js?v=30');
    const opp = {
      id: 1,
      company_name: 'No Analysis Corp',
      signal_type: 'spinoff',
      status: 'new',
      discovered_at: '2025-07-01',
      filed_at: '2025-07-01',
      accession_number: 'TEST-000002',
      claude_analysis: null,
      signals: []
    };
    const output = renderDetail(opp);
    assert.ok(output.includes('Analysis pending'), 'Should show fallback text for null claude_analysis');
    assert.ok(!/\bnull\b/.test(output), 'Should not contain the word "null"');
  });

  test('renderDetail renders red flags section', async () => {
    const { renderDetail } = await import('../web/templates.js?v=30');
    const opp = {
      id: 1,
      company_name: 'Red Flag Corp',
      signal_type: 'spinoff',
      status: 'new',
      discovered_at: '2025-07-01',
      filed_at: '2025-07-01',
      accession_number: 'TEST-000003',
      claude_analysis: 'Summary here.\n\nRed Flags:\n- Debt stuffing detected',
      signals: []
    };
    const output = renderDetail(opp);
    assert.ok(output.includes('Red Flags'), 'Should include Red Flags section');
    assert.ok(output.includes('Debt stuffing detected'), 'Should include red flag content');
  });

});
