import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import type { RateLimiters } from '../middleware/rate-limit.middleware.js';

export function createAuthRouter(limiters: RateLimiters): Router {
  const router = Router();

  router.get('/verify-setup-token', limiters.verifySetupToken, auth.verifySetupToken);
  router.post('/set-password', limiters.setPassword, auth.setPassword);
  router.post('/login', limiters.login, limiters.loginPerAccount, auth.login);
  router.post('/logout', auth.logout);
  router.get('/me', requireAuth, auth.me);

  return router;
}
