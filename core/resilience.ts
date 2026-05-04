// ─── Error Classification ────────────────────────────────────────────────────

export type ErrorType = "FATAL" | "TRANSIENT" | "UNKNOWN";

/** Fatal error patterns — authentication/authorization/quota issues that won't resolve with retry */
export const FATAL_PATTERNS = [
  "unauthorized",
  "forbidden",
  "invalid token",
  "authentication failed",
  "permission denied",
  "401",
  "403",
  "credit balance",
  "auth error",
  "insufficient credit",
  "quota exceeded",
] as const;

/** Transient error patterns — temporary issues that may resolve with retry */
export const TRANSIENT_PATTERNS = [
  "timeout",
  "econnrefused",
  "econnreset",
  "etimedout",
  "rate limit",
  "too many requests",
  "429",
  "503",
  "502",
  "network error",
  "socket hang up",
  "exited with code",
  "temporarily unavailable",
  "connection reset",
] as const;

/**
 * Check if error message matches any pattern in the list.
 */
export function matchesPattern(message: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => message.includes(pattern));
}

/**
 * Classify an error to determine if it's transient (can retry) or fatal (should fail).
 * FATAL patterns take priority over TRANSIENT patterns to prevent an error message
 * containing both from being retried.
 */
export function classifyError(error: Error): ErrorType {
  const message = error.message.toLowerCase();

  if (matchesPattern(message, FATAL_PATTERNS)) {
    return "FATAL";
  }
  if (matchesPattern(message, TRANSIENT_PATTERNS)) {
    return "TRANSIENT";
  }
  return "UNKNOWN";
}

// ─── Safe Send Message ───────────────────────────────────────────────────────

export interface SafeSendMessageOptions {
  /** Threshold for consecutive UNKNOWN errors before throwing. Default: 3 */
  unknownThreshold?: number;
  /** Mutable counter shared across calls to track consecutive UNKNOWN errors. */
  unknownCounter?: { count: number };
}

export interface SafeSendMessageResult<T> {
  ok: boolean;
  value?: T;
  error?: Error;
  errorType?: ErrorType;
  unknownCount?: number;
}

/**
 * Execute a function with error classification and differentiated handling:
 * - TRANSIENT errors: swallow and return { ok: false }
 * - FATAL errors: re-throw immediately
 * - UNKNOWN errors: track consecutive occurrences; throw only when threshold is exceeded
 */
export async function safeSendMessage<T>(
  fn: () => T | Promise<T>,
  options: SafeSendMessageOptions = {},
): Promise<SafeSendMessageResult<T>> {
  const threshold = options.unknownThreshold ?? 3;
  const counter = options.unknownCounter ?? { count: 0 };

  try {
    const value = await Promise.resolve(fn());
    counter.count = 0;
    return { ok: true, value, unknownCount: counter.count };
  } catch (rawError) {
    const error = rawError instanceof Error ? rawError : new Error(String(rawError));
    const errorType = classifyError(error);

    if (errorType === "FATAL") {
      throw error;
    }

    if (errorType === "TRANSIENT") {
      return { ok: false, error, errorType, unknownCount: counter.count };
    }

    // UNKNOWN
    counter.count += 1;
    if (counter.count >= threshold) {
      throw error;
    }
    return { ok: false, error, errorType, unknownCount: counter.count };
  }
}

// ─── Retry Wrapper ───────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of retry attempts for TRANSIENT errors. Default: 2 */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000 */
  baseDelayMs?: number;
  /** Optional callback invoked before each retry. */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retry for TRANSIENT errors only.
 * FATAL and UNKNOWN errors fail immediately.
 * Backoff delays: baseDelayMs * attempt (linear by default; caller can customize via onRetry).
 */
export async function withRetry<T>(fn: () => T | Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await Promise.resolve(fn());
    } catch (rawError) {
      const error = rawError instanceof Error ? rawError : new Error(String(rawError));
      lastError = error;
      const errorType = classifyError(error);

      if (errorType === "FATAL" || errorType === "UNKNOWN") {
        throw error;
      }

      // TRANSIENT — retry if attempts remain
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * (attempt + 1);
        options.onRetry?.(attempt + 1, error, delayMs);
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error("Retry exhausted");
}
