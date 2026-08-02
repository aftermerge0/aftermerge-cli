import { Command, Options, Prompt } from "@effect/cli";
import { Terminal } from "@effect/platform";
import type { HttpClient } from "@effect/platform";
import { Console, Effect, Option } from "effect";
import { apiRequest, ApiError } from "../http.js";
import { resolveConnectedRepo } from "../connected-repo.js";
import { waitForRun, printFindings } from "../run.js";
import { readTrackedFilesAtRef, type ArchivedFile } from "../upload.js";
import { getCurrentBranch, getDefaultBranch, resolveCommitSha, resolveCommitShaOrRemote } from "../git.js";
import { resolvePrRefs } from "../gh.js";
import { isAnalysisRun, isIndexedBranch, type IndexedBranch } from "../api-types.js";

const baseOption = Options.text("base").pipe(
  Options.optional,
  Options.withDescription("Base ref to diff against (defaults to the repo's default branch)"),
);

const prOption = Options.integer("pr").pipe(
  Options.optional,
  Options.withDescription(
    "Analyze a specific PR by number instead of the current branch — resolves branches via your local `gh` CLI, no GitHub token needed",
  ),
);

const contextOption = Options.boolean("context").pipe(
  Options.withDescription(
    "Pick other already-indexed repos/branches to include as cross-repo context (only already-indexed ones are offered — run `scan` inside another repo first, or index it from the dashboard, to make it available)",
  ),
);

const fetchIndexedBranches = (): Effect.Effect<IndexedBranch[], ApiError | Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const raw = yield* apiRequest("GET", "/api/repos/indexed-branches");
    if (!Array.isArray(raw) || !raw.every(isIndexedBranch)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response listing indexed branches."));
    }
    return raw;
  });

/** Ctrl+C here means "add no context repos," not "abort the scan" — treated
 * as an empty selection rather than propagated, since a cancelled picker
 * shouldn't cancel the whole command. */
const pickContextRepos = (currentRepositoryId: string) =>
  Effect.gen(function* () {
    const indexed = yield* fetchIndexedBranches();
    const candidates = indexed.filter((b) => b.repositoryId !== currentRepositoryId);
    if (candidates.length === 0) {
      yield* Console.log(
        "No other indexed repos/branches available as context yet — run `aftermerge scan` inside another repo's checkout first (or index it from the dashboard).",
      );
      return [];
    }
    return yield* Prompt.run(
      Prompt.multiSelect({
        message: "Include any of these already-indexed repos/branches as cross-repo context?",
        choices: candidates.map((b) => ({
          title: `${b.owner}/${b.name} @ ${b.branchName}`,
          value: b,
        })),
      }),
    ).pipe(
      Effect.catchAll((error) =>
        Terminal.isQuitException(error) ? Effect.succeed([] as IndexedBranch[]) : Effect.fail(error),
      ),
    );
  });

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

export const scanCommand = Command.make(
  "scan",
  { base: baseOption, pr: prOption, context: contextOption },
  ({ base, pr, context }) =>
  Effect.gen(function* () {
    if (Option.isSome(base) && Option.isSome(pr)) {
      return yield* Effect.fail(
        new Error("`--base` and `--pr` are mutually exclusive — `--pr` already determines both branches."),
      );
    }

    const repo = yield* resolveConnectedRepo(
      "This repo isn't connected yet. Run `aftermerge repos add-local` first, then try again.",
    );

    const prRefs = Option.isSome(pr) ? yield* resolvePrRefs(pr.value) : undefined;
    const contextRepos = context ? yield* pickContextRepos(repo.id) : [];

    const headBranch = prRefs ? prRefs.headBranch : yield* getCurrentBranch();
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
    const headCommitSha = prRefs
      ? yield* resolveCommitShaOrRemote(prRefs.headBranch)
      : yield* resolveCommitSha("HEAD");
    const baseBranch = prRefs ? prRefs.baseBranch : Option.isSome(base) ? base.value : yield* getDefaultBranch();
    const baseCommitSha = prRefs
      ? yield* resolveCommitShaOrRemote(prRefs.baseBranch)
      : yield* resolveCommitSha(baseBranch);

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

    yield* Console.log(
      prRefs
        ? `Starting analysis for ${repo.owner}/${repo.name} PR #${prRefs.number} (${baseBranch}...${headBranch})...`
        : `Starting analysis for ${repo.owner}/${repo.name} (${baseBranch}...${headBranch})...`,
    );
    const runRaw = yield* apiRequest("POST", "/api/analysis/local", {
      repositoryId: repo.id,
      headBranch,
      headCommitSha,
      baseBranch,
      baseCommitSha,
      ...(prRefs
        ? {
            pullRequest: {
              number: prRefs.number,
              title: prRefs.title,
              state: prRefs.state,
              headBranch: prRefs.headBranch,
              headSha: headCommitSha,
              baseBranch: prRefs.baseBranch,
              baseSha: baseCommitSha,
              url: prRefs.url,
            },
          }
        : {}),
      ...(contextRepos.length > 0
        ? {
            contextRepos: contextRepos.map((c) => ({
              repositoryId: c.repositoryId,
              branchName: c.branchName,
              commitSha: c.commitSha,
            })),
          }
        : {}),
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
    "Analyze the current branch vs. a base ref (or --pr <n>), optionally with --context repos, using only local git content — no GitHub token needed",
  ),
);
