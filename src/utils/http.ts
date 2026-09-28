import type { Response } from 'express';

/** Consistent success envelope: { success: true, data }. Errors are shaped by error.middleware. */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data });
}
