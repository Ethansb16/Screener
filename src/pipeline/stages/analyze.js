import { analyzeOpportunities } from '../../ingestion/claudeAnalyzer.js';
import logger from '../../logger.js';

/**
 * Stage 3: Analyze — generate Claude AI summaries for opportunities.
 * Submits a Claude Batch API job for all unanalyzed opportunities,
 * polls until completion, and writes claude_analysis to the DB.
 *
 * @param {Array<{oppId: number, signals: Array}>} extracted - output from runExtract()
 * @returns {Promise<Array>} same extracted array (claude_analysis written directly to DB)
 */
export async function runAnalyze(extracted = []) {
  if (!extracted.length) {
    logger.info('analyze stage: no opportunities to analyze');
    return extracted;
  }

  const oppIds = extracted.map(e => e.oppId);
  await analyzeOpportunities(oppIds);

  logger.info({ processed: oppIds.length }, 'analyze stage complete');
  return extracted;
}
