import cron from 'node-cron';
import { runPipeline } from './pipeline/runner.js';
import logger from './logger.js';

// Default: 7:00 AM daily (after EDGAR late-evening filing cutoff of ~5:30 PM ET)
// Override via CRON_SCHEDULE env var in .env
const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? '0 7 * * *';

/**
 * Register the daily pipeline cron job.
 * Validates the cron expression before registering — throws if invalid.
 * Does NOT fire immediately on startup; waits for the next scheduled tick.
 */
export function startScheduler() {
  if (!cron.validate(CRON_SCHEDULE)) {
    throw new Error(`Invalid CRON_SCHEDULE expression: "${CRON_SCHEDULE}". Check .env file.`);
  }

  cron.schedule(CRON_SCHEDULE, async () => {
    logger.info({ schedule: CRON_SCHEDULE }, 'Scheduled pipeline run starting');
    try {
      await runPipeline();
    } catch (err) {
      logger.error({ err }, 'Scheduled pipeline run failed — will retry at next scheduled time');
    }
  });

  logger.info({ schedule: CRON_SCHEDULE }, 'Scheduler registered');
}
