import { createApp } from './app.js';
import { closePool, checkDatabaseConnection, pool } from './config/database.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { startPasswordSetupEmailJob } from './jobs/password-setup-email.job.js';
import { closeEmailTransport, verifyEmailTransport } from './services/email.service.js';
import { logger, serializeError } from './utils/logger.js';
const SHUTDOWN_TIMEOUT_MS = 15_000;
let server;
let emailJob;
let shuttingDown = false;
async function start() {
    await checkDatabaseConnection();
    logger.info('Database connected');
    if (env.AUTO_MIGRATE) {
        const applied = await runMigrations(pool);
        if (applied.length)
            logger.info('Pending migrations applied', { applied });
    }
    // Non-fatal: the API still works; the worker logs each failed send and retries later.
    if (await verifyEmailTransport())
        logger.info('SMTP connection verified');
    const app = createApp();
    server = app.listen(env.PORT, () => {
        logger.info('Server started', { port: env.PORT, env: env.NODE_ENV });
    });
    server.on('error', (error) => {
        logger.error('HTTP server error', { error: serializeError(error) });
        void shutdown('serverError');
    });
    if (env.EMAIL_JOB_ENABLED) {
        emailJob = startPasswordSetupEmailJob();
    }
    else {
        logger.warn('Email worker disabled (EMAIL_JOB_ENABLED=false)');
    }
}
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    const forceExit = setTimeout(() => {
        logger.error('Graceful shutdown timed out; forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    try {
        // 1. Stop accepting requests and let in-flight ones finish.
        if (server) {
            const closing = new Promise((resolve) => server.close(() => resolve()));
            server.closeIdleConnections();
            await closing;
            logger.info('HTTP server closed');
        }
        // 2. Stop the worker and wait for the batch in progress.
        await emailJob?.stop();
        // 3. Release external resources.
        closeEmailTransport();
        await closePool();
        logger.info('Database pool closed');
        process.exit(0);
    }
    catch (error) {
        logger.error('Error during shutdown', { error: serializeError(error) });
        process.exit(1);
    }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: serializeError(reason) });
});
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: serializeError(error) });
    void shutdown('uncaughtException');
});
start().catch(async (error) => {
    logger.error('Failed to start server', { error: serializeError(error) });
    await closePool().catch(() => undefined);
    process.exit(1);
});
//# sourceMappingURL=server.js.map