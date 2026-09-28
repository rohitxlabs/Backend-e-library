import { findSessionUser } from '../services/session.service.js';
import { Errors } from '../utils/errors.js';
import { clearSessionCookie, readSessionCookie } from '../utils/session-cookie.js';
/** Resolves the session cookie to a user and stores it in res.locals.user; 401 otherwise. */
export async function requireAuth(req, res, next) {
    const sessionId = readSessionCookie(req);
    const user = sessionId ? await findSessionUser(sessionId) : null;
    if (!user) {
        if (sessionId)
            clearSessionCookie(res); // stale or revoked cookie
        throw Errors.unauthenticated();
    }
    res.locals.user = user;
    next();
}
export function getAuthenticatedUser(res) {
    const user = res.locals.user;
    if (!user)
        throw Errors.unauthenticated();
    return user;
}
//# sourceMappingURL=auth.middleware.js.map