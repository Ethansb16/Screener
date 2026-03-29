/**
 * Stage 1: Discover — find new spinoff filings from EDGAR EFTS.
 * Queries 10-12B, 10-12B/A, and 8-K filings from the past 24 hours
 * and inserts them idempotently into the filings table.
 * @returns {Promise<Array>} array of lastInsertRowid values for newly inserted filings
 */
import { queryEFTSSpinoffs, insertFiling } from '../../ingestion/edgarIngester.js';
import logger from '../../logger.js';

export async function runDiscover() {
  const hits = await queryEFTSSpinoffs();
  const ids = [];
  for (const hit of hits) {
    const id = insertFiling(hit);
    if (id) ids.push(id); // id === 0 means duplicate — skip
  }
  logger.info({ inserted: ids.length, total: hits.length }, 'discover stage complete');
  return ids;
}
