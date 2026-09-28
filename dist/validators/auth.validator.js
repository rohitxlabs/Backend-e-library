import { z } from 'zod';
/** Raw magic-link tokens are base64url (43 chars for 32 bytes). Reject anything else early. */
export const setupTokenSchema = z
    .string()
    .trim()
    .min(32)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/);
export const PASSWORD_MIN_LENGTH = 10;
// Upper bound keeps Argon2 work per request bounded.
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character')
    .refine((value) => value.trim() === value, 'Password must not start or end with whitespace');
export const verifySetupTokenQuerySchema = z.object({
    token: setupTokenSchema,
});
/** Token is validated separately so a malformed token yields the generic token error. */
export const setPasswordBodySchema = z
    .object({
    token: z.string(),
    password: passwordSchema,
    confirmPassword: z.string(),
})
    .refine((body) => body.password === body.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
});
export const loginBodySchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email('Invalid email address').max(255)),
    password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});
//# sourceMappingURL=auth.validator.js.map