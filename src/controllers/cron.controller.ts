import type { Request, Response } from 'express';
import { isServerless } from '../config/env.js';
import { runPasswordSetupEmailJob } from '../jobs/password-setup-email.job.js';
import { closeEmailTransport } from '../services/email.service.js';
import { AppError } from '../utils/errors.js';
import { sendSuccess } from '../utils/http.js';

/**
 * GET /api/cron/password-setup-emails
 *
 * Runs one worker batch (same logic as the in-process node-cron worker, including its
 * duplicate-send protection). Used on serverless hosts, triggered by Vercel Cron or any
 * external scheduler.
 */
export async function runPasswordSetupEmails(_req: Request, res: Response): Promise<void> {
  const result = await runPasswordSetupEmailJob();
  // Don't keep SMTP sockets open in a function instance that is about to be frozen.
  if (isServerless) closeEmailTransport();
  if (!result) throw new AppError(500, 'Email batch failed; see server logs');
  sendSuccess(res, result);
}
