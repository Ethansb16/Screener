import db from '../db/db.js';
import logger from '../logger.js';
import { runDiscover } from './stages/discover.js';
import { runExtract }  from './stages/extract.js';
import { runAnalyze }  from './stages/analyze.js';
import { runPersist }  from './stages/persist.js';

/**
 * Run the full four-stage pipeline and record the result in run_log.
 * Stages are sequential and idempotent. Each stage receives the output of the previous.
 *
 * Stage order: discover → extract → analyze → persist
 *
 * @returns {Promise<void>}
 * @throws {Error} re-throws any stage error after writing error status to run_log
 */
export async function runPipeline() {
  const runId = db.prepare(
    `INSERT INTO run_log (started_at, status) VALUES (datetime('now'), 'running')`
  ).run().lastInsertRowid;

  try {
    logger.info({ runId }, 'Pipeline starting');

    const discovered    = await runDiscover();
    const extracted     = await runExtract(discovered);
    const analyzed      = await runAnalyze(extracted);
    await runPersist(analyzed);

    db.prepare(
      `UPDATE run_log
         SET finished_at = datetime('now'),
             status = 'success',
             filings_fetched = ?
       WHERE id = ?`
    ).run(discovered?.length ?? 0, runId);

    logger.info({ runId, filingsFetched: discovered?.length ?? 0 }, 'Pipeline complete');
  } catch (err) {
    db.prepare(
      `UPDATE run_log
         SET finished_at = datetime('now'),
             status = 'error',
             error_message = ?
       WHERE id = ?`
    ).run(err.message, runId);

    logger.error({ runId, err }, 'Pipeline failed');
    throw err;
  }
}
