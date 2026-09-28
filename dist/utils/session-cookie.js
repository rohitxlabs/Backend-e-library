import { env, isProduction } from '../config/env.js';
/**
 * In production without a custom domain the "__Host-" prefix is used: browsers then refuse the
 * cookie unless it is Secure, has Path=/ and no Domain — preventing subdomain cookie injection.
 */
export const SESSION_COOKIE_NAME = isProduction && !env.COOKIE_DOMAIN ? '__Host-sid' : 'sid';
function baseOptions() {
    return {
        httpOnly: true,
        // SameSite=None is only accepted by browsers on Secure cookies.
        secure: isProduction || env.COOKIE_SAME_SITE === 'none',
        sameSite: env.COOKIE_SAME_SITE,
        path: '/',
        ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    };
}
export function setSessionCookie(res, sessionId, expiresAt) {
    res.cookie(SESSION_COOKIE_NAME, sessionId, { ...baseOptions(), expires: expiresAt });
}
export function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, baseOptions());
}
export function readSessionCookie(req) {
    const value = req.cookies?.[SESSION_COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}
//# sourceMappingURL=session-cookie.js.map