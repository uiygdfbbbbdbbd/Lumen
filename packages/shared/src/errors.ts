/**
 * Stable error codes shared by server and clients. Never rename a code once
 * shipped: clients and SDKs branch on these strings.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  INVALID_TOKEN: 400,
  TOKEN_EXPIRED: 400,
  WEAK_PASSWORD: 400,
  DISPOSABLE_EMAIL: 400,
  CAPTCHA_FAILED: 400,
  SSRF_BLOCKED: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TWO_FACTOR_REQUIRED: 401,
  INVALID_TWO_FACTOR_CODE: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  EMAIL_VERIFICATION_REQUIRED: 403,
  FEATURE_LOCKED: 403,
  ACCOUNT_SUSPENDED: 403,
  SIGNUP_CLOSED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CONTENT_BLOCKED: 422,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  INTERNAL: 500,
  PROVIDER_ERROR: 502,
  PROVIDER_UNAVAILABLE: 503,
  MAINTENANCE: 503,
  STORAGE_QUOTA_EXCEEDED: 507,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
    /** For RATE_LIMITED / QUOTA_EXCEEDED: ISO timestamp when the limit resets. */
    resetAt?: string;
  };
}

export function statusForCode(code: ErrorCode): number {
  return ERROR_CODES[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** Error class usable on both client and server. */
export class LumenError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly resetAt?: string;
  constructor(code: ErrorCode, message?: string, opts: { details?: unknown; resetAt?: string } = {}) {
    super(message ?? code);
    this.name = 'LumenError';
    this.code = code;
    this.status = statusForCode(code);
    this.details = opts.details;
    this.resetAt = opts.resetAt;
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(requestId ? { requestId } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
        ...(this.resetAt ? { resetAt: this.resetAt } : {}),
      },
    };
  }
}
