import dotenv from 'dotenv';
import { z } from 'zod';
// Values already present in process.env (e.g. set by the host or the test setup) win over .env.
dotenv.config({ quiet: true });
const emptyToUndefined = (value) => typeof value === 'string' && value.trim() === '' ? undefined : value;
const booleanString = z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1');
const commaSeparatedList = z
    .string()
    .transform((value) => value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0));
const httpUrl = z.url({ protocol: /^https?$/ }).transform((value) => value.replace(/\/+$/, ''));
const EnvSchema = z
    .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    DATABASE_URL: z
        .string()
        .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgres:// connection string'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    AUTO_MIGRATE: booleanString.default(true),
    APP_NAME: z.string().min(1).max(100).default('E-Library'),
    APP_URL: httpUrl,
    FRONTEND_URL: commaSeparatedList.pipe(z.array(httpUrl).min(1)),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    SMTP_SECURE: booleanString.default(true),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(3),
    MAGIC_LINK_EXPIRY_MINUTES: z.coerce.number().int().min(5).max(60 * 24 * 14).default(1440),
    EMAIL_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
    EMAIL_JOB_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(59).default(1),
    EMAIL_JOB_ENABLED: booleanString.default(true),
    EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(5),
    EMAIL_RECIPIENT_ALLOWLIST: commaSeparatedList
        .transform((items) => items.map((item) => item.toLowerCase()))
        .optional(),
    ADMIN_SECRET: z.string().min(32, 'must be at least 32 characters'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(168),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
})
    .superRefine((env, ctx) => {
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
        ctx.addIssue({
            code: 'custom',
            path: ['SMTP_PASSWORD'],
            message: 'SMTP_USER and SMTP_PASSWORD must be set together',
        });
    }
    if (env.NODE_ENV === 'production') {
        for (const url of [env.APP_URL, ...env.FRONTEND_URL]) {
            if (!url.startsWith('https://')) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['APP_URL'],
                    message: `must use https in production (got ${new URL(url).origin})`,
                });
            }
        }
        if (!env.SMTP_USER) {
            ctx.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'is required in production' });
        }
    }
});
function loadEnv() {
    const raw = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, emptyToUndefined(value)]));
    const result = EnvSchema.safeParse(raw);
    if (!result.success) {
        // Only variable names and rule messages are printed — never the values.
        const problems = result.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        console.error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
        process.exit(1);
    }
    return result.data;
}
export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
//# sourceMappingURL=env.js.map