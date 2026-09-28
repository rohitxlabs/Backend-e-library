/**
 * Convenience alternative to typing INSERTs in the Neon SQL editor.
 *
 *   npm run users:add -- alice@example.com bob@example.com
 *
 * Existing emails are skipped. The running server's worker emails the new users automatically.
 */
import { closePool } from '../config/database.js';
import { createUsers } from '../services/user.service.js';
import { logger, serializeError } from '../utils/logger.js';
const emails = process.argv.slice(2);
if (emails.length === 0) {
    console.error('Usage: npm run users:add -- <email> [email ...]');
    process.exit(1);
}
try {
    const created = await createUsers(emails);
    logger.info('Users added', { requested: emails.length, created: created.length, ids: created.map((u) => u.id) });
}
catch (error) {
    logger.error('Adding users failed', { error: serializeError(error) });
    process.exitCode = 1;
}
finally {
    await closePool();
}
//# sourceMappingURL=add-users.js.map