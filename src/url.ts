import { Effect } from "effect";

/** `new URL(...)` throws synchronously on a malformed input. A plain throw
 * inside `Effect.gen` becomes an uncatchable defect (bypasses
 * `Effect.catchAll`), not a normal typed failure — this wraps it so a bad
 * `--server` value (e.g. missing scheme) surfaces as a clean error message
 * instead of a raw stack trace.
 *
 * Note `path` is resolved as an absolute path against `base`'s origin (per
 * WHATWG URL), so a `base` with its own path prefix (e.g.
 * `https://host/app`) has that prefix discarded — this assumes a root-mounted
 * deployment. */
export const parseUrl = (path: string, base: string): Effect.Effect<URL, Error> =>
  Effect.try({
    try: () => new URL(path, base),
    catch: () => new Error(`"${base}" is not a valid URL — did you forget "http://" or "https://"?`),
  });
