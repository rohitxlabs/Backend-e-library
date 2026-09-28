import { Router } from 'express';
import * as cron from '../controllers/cron.controller.js';
import { requireCronSecret } from '../middleware/cron.middleware.js';

export function createCronRouter(): Router {
  const router = Router();

  router.use(requireCronSecret);
  // GET because that is what Vercel Cron sends.
  router.get('/password-setup-emails', cron.runPasswordSetupEmails);

  return router;
}
