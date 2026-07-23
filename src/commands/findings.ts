import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";
import { apiRequest, ApiError } from "../http.js";

const runIdArg = Args.text({ name: "run-id" }).pipe(
  Args.withDescription("Analysis run id (printed by `aftermerge analyze`)"),
);

interface Finding {
  readonly title: string;
  readonly severity: string;
  readonly band: string;
  readonly description: string;
}

const isFinding = (value: unknown): value is Finding => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && typeof v.severity === "string" && typeof v.band === "string";
};

const list = Command.make("list", { runId: runIdArg }, ({ runId }) =>
  Effect.gen(function* () {
    const findingsRaw = yield* apiRequest("GET", `/api/analysis/${runId}/findings`);
    if (!Array.isArray(findingsRaw) || !findingsRaw.every(isFinding)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response fetching findings."));
    }
    if (findingsRaw.length === 0) {
      yield* Console.log("No findings.");
      return;
    }
    for (const finding of findingsRaw) {
      yield* Console.log(`[${finding.severity}/${finding.band}] ${finding.title}`);
      yield* Console.log(`  ${finding.description}`);
    }
  }).pipe(Effect.tapError((error: Error | ApiError) => Console.error(error.message))),
).pipe(Command.withDescription("List findings for an analysis run"));

export const findingsCommand = Command.make("findings").pipe(
  Command.withDescription("View analysis findings"),
  Command.withSubcommands([list]),
);
