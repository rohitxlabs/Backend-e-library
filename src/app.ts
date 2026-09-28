import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { health } from './controllers/health.controller.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { createRateLimiters } from './middleware/rate-limit.middleware.js';
import { noStore, requireTrustedOrigin } from './middleware/security.middleware.js';
import { createAdminRouter } from './routes/admin.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createCronRouter } from './routes/cron.routes.js';

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(): Express {
  const app = express();
  const limiters = createRateLimiters();

  // Needed for correct client IPs (rate limiting) and secure cookies behind a reverse proxy.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL, // explicit allow-list, never "*"
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/health', health);

  app.use('/api', limiters.api, requireTrustedOrigin, noStore);
  app.use('/api/auth', createAuthRouter(limiters));
  app.use('/api/admin', createAdminRouter(limiters));
  app.use('/api/cron', createCronRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Serverless entry point. Vercel's Express support loads this file (src/app.ts) and serves
 * requests with its default export. Long-running hosts use src/server.ts instead, which also
 * runs migrations and starts the in-process email worker; on Vercel the worker is replaced by
 * GET /api/cron/password-setup-emails.
 */
export default createApp();
