/**
 * EDGAR EFTS ingester for spinoff discovery (DISC-01).
 *
 * Queries the EDGAR full-text search endpoint for 10-12B, 10-12B/A, and 8-K
 * filings filed in the past 24 hours, then inserts them into the filings table.
 *
 * Rules:
 *   - Never call fetch() directly — always use edgarGetJson from edgarClient.js
 *   - INSERT OR IGNORE ensures idempotency across daily runs
 */
import { edgarGetJson } from '../ingestion/edgarClient.js';
import { normalizeCIK, accessionToPath } from '../lib/edgar-utils.js';
import db from '../db/db.js';
import logger from '../logger.js';

/**
 * Parse a display_name string into company name, ticker, and CIK.
 * Handles two formats:
 *   "CompanyName (TICKER) (CIK 0001234567)"
 *   "CompanyName (CIK 0001234567)"
 * @param {string} displayName
 * @returns {{ companyName: string, ticker: string|null, cik: string|null }}
 */
function parseDisplayName(displayName) {
  const m1 = displayName.match(/^(.+?)\s+\(([A-Z]{1,5})\)\s+\(CIK\s+(\d+)\)$/);
  if (m1) return { companyName: m1[1], ticker: m1[2], cik: m1[3] };
  const m2 = displayName.match(/^(.+?)\s+\(CIK\s+(\d+)\)$/);
  if (m2) return { companyName: m2[1], ticker: null, cik: m2[2] };
  return { companyName: displayName, ticker: null, cik: null };
}

/**
 * Query the EDGAR EFTS endpoint for spinoff-related filings filed in the past 24 hours.
 * Forms: 10-12B, 10-12B/A, 8-K
 * Date window: yesterday to today (daily run)
 *
 * @returns {Promise<Array>} Array of EFTS hit objects
 */
export async function queryEFTSSpinoffs() {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const params = new URLSearchParams({
    forms: '10-12B,10-12B/A,8-K',
    dateRange: 'custom',
    startdt: yesterday,
    enddt: today,
    from: '0',
    size: '100',
  });

  const url = `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;
  const result = await edgarGetJson(url);
  const hits = result.hits?.hits ?? [];

  logger.info({ count: hits.length }, 'EFTS spinoff query complete');
  return hits;
}

/**
 * Insert a single EFTS hit into the filings table using INSERT OR IGNORE.
 * Returns the lastInsertRowid (0 if duplicate, positive integer if inserted).
 *
 * @param {object} hit - EFTS hit object with _source properties
 * @returns {number|BigInt} lastInsertRowid
 */
export function insertFiling(hit) {
  const src = hit._source;
  const { adsh, form, ciks, display_names, file_date, period_ending } = src;

  const rawName = display_names?.[0] ?? '';
  const { companyName } = parseDisplayName(rawName);

  if (!companyName) {
    logger.warn({ adsh }, 'display_names parse produced empty company_name');
  }

  const paddedCIK = normalizeCIK(ciks?.[0] ?? '0');
  const pathAccession = accessionToPath(adsh);
  const primary_doc_url = `https://www.sec.gov/Archives/edgar/data/${paddedCIK}/${pathAccession}/`;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO filings
      (accession_number, form_type, cik, company_name, filed_at, period_of_report, primary_doc_url)
    VALUES
      (@accession_number, @form_type, @cik, @company_name, @filed_at, @period_of_report, @primary_doc_url)
  `);

  const result = stmt.run({
    accession_number: adsh,
    form_type: form,
    cik: ciks?.[0] ?? '',
    company_name: companyName,
    filed_at: file_date,
    period_of_report: period_ending ?? null,
    primary_doc_url,
  });

  return result.lastInsertRowid;
}
