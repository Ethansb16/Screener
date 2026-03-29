import { checkLifecycle } from '../../ingestion/lifecycleChecker.js';
import db from '../../db/db.js';
import logger from '../../logger.js';

/**
 * Stage 4: Persist — run lifecycle checks on all 'new' (Candidate) opportunities
 * and update status to 'confirmed' or 'withdrawn' as appropriate.
 *
 * @param {Array} _newFilingIds - ignored; this stage always processes ALL 'new' opps
 * @returns {Promise<{confirmed: number, withdrawn: number}>}
 */
export async function runPersist(_newFilingIds = []) {
  // Fetch ALL opportunities with status='new' — lifecycle changes can happen any day
  const candidates = db.prepare(`
    SELECT o.id, f.cik
    FROM opportunities o
    JOIN filings f ON f.id = o.filing_id
    WHERE o.status = 'new'
  `).all();

  logger.info({ count: candidates.length }, 'persist: checking lifecycle for all candidates');

  let confirmed = 0;
  let withdrawn = 0;

  for (const row of candidates) {
    if (!row.cik) continue;

    const newStatus = await checkLifecycle(row.cik);

    if (newStatus === 'confirmed' || newStatus === 'withdrawn') {
      db.prepare('UPDATE opportunities SET status = ? WHERE id = ?').run(newStatus, row.id);
      if (newStatus === 'confirmed') confirmed++;
      else withdrawn++;
    }
  }

  logger.info({ confirmed, withdrawn }, 'persist stage complete');
  return { confirmed, withdrawn };
}
