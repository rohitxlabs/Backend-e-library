import type { Request, Response } from 'express';
import { getAuthenticatedUser } from '../middleware/auth.middleware.js';
import * as authService from '../services/auth.service.js';
import { Errors } from '../utils/errors.js';
import { sendSuccess } from '../utils/http.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../utils/session-cookie.js';
import {
  loginBodySchema,
  setPasswordBodySchema,
  setupTokenSchema,
  verifySetupTokenQuerySchema,
} from '../validators/auth.validator.js';

/** GET /api/auth/verify-setup-token?token=... */
export async function verifySetupToken(req: Request, res: Response): Promise<void> {
  const parsed = verifySetupTokenQuerySchema.safeParse(req.query);
  if (!parsed.success) throw Errors.invalidToken();
  await authService.verifySetupToken(parsed.data.token);
  sendSuccess(res, { valid: true });
}

/** POST /api/auth/set-password { token, password, confirmPassword } */
export async function setPassword(req: Request, res: Response): Promise<void> {
  // A malformed token gets the same answer as an unknown one.
  const token = setupTokenSchema.safeParse(req.body?.token);
  if (!token.success) throw Errors.invalidToken();
  const body = setPasswordBodySchema.parse(req.body);
  await authService.setPasswordWithToken(token.data, body.password);
  sendSuccess(res, { passwordSet: true });
}

/** POST /api/auth/login { email, password } — sets the HTTP-only session cookie. */
export async function login(req: Request, res: Response): Promise<void> {
  const body = loginBodySchema.parse(req.body);
  // Replace any existing session instead of stacking them.
  await authService.logout(readSessionCookie(req));
  const { user, session } = await authService.login(body.email, body.password);
  setSessionCookie(res, session.sessionId, session.expiresAt);
  sendSuccess(res, { id: user.id, email: user.email });
}

/** POST /api/auth/logout — revokes the server-side session and clears the cookie. */
export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(readSessionCookie(req));
  clearSessionCookie(res);
  sendSuccess(res, { loggedOut: true });
}

/** GET /api/auth/me */
export function me(_req: Request, res: Response): void {
  const user = getAuthenticatedUser(res);
  sendSuccess(res, { id: user.id, email: user.email });
}
