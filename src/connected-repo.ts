/** Bridges the local git checkout to the org's server-registered repo row —
 * shared by `analyze` and `scan`, which both need to answer "which
 * connected repo am I standing inside of?" before doing anything else.
 * Kept out of `git.ts` (pure git plumbing, no HTTP) and out of `run.ts`
 * (analysis-run lifecycle, not repo lookup) so each module keeps one job. */
import { Effect } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { apiRequest, ApiError } from "./http.js";
import { getOriginRemote, normalizeCloneUrl } from "./git.js";
import { type RepoRow, isRepoRow } from "./api-types.js";

/** Resolves the current directory's `origin` remote to a repo already
 * registered with the org. `notConnectedMessage` lets each caller give a
 * command-appropriate next step (the web dashboard for `analyze`, `repos
 * add-local` for `scan`). */
export const resolveConnectedRepo = (
  notConnectedMessage: string,
): Effect.Effect<RepoRow, Error | ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const remoteUrl = yield* getOriginRemote();
    const target = normalizeCloneUrl(remoteUrl);

    const reposRaw = yield* apiRequest("GET", "/api/repos");
    if (!Array.isArray(reposRaw) || !reposRaw.every(isRepoRow)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response listing repos."));
    }
    const repo = reposRaw.find((r) => normalizeCloneUrl(r.cloneUrl) === target);
    if (!repo) {
      return yield* Effect.fail(new Error(notConnectedMessage));
    }
    return repo;
  });
