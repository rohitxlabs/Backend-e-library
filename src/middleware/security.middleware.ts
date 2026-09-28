import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { Errors } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth for cookie-authenticated routes: browsers always send an Origin header on
 * cross-origin POSTs, so a state-changing request from a page not listed in FRONTEND_URL is
 * refused. Requests without Origin (curl, server-to-server) are allowed; they carry no ambient
 * browser cookies. SameSite cookies provide the first layer.
 */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !env.FRONTEND_URL.includes(origin)) {
    throw Errors.forbidden('Origin not allowed');
  }
  next();
}

/** API responses (tokens validity, user data) must not be cached by browsers or proxies. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}
