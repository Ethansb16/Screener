import 'dotenv/config';
import express from 'express';
import { initializeSchema } from './db/schema.js';
import { startScheduler } from './scheduler.js';
import logger from './logger.js';

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

// Placeholder — Phase 5 mounts the dashboard router here
app.get('/', (_req, res) => {
  res.send('<h1>Spinoff Screener</h1><p>Dashboard coming in Phase 5.</p>');
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Express server listening');
});
