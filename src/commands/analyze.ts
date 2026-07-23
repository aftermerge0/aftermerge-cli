import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { apiRequest, ApiError } from "../http.js";

const prOption = Options.integer("pr").pipe(
  Options.withDescription("Pull request number to analyze"),
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

// Guards on every cast API response before it's used: an `as`-cast alone
// doesn't stop a malformed/differently-shaped body from throwing once it's
// actually read (e.g. `.find` on a non-array, `.status` on `null`) — and a
// plain throw inside `Effect.gen` is an uncatchable defect, not a normal
// Effect failure (see url.ts's doc comment for the same footgun). These
// guards turn that into a clean, catchable `Error` instead.
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

/** Normalizes a git remote / stored clone URL (SSH or HTTPS, with or without
 * `.git`) to one comparable form — `cloneUrl` is always stored as GitHub's
 * `https://…/owner/repo.git` (Octokit's `clone_url`, see
 * app/api/repos/discover/route.ts), while `git remote get-url origin` can be
 * either form depending on how the user cloned. */
const normalizeCloneUrl = (url: string): string =>
  url
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();

const getOriginRemote = (): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error("Not a git repository, or no 'origin' remote is configured here.");
      }
      return output.trim();
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error("Could not read the local git repository."),
  });

export const analyzeCommand = Command.make("analyze", { pr: prOption }, ({ pr }) =>
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
        new Error("This repo isn't connected yet. Connect it from the web dashboard first, then try again."),
      );
    }

    yield* Console.log(`Starting analysis for ${repo.owner}/${repo.name} PR #${pr}...`);
    const runRaw = yield* apiRequest("POST", "/api/analysis", {
      repositoryId: repo.id,
      pullRequestNumber: pr,
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
  }).pipe(
    // tapError (not catchAll): print the message but let the failure keep
    // propagating, so BunRuntime.runMain's default teardown exits non-zero —
    // a CLI's failures need to be visible to scripts/CI, unlike a web request.
    Effect.tapError((error: Error | ApiError) => Console.error(error.message)),
  ),
).pipe(Command.withDescription("Trigger analysis for a pull request in the current repo"));
