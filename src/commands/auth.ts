import { Console, Duration, Effect, Result } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { openInBrowser } from "../browser.js";
import { clearCredentials, loadCredentials, saveCredentials } from "../config.js";
import { apiRequest, CLI_USER_AGENT } from "../http.js";
import { parseUrl, validateServerUrl } from "../url.js";

// Not a secret — better-auth's deviceAuthorization plugin (src/lib/auth.ts)
// has no validateClient configured, so any non-empty client_id is accepted.
// Fixed rather than configurable: there is exactly one CLI client.
const CLIENT_ID = "aftermerge-cli";

export const DEFAULT_AUTH_SERVER = "https://www.aftermerge.dev";

const serverOption = Flag.string("server").pipe(
  Flag.withDefault(DEFAULT_AUTH_SERVER),
  Flag.withDescription(
    "Base URL of your AfterMerge deployment (defaults to production; pass --server http://localhost:3000 for local dev)",
  ),
);

const MIN_POLL_INTERVAL_SECONDS = 1;
const MAX_POLL_INTERVAL_SECONDS = 300;
// This plugin's documented default code lifetime (README) — used only if a
// server's response omits `expires_in` (RFC 8628 requires it, but nothing
// stops a nonconforming server from leaving it out).
const DEFAULT_EXPIRES_IN_SECONDS = 30 * 60;
const MAX_EXPIRES_IN_SECONDS = 24 * 60 * 60;
// RFC 8628 §3.5: on `slow_down`, the client MUST increase its poll interval
// by at least 5 seconds for all subsequent requests — polling at the
// unchanged rate is what triggers the rate limit in the first place.
const SLOW_DOWN_INCREMENT_SECONDS = 5;
// A single transient blip (a proxy 502, a momentary network error, one
// malformed response) shouldn't kill the whole sign-in — only a server
// that's persistently broken should.
const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 3;

export interface DeviceCodeResponse {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri_complete: string;
  readonly interval: number;
  // Optional per the comment above, though RFC 8628 requires it — validated
  // strictly when present rather than trusted blindly.
  readonly expires_in?: number;
}

type DeviceTokenResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly retry: true; readonly slowDown: boolean }
  | { readonly ok: false; readonly retry: false; readonly message: string };

/** Guards against a malformed/malicious response before it's trusted.
 * `interval`/`expires_in` in particular feed `pollForToken`'s sleep/timeout —
 * bounding them here (not just checking they're positive numbers) is what
 * actually closes the footgun: JS renders numbers outside roughly
 * `[1e-6, 1e21)` in exponential notation (e.g. `"1e-7"`), which a
 * template-string `Effect.sleep` duration rejects with an uncatchable
 * defect. A `Number.isFinite(x) && x > 0` check alone does not catch this —
 * `1e21` and `1e-7` both pass it. */
const isValidDeviceCodeResponse = (value: unknown): value is DeviceCodeResponse => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.device_code === "string" &&
    v.device_code.length > 0 &&
    typeof v.user_code === "string" &&
    v.user_code.length > 0 &&
    typeof v.verification_uri_complete === "string" &&
    v.verification_uri_complete.length > 0 &&
    typeof v.interval === "number" &&
    Number.isInteger(v.interval) &&
    v.interval >= MIN_POLL_INTERVAL_SECONDS &&
    v.interval <= MAX_POLL_INTERVAL_SECONDS &&
    (v.expires_in === undefined ||
      (typeof v.expires_in === "number" &&
        Number.isInteger(v.expires_in) &&
        v.expires_in > 0 &&
        v.expires_in <= MAX_EXPIRES_IN_SECONDS))
  );
};

/** RFC 8628 device-code request against better-auth's deviceAuthorization
 * plugin (src/lib/auth.ts) — unauthenticated, so this bypasses `apiRequest`
 * (which requires a stored token) and talks to HttpClient directly. */
export const requestDeviceCode = (server: string): Effect.Effect<DeviceCodeResponse, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const url = yield* parseUrl("/api/auth/device/code", server);
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeader("User-Agent", CLI_USER_AGENT),
      HttpClientRequest.bodyJsonUnsafe({ client_id: CLIENT_ID }),
    );
    const response = yield* client.execute(request).pipe(
      Effect.mapError((cause) => new Error(`Could not reach ${server}: ${cause.message}`)),
    );
    const json = yield* response.json.pipe(
      Effect.mapError(() => new Error("Invalid response from server")),
    );
    if (response.status >= 400) {
      const message =
        json && typeof json === "object" && "error_description" in json
          ? (json as { error_description?: string }).error_description
          : undefined;
      return yield* Effect.fail(new Error(message ?? "Could not start sign-in"));
    }
    if (!isValidDeviceCodeResponse(json)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response starting sign-in"));
    }
    return json;
  });

/** One poll of `/device/token`. Distinguishes "keep polling" from "stop" —
 * the plugin's `authorization_pending`/`slow_down` codes mean try again;
 * anything else (expired, denied, invalid) is terminal. */
const pollOnce = (server: string, deviceCode: string): Effect.Effect<DeviceTokenResult, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const url = yield* parseUrl("/api/auth/device/token", server);
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeader("User-Agent", CLI_USER_AGENT),
      HttpClientRequest.bodyJsonUnsafe({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: CLIENT_ID,
      }),
    );
    const response = yield* client.execute(request).pipe(
      Effect.mapError((cause) => new Error(`Could not reach ${server}: ${cause.message}`)),
    );
    const rawJson = yield* response.json.pipe(
      Effect.mapError(() => new Error("Invalid response from server")),
    );
    if (!rawJson || typeof rawJson !== "object") {
      return yield* Effect.fail(new Error("Server returned an unexpected response polling for sign-in"));
    }
    const json = rawJson as { access_token?: string; error?: string; error_description?: string };

    if (response.status < 400 && json.access_token) {
      return { ok: true, accessToken: json.access_token };
    }
    if (json.error === "authorization_pending" || json.error === "slow_down") {
      return { ok: false, retry: true, slowDown: json.error === "slow_down" };
    }
    return { ok: false, retry: false, message: json.error_description ?? "Sign-in was not completed" };
  });

/** Polls until the user approves/denies, the server reports a terminal
 * error, or the device code's own expiry passes — whichever comes first.
 * Two RFC 8628 requirements this previously missed entirely: the poll loop
 * had no client-side deadline (termination depended 100% on the server
 * eventually stopping `authorization_pending`), and `slow_down` was treated
 * as a plain retry instead of §3.5's mandated interval increase. Also
 * tolerates a single bad poll response instead of aborting the whole
 * sign-in over one transient blip. */
export const pollForToken = (
  server: string,
  code: DeviceCodeResponse,
): Effect.Effect<string, Error, HttpClient.HttpClient> => {
  const deadline = Duration.seconds(code.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS);

  const poll = Effect.gen(function* () {
    let interval = code.interval;
    let consecutiveTransientFailures = 0;

    while (true) {
      yield* Effect.sleep(Duration.seconds(interval));

      const result = yield* Effect.result(pollOnce(server, code.device_code));
      if (Result.isFailure(result)) {
        consecutiveTransientFailures++;
        if (consecutiveTransientFailures > MAX_CONSECUTIVE_TRANSIENT_FAILURES) {
          return yield* Effect.fail(result.failure);
        }
        continue;
      }
      consecutiveTransientFailures = 0;

      const value = result.success;
      if (value.ok) return value.accessToken;
      if (!value.retry) return yield* Effect.fail(new Error(value.message));
      if (value.slowDown) interval += SLOW_DOWN_INCREMENT_SECONDS;
    }
  });

  return poll.pipe(
    Effect.timeoutOrElse({
      duration: deadline,
      orElse: () =>
        Effect.fail(new Error("Sign-in code expired before it was approved. Run `aftermerge auth login` again.")),
    }),
  );
};

/** Start device-code login: request a code and open the browser. TUI polls
 * separately so the device code can render while we wait. */
export const startDeviceLogin = (
  server: string,
): Effect.Effect<DeviceCodeResponse, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    yield* validateServerUrl(server);
    const code = yield* requestDeviceCode(server);
    yield* openInBrowser(code.verification_uri_complete);
    return code;
  });

export const finishDeviceLogin = (
  server: string,
  code: DeviceCodeResponse,
): Effect.Effect<void, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const token = yield* pollForToken(server, code);
    yield* saveCredentials({ baseUrl: server, token });
  });

const login = Command.make("login", { server: serverOption }, ({ server }) =>
  Effect.gen(function* () {
    const code = yield* startDeviceLogin(server);

    yield* Console.log("");
    yield* Console.log(`  Code: ${code.user_code}`);
    yield* Console.log(`  Visit: ${code.verification_uri_complete}`);
    yield* Console.log("");
    yield* Console.log("Opening your browser — waiting for you to approve...");

    yield* finishDeviceLogin(server, code);
    yield* Console.log("Signed in.");
  }).pipe(
    // tapError (not catchAll): print the message but let the failure keep
    // propagating, so BunRuntime.runMain's default teardown exits non-zero.
    Effect.tapError((error) => Console.error(`Sign-in failed: ${error.message}`)),
  ),
).pipe(Command.withDescription("Sign in via your browser"));

const whoami = Command.make("whoami", {}, () =>
  Effect.gen(function* () {
    const credentials = yield* loadCredentials();
    if (!credentials) {
      return yield* Effect.fail(new Error("Not signed in. Run `aftermerge auth login` first."));
    }
    const session = (yield* apiRequest("GET", "/api/auth/get-session")) as {
      user?: { email?: string; name?: string };
      session?: { activeOrganizationId?: string };
    } | null;
    if (!session?.user) {
      return yield* Effect.fail(new Error("Your session has expired. Run `aftermerge auth login` again."));
    }
    yield* Console.log(`Signed in as ${session.user.name ?? session.user.email} (${session.user.email})`);
    if (session.session?.activeOrganizationId) {
      yield* Console.log(`Organization: ${session.session.activeOrganizationId}`);
    }
    yield* Console.log(`Server: ${credentials.baseUrl}`);
  }).pipe(
    Effect.tapError((error) => Console.error(`Could not check sign-in status: ${error.message}`)),
  ),
).pipe(Command.withDescription("Show the currently signed-in user"));

const logout = Command.make("logout", {}, () =>
  Effect.gen(function* () {
    yield* clearCredentials();
    yield* Console.log("Signed out.");
  }).pipe(Effect.tapError((error) => Console.error(error.message))),
).pipe(Command.withDescription("Sign out and remove the stored credentials"));

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage CLI sign-in"),
  Command.withSubcommands([login, whoami, logout]),
);
