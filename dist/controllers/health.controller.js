import { checkDatabaseConnection } from '../config/database.js';
import { logger, serializeError } from '../utils/logger.js';
/** GET /health — 200 when the API and database are reachable, 503 otherwise. */
export async function health(_req, res) {
    res.set('Cache-Control', 'no-store');
    try {
        await checkDatabaseConnection();
        res.json({
            success: true,
            data: { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) },
        });
    }
    catch (error) {
        logger.error('Health check: database unreachable', { error: serializeError(error) });
        res.status(503).json({ success: false, message: 'Database unavailable' });
    }
}
//# sourceMappingURL=health.controller.js.map