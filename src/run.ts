/** The poll-to-completion + print-findings workflow shared by `analyze` and
 * `scan` — previously duplicated near-verbatim in both command files (see
 * `cli/src/commands/analyze.ts`/`scan.ts` before this extraction). Kept
 * separate from `api-types.ts` (pure types/guards) since this holds actual
 * command-shaped behavior (polling cadence, user-facing messages). */
import { Console, Duration, Effect } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { apiRequest, ApiError } from "./http.js";
import {
  type AnalysisRun,
  type Finding,
  TERMINAL_STATUSES,
  isAnalysisRun,
  isFinding,
  type WireId,
} from "./api-types.js";

/** Polls `GET /api/analysis/:id` every 2s, printing each state transition,
 * until the run reaches a terminal status. Fails with a clean message if
 * the run doesn't end up `completed`. `initial` is the just-created run
 * returned by the "start analysis" call — its own status is checked first
 * so a run that's somehow already terminal doesn't do a pointless sleep. */
export const waitForRun = (
  initial: AnalysisRun,
): Effect.Effect<AnalysisRun, Error | ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    let current = initial;
    while (!TERMINAL_STATUSES.has(current.status)) {
      yield* Effect.sleep(Duration.seconds(2));
      const polled = yield* apiRequest("GET", `/api/analysis/${initial.id}`);
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
    return current;
  });

export const fetchFindings = (
  runId: WireId,
): Effect.Effect<readonly Finding[], Error | ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const findingsRaw = yield* apiRequest("GET", `/api/analysis/${runId}/findings`);
    if (!Array.isArray(findingsRaw) || !findingsRaw.every(isFinding)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response fetching findings."));
    }
    return findingsRaw;
  });

/** Fetches and pretty-prints every finding for a completed run. Call only
 * after `waitForRun` succeeds. */
export const printFindings = (runId: WireId): Effect.Effect<void, Error | ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const findings = yield* fetchFindings(runId);

    if (findings.length === 0) {
      yield* Console.log("No findings.");
      return;
    }
    yield* Console.log(`${findings.length} finding(s):`);
    for (const finding of findings) {
      yield* Console.log(`  [${finding.severity}/${finding.band}] ${finding.title}`);
    }
  });
