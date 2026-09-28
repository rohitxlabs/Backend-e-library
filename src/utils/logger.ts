/**
 * Minimal structured (JSON lines) logger.
 *
 * Any field whose key looks sensitive (password, token, hash, secret, cookie, link, ...)
 * is replaced with "[REDACTED]" as a safety net. Callers should still never pass secrets.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const LEVEL_ORDER: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const SENSITIVE_KEY = /pass(word)?|secret|token|hash|authorization|cookie|link|credential|session/i;

// Read directly from process.env so the logger has no dependency on config (avoids import cycles).
function minLevel(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info') as Level | 'silent';
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 4) return '[Object]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  const out: Fields = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(item, depth + 1);
  }
  return out;
}

export function serializeError(error: unknown): Fields {
  if (!(error instanceof Error)) return { message: String(error) };
  const out: Fields = { name: error.name, message: error.message };
  const code = (error as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  if (process.env.NODE_ENV !== 'production' && error.stack) out.stack = error.stack;
  return out;
}

function write(level: Level, message: string, fields?: Fields): void {
  if (LEVEL_ORDER[level] < minLevel()) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(fields ? (sanitize(fields) as Fields) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (message: string, fields?: Fields) => write('debug', message, fields),
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};

/** "john.doe@example.com" -> "jo***@example.com" — enough to debug delivery without logging full addresses. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
