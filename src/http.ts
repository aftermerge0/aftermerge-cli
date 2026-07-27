import { hostname } from "node:os";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Data, Effect } from "effect";
import { loadCredentials } from "./config.js";
import { parseUrl } from "./url.js";
import pkg from "../package.json" with { type: "json" };

/** Sent on every CLI request, including the unauthenticated device-code poll
 * (see auth.ts) — the request whose headers better-auth's session-creation
 * hook (`internalAdapter.createSession`) captures into the new session's
 * `userAgent` column. This is what lets the web dashboard's Security
 * settings page (plan 147 §3) label a device-issued session "CLI on
 * <hostname>" instead of running a non-browser UA through a browser parser. */
export const CLI_USER_AGENT = `aftermerge-cli/${pkg.version} (${hostname()})`;

/** Anything that reaches the CLI from the backend: a network failure, a
 * non-2xx response, or a body that isn't JSON. `message` is the wire's
 * `{ error }` string verbatim where one exists — never re-derive/rephrase it
 * (CLAUDE.md rule 5: LimitExceeded and friends match on exact message
 * prefixes client-side, and the CLI should honor the same contract). */
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number;
  readonly message: string;
}> {}

const parseErrorMessage = (body: unknown): string => {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "Request failed";
};

/** One authenticated call to the backend's existing `app/api/**` routes —
 * the CLI is a thin client of the same handlers the web app uses (plan 145),
 * so every tier/billing check they already enforce applies here too. Reads
 * the stored bearer token; fails with a clear message if not signed in. */
export const apiRequest = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Effect.Effect<unknown, ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const credentials = yield* loadCredentials();
    if (!credentials) {
      return yield* Effect.fail(
        new ApiError({ status: 401, message: "Not signed in. Run `aftermerge auth login` first." }),
      );
    }

    const url = yield* parseUrl(path, credentials.baseUrl).pipe(
      Effect.mapError((cause) => new ApiError({ status: 0, message: cause.message })),
    );
    let request = HttpClientRequest.make(method)(url.toString()).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(credentials.token),
      HttpClientRequest.setHeader("User-Agent", CLI_USER_AGENT),
    );
    if (body !== undefined) request = request.pipe(HttpClientRequest.bodyUnsafeJson(body));

    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError((cause) => new ApiError({ status: 0, message: `Network error: ${cause.message}` })),
    );
    const json = yield* response.json.pipe(
      Effect.mapError(() => new ApiError({ status: response.status, message: "Invalid response from server" })),
    );
    if (response.status >= 400) {
      return yield* Effect.fail(new ApiError({ status: response.status, message: parseErrorMessage(json) }));
    }
    return json;
  });
