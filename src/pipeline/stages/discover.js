/**
 * Stage 1: Discover — find new spinoff filings from EDGAR EFTS.
 * Queries 10-12B, 10-12B/A, and 8-K filings from the past 24 hours,
 * inserts them into the filings table, classifies each deal type,
 * and creates opportunity records for spinoff/split-off candidates.
 * @returns {Promise<Array>} array of lastInsertRowid values for newly inserted opportunities
 */
import { queryEFTSSpinoffs, insertFiling, insertOpportunity } from '../../ingestion/edgarIngester.js';
import { classifyDeal } from '../../ingestion/classifyDeal.js';
import logger from '../../logger.js';

export async function runDiscover() {
  const hits = await queryEFTSSpinoffs();
  const ids = [];
  for (const hit of hits) {
    const filingId = insertFiling(hit);
    if (filingId) {
      const dealType = classifyDeal(hit);
      const oppId = insertOpportunity(filingId, hit, dealType);
      if (oppId) ids.push(oppId);
    }
  }
  logger.info({ inserted: ids.length, total: hits.length }, 'discover stage complete');
  return ids;
}
