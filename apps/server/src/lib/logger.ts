import pino, { type Logger } from 'pino';

/** Paths that must never reach logs. Matched case-sensitively by pino's redactor. */
export const REDACT_PATHS = [
  'password',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  'apiKey',
  '*.apiKey',
  '*.token',
  'token',
  '*.secret',
  '*.accessToken',
  '*.refreshToken',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'lumen-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

/** Last-line defense: masks secret-looking substrings inside free-form text (e.g. upstream error bodies). */
export function scrubSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk|lk)[-_][A-Za-z0-9_-]{12,}\b/g, '$1-[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED]');
}
