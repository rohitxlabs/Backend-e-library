import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { safeEqual } from '../utils/crypto.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Decides whether a request comes from an administrator. Swap in a different implementation
 * (e.g. session user with an "admin" role) without touching the routes.
 */
export type AdminAuthenticator = (req: Request) => boolean | Promise<boolean>;

/**
 * Shared-secret authenticator. Accepts either header:
 *   Authorization: Bearer <ADMIN_SECRET>
 *   X-Admin-Secret: <ADMIN_SECRET>
 */
export const adminSecretAuthenticator: AdminAuthenticator = (req) => {
  const authorization = req.get('authorization');
  const provided = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : req.get('x-admin-secret');
  return typeof provided === 'string' && provided.length > 0 && safeEqual(provided, env.ADMIN_SECRET);
};

export function requireAdmin(authenticate: AdminAuthenticator = adminSecretAuthenticator): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!(await authenticate(req))) {
      logger.warn('Unauthorized admin request', { method: req.method, path: req.originalUrl.split('?')[0], ip: req.ip });
      throw Errors.unauthorized();
    }
    next();
  };
}
