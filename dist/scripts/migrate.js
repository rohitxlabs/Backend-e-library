/**
 * Usage: npm run migrate   (development, runs the TypeScript sources)
 *        npm run migrate:prod   (after `npm run build`)
 */
import { closePool, pool } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { logger, serializeError } from '../utils/logger.js';
try {
    const applied = await runMigrations(pool);
    logger.info(applied.length ? 'Migrations complete' : 'Database already up to date', { applied });
}
catch (error) {
    logger.error('Migration failed', { error: serializeError(error) });
    process.exitCode = 1;
}
finally {
    await closePool();
}
//# sourceMappingURL=migrate.js.map