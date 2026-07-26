import { Command, Options } from "@effect/cli";
import type { HttpClient } from "@effect/platform";
import { Console, Effect, Option } from "effect";
import { apiRequest, ApiError } from "../http.js";
import {
  archiveFilesAtRef,
  getCurrentBranch,
  getDefaultBranch,
  getOriginRemote,
  normalizeCloneUrl,
  resolveCommitSha,
  type ArchivedFile,
} from "../git.js";

const baseOption = Options.text("base").pipe(
  Options.optional,
  Options.withDescription("Base ref to diff against (defaults to the repo's default branch)"),
);

interface RepoRow {
  readonly id: string;
  readonly cloneUrl: string;
  readonly owner: string;
  readonly name: string;
}

type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface AnalysisRun {
  readonly id: string;
  readonly status: RunStatus;
}

interface Finding {
  readonly title: string;
  readonly severity: string;
  readonly band: string;
  readonly description: string;
}

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled"]);
const KNOWN_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "completed", "failed", "cancelled"]);

const isRepoRow = (value: unknown): value is RepoRow => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.cloneUrl === "string" &&
    typeof v.owner === "string" &&
    typeof v.name === "string"
  );
};

const isAnalysisRun = (value: unknown): value is AnalysisRun => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.status === "string" && KNOWN_STATUSES.has(v.status);
};

const isFinding = (value: unknown): value is Finding => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && typeof v.severity === "string" && typeof v.band === "string";
};

/** Uploads one ref's content and waits for ingestion — `/api/ingest/upload`
 * runs the whole ingest synchronously (triggerAndWait) and is idempotent: if
 * this exact commit is already ingested, the server's own freshness check
 * returns almost immediately (see ingest-repo-from-upload.ts), so calling
 * this for a base ref that's already indexed from a prior scan costs
 * nothing beyond one quick round-trip. */
const uploadRef = (
  repositoryId: string,
  branch: string,
  commitSha: string,
  files: ArchivedFile[],
): Effect.Effect<void, ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    yield* apiRequest("POST", "/api/ingest/upload", { repositoryId, branch, commitSha, files });
  });

export const scanCommand = Command.make("scan", { base: baseOption }, ({ base }) =>
  Effect.gen(function* () {
    const remoteUrl = yield* getOriginRemote();
    const target = normalizeCloneUrl(remoteUrl);

    const reposRaw = yield* apiRequest("GET", "/api/repos");
    if (!Array.isArray(reposRaw) || !reposRaw.every(isRepoRow)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response listing repos."));
    }
    const repo = reposRaw.find((r) => normalizeCloneUrl(r.cloneUrl) === target);
    if (!repo) {
      return yield* Effect.fail(
        new Error(
          "This repo isn't connected yet. Run `aftermerge repos add-local` first, then try again.",
        ),
      );
    }

    const headBranch = yield* getCurrentBranch();
    const headCommitSha = yield* resolveCommitSha("HEAD");
    const baseBranch = Option.isSome(base) ? base.value : yield* getDefaultBranch();
    const baseCommitSha = yield* resolveCommitSha(baseBranch);

    if (headCommitSha === baseCommitSha) {
      return yield* Effect.fail(
        new Error(`'${headBranch}' and '${baseBranch}' are the same commit — nothing to analyze.`),
      );
    }

    yield* Console.log(`Reading ${baseBranch} (base)...`);
    const baseFiles = yield* archiveFilesAtRef(baseBranch);
    yield* Console.log(`Uploading and indexing ${baseBranch} (${baseFiles.length} files)...`);
    yield* uploadRef(repo.id, baseBranch, baseCommitSha, baseFiles);

    yield* Console.log(`Reading ${headBranch} (head)...`);
    const headFiles = yield* archiveFilesAtRef("HEAD");
    yield* Console.log(`Uploading and indexing ${headBranch} (${headFiles.length} files)...`);
    yield* uploadRef(repo.id, headBranch, headCommitSha, headFiles);

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

    let current: AnalysisRun = runRaw;
    while (!TERMINAL_STATUSES.has(current.status)) {
      yield* Effect.sleep("2 seconds");
      const polled = yield* apiRequest("GET", `/api/analysis/${runRaw.id}`);
      if (!isAnalysisRun(polled)) {
        return yield* Effect.fail(new Error("Server returned an unexpected response polling the run."));
      }
      current = polled;
      yield* Console.log(`  ${current.status}...`);
    }

    if (current.status !== "completed") {
      return yield* Effect.fail(
        new Error(
          current.status === "cancelled"
            ? "Run was cancelled — a newer analysis started for this branch."
            : "Analysis failed before completing.",
        ),
      );
    }

    const findingsRaw = yield* apiRequest("GET", `/api/analysis/${runRaw.id}/findings`);
    if (!Array.isArray(findingsRaw) || !findingsRaw.every(isFinding)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response fetching findings."));
    }

    if (findingsRaw.length === 0) {
      yield* Console.log("No findings.");
      return;
    }
    yield* Console.log(`${findingsRaw.length} finding(s):`);
    for (const finding of findingsRaw) {
      yield* Console.log(`  [${finding.severity}/${finding.band}] ${finding.title}`);
    }
  }).pipe(Effect.tapError((error: Error | ApiError) => Console.error(error.message))),
).pipe(
  Command.withDescription(
    "Analyze the current branch vs. a base ref, using only local git content — no GitHub token needed",
  ),
);
