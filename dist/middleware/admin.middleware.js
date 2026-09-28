import { env } from '../config/env.js';
import { safeEqual } from '../utils/crypto.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
/**
 * Shared-secret authenticator. Accepts either header:
 *   Authorization: Bearer <ADMIN_SECRET>
 *   X-Admin-Secret: <ADMIN_SECRET>
 */
export const adminSecretAuthenticator = (req) => {
    const authorization = req.get('authorization');
    const provided = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : req.get('x-admin-secret');
    return typeof provided === 'string' && provided.length > 0 && safeEqual(provided, env.ADMIN_SECRET);
};
export function requireAdmin(authenticate = adminSecretAuthenticator) {
    return async (req, _res, next) => {
        if (!(await authenticate(req))) {
            logger.warn('Unauthorized admin request', { method: req.method, path: req.originalUrl.split('?')[0], ip: req.ip });
            throw Errors.unauthorized();
        }
        next();
    };
}
//# sourceMappingURL=admin.middleware.js.map