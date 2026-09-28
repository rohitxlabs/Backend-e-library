import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger, serializeError } from '../utils/logger.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, message: 'Route not found' });
}

/**
 * Central error handler. Only AppError messages and Zod field messages reach clients; everything
 * else (database errors, bugs) becomes a generic 500 and is logged server-side.
 */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
    return;
  }

  // Errors raised by express.json() / body-parser carry a status and a type.
  const bodyError = error as { status?: number; type?: string };
  if (bodyError.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, message: 'Malformed JSON body' });
    return;
  }
  if (bodyError.type === 'entity.too.large') {
    res.status(413).json({ success: false, message: 'Request body too large' });
    return;
  }
  if (typeof bodyError.status === 'number' && bodyError.status >= 400 && bodyError.status < 500) {
    res.status(bodyError.status).json({ success: false, message: 'Bad request' });
    return;
  }

  logger.error('Unhandled request error', {
    method: req.method,
    path: req.originalUrl.split('?')[0],
    error: serializeError(error),
  });
  res.status(500).json({ success: false, message: 'Internal server error' });
}
