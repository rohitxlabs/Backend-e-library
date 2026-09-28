import cron from 'node-cron';
import { env } from '../config/env.js';
import { processPendingSetupEmails } from '../services/password-setup-email.service.js';
import { deleteExpiredSessions } from '../services/session.service.js';
import { deleteStaleTokens } from '../services/token.service.js';
import { logger, serializeError } from '../utils/logger.js';

const HOUSEKEEPING_EVERY_MS = 60 * 60 * 1000;

let inFlight: Promise<void> | null = null;
let lastHousekeepingAt = 0;
// hi 
/**
 * One worker tick: email one batch of pending users, plus hourly cleanup of expired sessions and
 * old tokens. Overlapping ticks in the same process are skipped; other processes are handled by
 * row claiming in the service.
 */
export function runPasswordSetupEmailJob(): Promise<void> {
  if (inFlight) {
    logger.debug('Email worker still running; skipping this tick');
    return inFlight;
  }
  inFlight = (async () => {
    const startedAt = Date.now();
    try {
      const result = await processPendingSetupEmails();
      if (result.claimed > 0) {
        logger.info('Email worker batch finished', { ...result, durationMs: Date.now() - startedAt });
      } else {
        logger.debug('Email worker found no pending users');
      }
      if (Date.now() - lastHousekeepingAt >= HOUSEKEEPING_EVERY_MS) {
        lastHousekeepingAt = Date.now();
        const [sessions, tokens] = await Promise.all([deleteExpiredSessions(), deleteStaleTokens()]);
        if (sessions || tokens) logger.info('Housekeeping removed stale rows', { sessions, tokens });
      }
    } catch (error) {
      logger.error('Email worker run failed', { error: serializeError(error) });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export interface JobHandle {
  /** Stops scheduling and waits for the current run (if any) to finish. */
  stop(): Promise<void>;
}

export function startPasswordSetupEmailJob(): JobHandle {
  const expression = `*/${env.EMAIL_JOB_INTERVAL_MINUTES} * * * *`;
  const task = cron.schedule(expression, () => runPasswordSetupEmailJob(), {
    name: 'password-setup-email',
    noOverlap: true,
  });
  logger.info('Email worker started', {
    schedule: expression,
    batchSize: env.EMAIL_BATCH_SIZE,
    allowlistActive: Boolean(env.EMAIL_RECIPIENT_ALLOWLIST?.length),
  });
  // Don't wait up to a minute for the first run.
  void runPasswordSetupEmailJob();

  return {
    async stop() {
      await task.stop();
      await task.destroy();
      if (inFlight) await inFlight;
      logger.info('Email worker stopped');
    },
  };
}
