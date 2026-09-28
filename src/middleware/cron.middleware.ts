import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { safeEqual } from '../utils/crypto.js';
import { AppError, Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Requires "Authorization: Bearer <CRON_SECRET>" — the header Vercel Cron sends automatically. */
export function requireCronSecret(req: Request, _res: Response, next: NextFunction): void {
  if (!env.CRON_SECRET) {
    throw new AppError(503, 'Cron endpoint is disabled (CRON_SECRET is not set)');
  }
  const authorization = req.get('authorization');
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  if (!provided || !safeEqual(provided, env.CRON_SECRET)) {
    logger.warn('Unauthorized cron request', { ip: req.ip });
    throw Errors.unauthorized();
  }
  next();
}
