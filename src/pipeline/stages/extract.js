/**
 * Stage 2: Extract signals — parse Form 10 text for spinoff signals.
 * Receives opportunity IDs from runDiscover, looks up associated filings,
 * fetches Form 10 HTML, extracts four signals per filing, stores in signals table.
 *
 * @param {Array<number>} opportunityIds - IDs from runDiscover()
 * @returns {Promise<Array<{oppId: number, signals: Array}>>} results for runAnalyze
 */
import { extractSignalsForFiling } from '../../ingestion/signalExtractor.js';
import db from '../../db/db.js';
import logger from '../../logger.js';

// Prepared statement to look up filing from opportunity ID
const findFilingByOpportunity = db.prepare(`
  SELECT f.id, f.accession_number, f.primary_doc_url, f.cik
  FROM opportunities o
  JOIN filings f ON f.id = o.filing_id
  WHERE o.id = ?
`);

export async function runExtract(opportunityIds = []) {
  if (!opportunityIds.length) return [];

  const results = [];
  for (const oppId of opportunityIds) {
    try {
      const filing = findFilingByOpportunity.get(oppId);
      if (!filing) {
        logger.warn({ oppId }, 'No filing found for opportunity — skipping extraction');
        continue;
      }

      const signals = await extractSignalsForFiling(filing);
      results.push({ oppId, signals });
    } catch (err) {
      logger.warn({ oppId, err: err.message }, 'Signal extraction failed for opportunity');
      // Continue to next — do NOT crash the pipeline (per research anti-pattern guidance)
    }
  }

  logger.info({ processed: results.length, total: opportunityIds.length }, 'extract stage complete');
  return results;
}
