import 'dotenv/config';
import express from 'express';
import { initializeSchema } from './db/schema.js';
import { startScheduler } from './scheduler.js';
import logger from './logger.js';
import { dashboardRouter } from './web/router.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// 1. Initialize DB schema (idempotent — safe to run every startup)
initializeSchema();
logger.info('Database schema initialized');

// 2. Start the daily cron scheduler
startScheduler();

// 3. Start Express server (Phase 5 adds real routes)
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/', dashboardRouter);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Express server listening');
});
