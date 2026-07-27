import { Command, Options } from "@effect/cli";
import type { HttpClient } from "@effect/platform";
import { Console, Effect, Option } from "effect";
import { apiRequest, ApiError } from "../http.js";
import { resolveConnectedRepo } from "../connected-repo.js";
import { waitForRun, printFindings } from "../run.js";
import { readTrackedFilesAtRef, type ArchivedFile } from "../upload.js";
import { getCurrentBranch, getDefaultBranch, resolveCommitSha } from "../git.js";
import { isAnalysisRun } from "../api-types.js";

const baseOption = Options.text("base").pipe(
  Options.optional,
  Options.withDescription("Base ref to diff against (defaults to the repo's default branch)"),
);

/** Uploads one ref's content and waits for ingestion — `/api/ingest/upload`
 * runs the whole ingest synchronously (triggerAndWait) and is idempotent: if
 * this exact commit is already ingested, the server's own freshness check
 * returns almost immediately (see ingest-repo-from-upload.ts), so calling
 * this for a base ref that's already indexed from a prior scan costs
 * nothing beyond one quick round-trip.
 *
 * `step` labels which upload failed (base vs. head) in the error message —
 * both previously surfaced as the same bare "Request failed", making a
 * partial-upload failure (e.g. base succeeds, head fails) indistinguishable
 * from the other. The uploaded state itself is benign either way: no
 * analysis run is created until both uploads succeed, and a re-`scan` costs
 * only a quick freshness-check round-trip for whichever ref already landed. */
const uploadRef = (
  step: "base" | "head",
  repositoryId: string,
  branch: string,
  commitSha: string,
  files: ArchivedFile[],
): Effect.Effect<void, ApiError | Error, HttpClient.HttpClient> =>
  apiRequest("POST", "/api/ingest/upload", { repositoryId, branch, commitSha, files }).pipe(
    Effect.asVoid,
    Effect.mapError((error) =>
      error instanceof ApiError
        ? new ApiError({ status: error.status, message: `Uploading ${step} (${branch}): ${error.message}` })
        : new Error(`Uploading ${step} (${branch}): ${error.message}`),
    ),
  );

export const scanCommand = Command.make("scan", { base: baseOption }, ({ base }) =>
  Effect.gen(function* () {
    const repo = yield* resolveConnectedRepo(
      "This repo isn't connected yet. Run `aftermerge repos add-local` first, then try again.",
    );

    const headBranch = yield* getCurrentBranch();
    if (headBranch === "HEAD") {
      // `git rev-parse --abbrev-ref HEAD` prints the literal string "HEAD"
      // in detached-HEAD state (the normal state for most CI checkouts) —
      // previously that value flowed straight through into the uploaded
      // `branch` field, silently registering a server-side branch row
      // literally named "HEAD".
      return yield* Effect.fail(
        new Error(
          "You're in a detached HEAD state (no branch checked out) — `scan` needs a real branch name. Check out a branch first.",
        ),
      );
    }
    const headCommitSha = yield* resolveCommitSha("HEAD");
    const baseBranch = Option.isSome(base) ? base.value : yield* getDefaultBranch();
    const baseCommitSha = yield* resolveCommitSha(baseBranch);

    if (headCommitSha === baseCommitSha) {
      return yield* Effect.fail(
        new Error(`'${headBranch}' and '${baseBranch}' are the same commit — nothing to analyze.`),
      );
    }

    // Read content at the already-RESOLVED commit sha, not the ref name —
    // resolving a ref and archiving it are otherwise two separate git calls
    // with a window between them; a concurrent `git fetch`/checkout in that
    // window previously meant the content read could disagree with the sha
    // uploaded alongside it.
    yield* Console.log(`Reading ${baseBranch} (base)...`);
    const baseFiles = yield* readTrackedFilesAtRef(baseCommitSha);
    yield* Console.log(`Uploading and indexing ${baseBranch} (${baseFiles.length} files)...`);
    yield* uploadRef("base", repo.id, baseBranch, baseCommitSha, baseFiles);

    yield* Console.log(`Reading ${headBranch} (head)...`);
    const headFiles = yield* readTrackedFilesAtRef(headCommitSha);
    yield* Console.log(`Uploading and indexing ${headBranch} (${headFiles.length} files)...`);
    yield* uploadRef("head", repo.id, headBranch, headCommitSha, headFiles);

    yield* Console.log(`Starting analysis for ${repo.owner}/${repo.name} (${baseBranch}...${headBranch})...`);
    const runRaw = yield* apiRequest("POST", "/api/analysis/local", {
      repositoryId: repo.id,
      headBranch,
      headCommitSha,
      baseBranch,
      baseCommitSha,
    });
    if (!isAnalysisRun(runRaw)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response starting the run."));
    }
    yield* Console.log(`Run id: ${runRaw.id}`);

    yield* waitForRun(runRaw);
    yield* printFindings(runRaw.id);
  }).pipe(Effect.tapError((error: Error | ApiError) => Console.error(error.message))),
).pipe(
  Command.withDescription(
    "Analyze the current branch vs. a base ref, using only local git content — no GitHub token needed",
  ),
);
