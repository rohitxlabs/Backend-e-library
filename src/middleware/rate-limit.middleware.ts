import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

const MINUTE = 60 * 1000;

function limiter(windowMs: number, limit: number, keyGenerator?: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        success: false,
        message: 'Too many requests. Please try again later.',
      });
    },
  });
}

export interface RateLimiters {
  /** Coarse per-IP ceiling for every /api route. */
  api: RequestHandler;
  /** Per-IP brute-force protection on login. */
  login: RequestHandler;
  /** Per-account protection on login, so rotating IPs cannot hammer one account. */
  loginPerAccount: RequestHandler;
  verifySetupToken: RequestHandler;
  setPassword: RequestHandler;
  adminResend: RequestHandler;
}

/**
 * Limiters use in-memory stores, created per app instance. With several API instances behind a
 * load balancer, switch to a shared store (e.g. rate-limit-redis) so limits apply globally.
 */
export function createRateLimiters(): RateLimiters {
  return {
    api: limiter(15 * MINUTE, 300),
    login: limiter(15 * MINUTE, 10),
    loginPerAccount: limiter(15 * MINUTE, 10, (req) => {
      const email: unknown = req.body?.email;
      return `login:${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
    }),
    verifySetupToken: limiter(15 * MINUTE, 30),
    setPassword: limiter(15 * MINUTE, 10),
    adminResend: limiter(15 * MINUTE, 30),
  };
}
