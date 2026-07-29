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

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Refuse to send the session bearer token in cleartext.
 * `--server` accepts either an `https:` origin or a loopback host (a
 * local-dev server, e.g. `http://localhost:3000`, never leaves the machine
 * so it's exempt). Anything else over plain `http://` would put the token
 * on the wire in the clear on every subsequent command. */
export const validateServerUrl = (server: string): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => new URL(server),
    catch: () => new Error(`"${server}" is not a valid URL — did you forget "http://" or "https://"?`),
  }).pipe(
    Effect.flatMap((url) =>
      url.protocol === "https:" || LOCAL_HOSTNAMES.has(url.hostname)
        ? Effect.void
        : Effect.fail(
            new Error(
              `Refusing to sign in to "${server}" over plain HTTP — your session token would be sent in cleartext. Use an https:// URL, or localhost for local dev.`,
            ),
          ),
    ),
  );
