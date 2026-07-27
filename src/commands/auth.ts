import { Command, Options } from "@effect/cli";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Console, Effect } from "effect";
import { openInBrowser } from "../browser.js";
import { clearCredentials, loadCredentials, saveCredentials } from "../config.js";
import { apiRequest, CLI_USER_AGENT } from "../http.js";
import { parseUrl, validateServerUrl } from "../url.js";

// Not a secret — better-auth's deviceAuthorization plugin (src/lib/auth.ts)
// has no validateClient configured, so any non-empty client_id is accepted.
// Fixed rather than configurable: there is exactly one CLI client.
const CLIENT_ID = "aftermerge-cli";

const serverOption = Options.text("server").pipe(
  Options.withDefault("http://localhost:3000"),
  Options.withDescription(
    "Base URL of your AfterMerge deployment (defaults to local dev; pass --server for a real deployment)",
  ),
);

interface DeviceCodeResponse {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri_complete: string;
  readonly interval: number;
}

type DeviceTokenResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly retry: true }
  | { readonly ok: false; readonly retry: false; readonly message: string };

/** Guards against a malformed/malicious response before it's trusted —
 * `interval` in particular feeds `Effect.sleep` in `pollForToken`, and an
 * invalid duration string there would throw synchronously (an uncatchable
 * defect, not a normal Effect failure — see the parseUrl comment). */
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
    Number.isFinite(v.interval) &&
    v.interval > 0
  );
};

/** RFC 8628 device-code request against better-auth's deviceAuthorization
 * plugin (src/lib/auth.ts) — unauthenticated, so this bypasses `apiRequest`
 * (which requires a stored token) and talks to HttpClient directly. */
const requestDeviceCode = (server: string): Effect.Effect<DeviceCodeResponse, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const url = yield* parseUrl("/api/auth/device/code", server);
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeader("User-Agent", CLI_USER_AGENT),
      HttpClientRequest.bodyUnsafeJson({ client_id: CLIENT_ID }),
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
      HttpClientRequest.bodyUnsafeJson({
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
      return { ok: false, retry: true };
    }
    return { ok: false, retry: false, message: json.error_description ?? "Sign-in was not completed" };
  });

const pollForToken = (
  server: string,
  code: DeviceCodeResponse,
): Effect.Effect<string, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(`${code.interval} seconds`);
      const result = yield* pollOnce(server, code.device_code);
      if (result.ok) return result.accessToken;
      if (!result.retry) return yield* Effect.fail(new Error(result.message));
    }
  });

const login = Command.make("login", { server: serverOption }, ({ server }) =>
  Effect.gen(function* () {
    yield* validateServerUrl(server);
    const code = yield* requestDeviceCode(server);

    yield* Console.log("");
    yield* Console.log(`  Code: ${code.user_code}`);
    yield* Console.log(`  Visit: ${code.verification_uri_complete}`);
    yield* Console.log("");
    yield* Console.log("Opening your browser — waiting for you to approve...");
    yield* openInBrowser(code.verification_uri_complete);

    const token = yield* pollForToken(server, code);
    yield* saveCredentials({ baseUrl: server, token });
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
  }),
).pipe(Command.withDescription("Sign out and remove the stored credentials"));

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage CLI sign-in"),
  Command.withSubcommands([login, whoami, logout]),
);
