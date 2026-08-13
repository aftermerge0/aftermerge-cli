import { Duration, Effect, Schedule } from "effect";

/** Transient-failure retry policy shared by the HTTP callers.
 *
 * Exponential backoff with full jitter: without jitter, every client that
 * saw the same upstream blip retries on the same tick and re-creates the
 * spike that caused the blip. */
export interface RetryOptions {
  /** Total number of attempts, including the first one. */
  readonly attempts: number;
  /** Delay before the second attempt; doubles from there. */
  readonly baseDelay: Duration.DurationInput;
  /** Ceiling for a single delay, so a long backoff can't wander into minutes. */
  readonly maxDelay: Duration.DurationInput;
}

export const defaultRetryOptions: RetryOptions = {
  attempts: 4,
  baseDelay: "250 millis",
  maxDelay: "8 seconds",
};

/** HTTP statuses worth a second attempt. 429 and 5xx are the server telling
 * us "later"; a 4xx other than 429 will fail identically no matter how many
 * times we ask. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export const isRetryableStatus = (status: number): boolean =>
  RETRYABLE_STATUSES.has(status) || status >= 500;

/** Honours `Retry-After`, which the API sends on 429 as either a delay in
 * seconds or an HTTP date. A server-supplied delay always beats our own
 * guess — it's the only party that knows when the bucket refills. */
export const parseRetryAfter = (header: string | null, now = Date.now()): number | undefined => {
  if (header === null) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
};

const withJitter = (millis: number): number => Math.random() * millis;

/** Retries `effect` while `isTransient` holds, backing off exponentially.
 * Failures that aren't transient short-circuit immediately so a bad token
 * doesn't cost the user four round trips before it says so. */
export const retryTransient = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  isTransient: (error: E) => boolean,
  options: RetryOptions = defaultRetryOptions,
): Effect.Effect<A, E, R> => {
  const base = Duration.toMillis(Duration.decode(options.baseDelay));
  const max = Duration.toMillis(Duration.decode(options.maxDelay));

  const schedule = Schedule.recurs(options.attempts - 1).pipe(
    Schedule.addDelay((attempt: number) =>
      Duration.millis(withJitter(Math.min(base * 2 ** attempt, max))),
    ),
    Schedule.whileInput(isTransient),
  );

  return Effect.retry(effect, schedule);
};
