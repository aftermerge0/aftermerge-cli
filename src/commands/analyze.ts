import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { apiRequest, ApiError } from "../http.js";
import { resolveConnectedRepo } from "../connected-repo.js";
import { waitForRun, printFindings } from "../run.js";
import { isAnalysisRun } from "../api-types.js";

const prOption = Options.integer("pr").pipe(
  Options.withDescription("Pull request number to analyze"),
);

export const analyzeCommand = Command.make("analyze", { pr: prOption }, ({ pr }) =>
  Effect.gen(function* () {
    const repo = yield* resolveConnectedRepo(
      "This repo isn't connected yet. Connect it from the web dashboard first, then try again.",
    );

    yield* Console.log(`Starting analysis for ${repo.owner}/${repo.name} PR #${pr}...`);
    const runRaw = yield* apiRequest("POST", "/api/analysis", {
      repositoryId: repo.id,
      pullRequestNumber: pr,
    });
    if (!isAnalysisRun(runRaw)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response starting the run."));
    }
    yield* Console.log(`Run id: ${runRaw.id}`);

    yield* waitForRun(runRaw);
    yield* printFindings(runRaw.id);
  }).pipe(
    // tapError (not catchAll): print the message but let the failure keep
    // propagating, so BunRuntime.runMain's default teardown exits non-zero —
    // a CLI's failures need to be visible to scripts/CI, unlike a web request.
    Effect.tapError((error: Error | ApiError) => Console.error(error.message)),
  ),
).pipe(Command.withDescription("Trigger analysis for a pull request in the current repo"));
