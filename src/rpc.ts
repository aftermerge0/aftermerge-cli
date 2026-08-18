/** Client for the backend's Effect-RPC mount (`app/api/rpc/[[...path]]`).
 *
 * The repo/branch/analysis/thread endpoints the CLI used to call as REST
 * routes (`GET /api/repos`, `GET /api/analysis/:id`, …) no longer exist —
 * they moved onto one RPC mount as `repos.list`, `branches.ensure`,
 * `analysis.get`, `threads.create`, and friends. Requests that still went to
 * the old paths got the Next.js HTML 404 page back, which surfaced as 200
 * characters of `<!DOCTYPE html>` in the error message.
 *
 * The wire format is hand-rolled rather than imported from the server's own
 * `RpcClient`: that lives on `effect/unstable/rpc` (Effect 4 beta), while
 * this CLI is on Effect 3 + `@effect/platform`, so the two clients cannot
 * share a runtime. The four endpoints that stayed on plain HTTP
 * (`/api/repos/local`, `/api/analysis/local`, `/api/ingest/upload`, and
 * Better Auth's device flow) keep using `apiRequest` from `http.ts`. */
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";
import { loadCredentials } from "./config.js";
import { ApiError, CLI_USER_AGENT, describeErrorBody } from "./http.js";
import { parseUrl } from "./url.js";

const RPC_PATH = "/api/rpc";

/** One HTTP round trip carries one request, so the correlation id inside the
 * envelope is only ever matched against itself. */
const REQUEST_ID = "1";

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** Reads the typed failure out of an encoded `Cause`.
 *
 * A handler failure comes back as HTTP 200 with `Failure` in the body — that
 * is the point of RPC's typed error channel — so the status the CLI reports
 * has to come from the error payload (`{ _tag, message, status }`), not the
 * response. `message` is passed through verbatim for the same reason
 * `apiRequest` does it: `LimitExceeded` and friends are matched on exact
 * message prefixes. `Die` means the handler crashed rather than failing
 * cleanly, and carries a defect string instead of an error object. */
const failureFromCause = (cause: unknown): ApiError => {
  for (const entry of Array.isArray(cause) ? cause : []) {
    if (!entry || typeof entry !== "object") continue;
    const encoded = entry as Record<string, unknown>;

    if (encoded._tag === "Fail") {
      const error = (encoded.error ?? {}) as Record<string, unknown>;
      const status = typeof error.status === "number" ? error.status : 500;
      const message =
        typeof error.message === "string" && error.message.length > 0
          ? error.message
          : typeof error._tag === "string"
            ? error._tag
            : "Request failed";
      // The server's word for an expired/invalid token is the bare string
      // "Unauthorized", which tells the user nothing about what to do next.
      return new ApiError({
        status,
        message:
          status === 401 ? `${message} — run \`aftermerge auth login\` to sign in again.` : message,
      });
    }

    if (encoded._tag === "Die") {
      const defect = encoded.defect;
      return new ApiError({
        status: 500,
        message: `Server error: ${typeof defect === "string" ? defect : JSON.stringify(defect)}`,
      });
    }

    if (encoded._tag === "Interrupt") {
      return new ApiError({ status: 500, message: "The server interrupted the request." });
    }
  }

  return new ApiError({ status: 500, message: "Request failed" });
};

const exitValue = (body: unknown): Effect.Effect<unknown, ApiError> => {
  const envelope = (Array.isArray(body) ? body : []).find(
    (entry): entry is Record<string, unknown> =>
      !!entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>)._tag === "Exit" &&
      (entry as Record<string, unknown>).requestId === REQUEST_ID,
  );
  if (!envelope) {
    return Effect.fail(new ApiError({ status: 500, message: "Invalid response from server" }));
  }

  const exit = envelope.exit as Record<string, unknown> | undefined;
  if (exit?._tag === "Success") return Effect.succeed(exit.value);
  if (exit?._tag === "Failure") return Effect.fail(failureFromCause(exit.cause));
  return Effect.fail(new ApiError({ status: 500, message: "Invalid response from server" }));
};

/** Calls one RPC method. `payload` must be `null` for the methods declared
 * without one (`repos.list`) — the server decodes against the declared
 * schema and rejects `{}` with "Expected null, got {}".
 *
 * `headers` is an ARRAY of pairs, not an object. The server feeds this field
 * straight to `Headers.fromInput`, which requires an iterable; an object
 * throws `TypeError: {} is not iterable` inside the protocol fiber, below
 * any handler, and the request then never gets a response at all — it just
 * hangs until the client gives up. */
export const rpcRequest = (
  tag: string,
  payload: unknown = null,
): Effect.Effect<unknown, ApiError | Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const credentials = yield* loadCredentials();
    if (!credentials) {
      return yield* Effect.fail(
        new ApiError({ status: 401, message: "Not signed in. Run `aftermerge auth login` first." }),
      );
    }

    const url = yield* parseUrl(RPC_PATH, credentials.baseUrl).pipe(
      Effect.mapError((cause) => new ApiError({ status: 0, message: cause.message })),
    );
    const authorization = `Bearer ${credentials.token}`;

    // The token is sent both as a real HTTP header and inside the envelope:
    // the auth middleware reads the RPC layer's own per-request headers, and
    // the transport header keeps anything in front of the app (proxy, CDN,
    // deployment protection) seeing an ordinary authenticated request.
    const request = HttpClientRequest.post(url.toString()).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeader("Authorization", authorization),
      HttpClientRequest.setHeader("User-Agent", CLI_USER_AGENT),
      HttpClientRequest.bodyUnsafeJson([
        {
          _tag: "Request",
          id: REQUEST_ID,
          tag,
          payload,
          headers: [["authorization", authorization]],
          traceId: randomHex(16),
          spanId: randomHex(8),
          sampled: false,
        },
      ]),
    );

    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError(
        (cause) => new ApiError({ status: 0, message: `Network error: ${cause.message}` }),
      ),
    );

    // Anything non-2xx here is transport-level (the mount is missing, or the
    // protocol itself died) — handler failures arrive as a 200 above.
    if (response.status >= 400) {
      const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* Effect.fail(
        new ApiError({ status: response.status, message: describeErrorBody(text, response.status) }),
      );
    }

    const body = yield* response.json.pipe(
      Effect.mapError(
        () => new ApiError({ status: response.status, message: "Invalid response from server" }),
      ),
    );
    return yield* exitValue(body);
  });
