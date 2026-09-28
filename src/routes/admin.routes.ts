import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/admin.middleware.js';
import type { RateLimiters } from '../middleware/rate-limit.middleware.js';

export function createAdminRouter(limiters: RateLimiters): Router {
  const router = Router();

  // Every /api/admin/* route requires admin authentication.
  router.use(requireAdmin());

  router.get('/users', admin.getUsers);
  router.get('/email-status', admin.getEmailStatus);
  router.post('/resend-password-setup/:userId', limiters.adminResend, admin.resendPasswordSetup);

  return router;
}
