import { Command } from "@effect/cli";
import { Console, Effect } from "effect";
import { apiRequest, ApiError } from "../http.js";

interface RepoRow {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
}

const isRepoRow = (value: unknown): value is RepoRow => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.owner === "string" && typeof v.name === "string";
};

const list = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const reposRaw = yield* apiRequest("GET", "/api/repos");
    if (!Array.isArray(reposRaw) || !reposRaw.every(isRepoRow)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response listing repos."));
    }
    if (reposRaw.length === 0) {
      yield* Console.log("No repos connected. Connect one from the web dashboard.");
      return;
    }
    for (const repo of reposRaw) {
      yield* Console.log(`${repo.owner}/${repo.name}  (${repo.id})`);
    }
  }).pipe(Effect.tapError((error: Error | ApiError) => Console.error(error.message))),
).pipe(Command.withDescription("List repos connected to your org"));

export const reposCommand = Command.make("repos").pipe(
  Command.withDescription("Manage connected repos"),
  Command.withSubcommands([list]),
);
