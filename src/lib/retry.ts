export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const isRetryable = options.isRetryable ?? (() => true);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) break;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.(error, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}
