import type { CookieOptions, Request, Response } from 'express';
import { env, isProduction } from '../config/env.js';

/**
 * In production without a custom domain the "__Host-" prefix is used: browsers then refuse the
 * cookie unless it is Secure, has Path=/ and no Domain — preventing subdomain cookie injection.
 */
export const SESSION_COOKIE_NAME = isProduction && !env.COOKIE_DOMAIN ? '__Host-sid' : 'sid';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    // SameSite=None is only accepted by browsers on Secure cookies.
    secure: isProduction || env.COOKIE_SAME_SITE === 'none',
    sameSite: env.COOKIE_SAME_SITE,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, { ...baseOptions(), expires: expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions());
}

export function readSessionCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}
