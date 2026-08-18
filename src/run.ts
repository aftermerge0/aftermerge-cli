/** The poll-to-completion + print-findings workflow shared by `analyze` and
 * `scan` — previously duplicated near-verbatim in both command files (see
 * `cli/src/commands/analyze.ts`/`scan.ts` before this extraction). Kept
 * separate from `api-types.ts` (pure types/guards) since this holds actual
 * command-shaped behavior (polling cadence, user-facing messages). */
import type { HttpClient } from "@effect/platform";
import { Console, Effect } from "effect";
import { ApiError } from "./http.js";
import { rpcRequest } from "./rpc.js";
import { type AnalysisRun, TERMINAL_STATUSES, isAnalysisRun, isFinding } from "./api-types.js";

/** Polls `analysis.get` every 2s, printing each state transition,
 * until the run reaches a terminal status. Fails with a clean message if
 * the run doesn't end up `completed`. `initial` is the just-created run
 * returned by the "start analysis" call — its own status is checked first
 * so a run that's somehow already terminal doesn't do a pointless sleep. */
export const waitForRun = (
  initial: AnalysisRun,
): Effect.Effect<void, Error | ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    let current = initial;
    while (!TERMINAL_STATUSES.has(current.status)) {
      yield* Effect.sleep("2 seconds");
      const polled = yield* rpcRequest("analysis.get", { runId: initial.id });
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
  });

/** Fetches and pretty-prints every finding for a completed run. Call only
 * after `waitForRun` succeeds. */
export const printFindings = (runId: string): Effect.Effect<void, Error | ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const findingsRaw = yield* rpcRequest("analysis.findings", { runId });
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
  });
