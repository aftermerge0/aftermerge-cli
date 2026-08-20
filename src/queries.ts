import { Effect, Option } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { isRepoRow, type Finding, type RepoRow } from "./api-types.js";
import {
  createOrReuseThread,
  streamChatTurn,
  type ChatStreamEvent,
} from "./commands/chat.js";
import {
  DEFAULT_AUTH_SERVER,
  finishDeviceLogin,
  startDeviceLogin,
  type DeviceCodeResponse,
} from "./commands/auth.js";
import { runLocalScan } from "./commands/scan.js";
import { clearCredentials, loadCredentials } from "./config.js";
import { apiRequest, ApiError } from "./http.js";
import { fetchFindings } from "./run.js";
import type { ScanProgressEvent } from "./scan-progress.js";

export type { ChatStreamEvent, DeviceCodeResponse, Finding, RepoRow };
export { DEFAULT_AUTH_SERVER };

export interface SessionUser {
  readonly login: string;
  readonly org?: string;
}

/** Null when there is no stored token. Expired sessions fail. */
export const loadSession = (): Effect.Effect<
  SessionUser | null,
  Error | ApiError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const credentials = yield* loadCredentials();
    if (!credentials) {
      return null;
    }
    const session = (yield* apiRequest("GET", "/api/auth/get-session")) as {
      user?: { email?: string; name?: string };
      session?: { activeOrganizationId?: string };
    } | null;
    if (!session?.user) {
      return yield* Effect.fail(new Error("Your session has expired. Sign in again."));
    }
    return {
      login: session.user.name ?? session.user.email ?? "signed in",
      org: session.session?.activeOrganizationId,
    };
  });

export const listRepos = (): Effect.Effect<
  readonly RepoRow[],
  Error | ApiError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const reposRaw = yield* apiRequest("GET", "/api/repos");
    if (!Array.isArray(reposRaw) || !reposRaw.every(isRepoRow)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response listing repos."));
    }
    return reposRaw;
  });

export const listFindings = fetchFindings;

/** TUI never offers `--context` (that path is Prompt). Runtime still lists
 * `Prompt.Environment` on `runLocalScan`; we never take that branch here. */
export const scanCurrentRepo = (
  pr: number | undefined,
  onProgress?: (event: ScanProgressEvent) => void,
): Effect.Effect<{ readonly runId: string }, Error | ApiError, HttpClient.HttpClient> =>
  runLocalScan({
    base: Option.none(),
    pr: pr === undefined ? Option.none() : Option.some(pr),
    context: false,
    onProgress,
  }) as Effect.Effect<{ readonly runId: string }, Error | ApiError, HttpClient.HttpClient>;

export const beginLogin = (
  server: string = DEFAULT_AUTH_SERVER,
): Effect.Effect<DeviceCodeResponse, Error, HttpClient.HttpClient> => startDeviceLogin(server);

export const completeLogin = (
  server: string,
  code: DeviceCodeResponse,
): Effect.Effect<void, Error, HttpClient.HttpClient> => finishDeviceLogin(server, code);

export const signOut = (): Effect.Effect<void, Error> => clearCredentials();

export const ensureChatThread = createOrReuseThread;

export const sendChatTurn = streamChatTurn;

export { loadCredentials };
