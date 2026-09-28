/**
 * Runs exactly one worker batch and exits — handy for a first controlled test.
 *
 *   npm run email:send-once
 *
 * Honors EMAIL_BATCH_SIZE and EMAIL_RECIPIENT_ALLOWLIST. Safe to run while the server is running
 * (rows are claimed, never double-processed).
 */
import { closePool } from '../config/database.js';
import { closeEmailTransport } from '../services/email.service.js';
import { processPendingSetupEmails } from '../services/password-setup-email.service.js';
import { logger, serializeError } from '../utils/logger.js';
try {
    const result = await processPendingSetupEmails();
    logger.info('One-off email batch finished', { ...result });
}
catch (error) {
    logger.error('One-off email batch failed', { error: serializeError(error) });
    process.exitCode = 1;
}
finally {
    closeEmailTransport();
    await closePool();
}
//# sourceMappingURL=send-setup-emails-once.js.map