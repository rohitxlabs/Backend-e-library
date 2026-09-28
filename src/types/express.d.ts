import type { SafeUser } from '../services/user.service.js';

declare global {
  namespace Express {
    interface Locals {
      /** Set by requireAuth. */
      user?: SafeUser;
    }
  }
}

export {};
