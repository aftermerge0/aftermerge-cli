import { Args, Command, Options, Prompt } from "@effect/cli";
import type { HttpClient } from "@effect/platform";
import { Console, Effect, Option } from "effect";
import { apiRequest, ApiError } from "../http.js";
import { getDefaultBranch, getOriginRemote, parseOwnerName } from "../git.js";
import { onQuit } from "../prompt-utils.js";
import { type RepoRow, isRepoRow, isRegisteredRepo, isEnsuredBranch } from "../api-types.js";

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

/** Shared by `add` and `remove` — both take a GitHub `owner/name` shorthand
 * rather than an internal repo id, since that's what a user actually knows.
 * Named distinctly from `git.ts`'s `parseOwnerName` (which parses a clone
 * URL, not this CLI-argument shorthand) — the two used to collide under the
 * same name, resolved only by an import alias at the call site. */
const parseOwnerRepoArg = (ownerRepo: string): Effect.Effect<{ owner: string; name: string }, Error> => {
  const parts = ownerRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return Effect.fail(
      new Error(`"${ownerRepo}" isn't a valid owner/name — expected e.g. acme/billing-service`),
    );
  }
  return Effect.succeed({ owner: parts[0], name: parts[1] });
};

/** Resolves owner/name to the org's connected repo row — `remove` (and any
 * future owner/name-addressed command) needs the internal id, which the
 * user doesn't have memorized. */
const findRepo = (owner: string, name: string): Effect.Effect<RepoRow, Error | ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const reposRaw = yield* apiRequest("GET", "/api/repos");
    if (!Array.isArray(reposRaw) || !reposRaw.every(isRepoRow)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response listing repos."));
    }
    const match = reposRaw.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
      return yield* Effect.fail(new Error(`${owner}/${name} isn't connected to your org.`));
    }
    return match;
  });

const ownerRepoArg = Args.text({ name: "owner/name" }).pipe(
  Args.withDescription("GitHub repo, e.g. acme/billing-service"),
);

const branchOption = Options.text("branch").pipe(
  Options.optional,
  Options.withDescription(
    "Also track this branch (e.g. your production branch, if it differs from GitHub's configured default branch)",
  ),
);

const autoIndexOption = Options.boolean("auto-index").pipe(
  Options.withDescription(
    "Index the default branch immediately after registering (uses analysis/LLM budget — off by default, same as the web dashboard)",
  ),
);

/** Wraps the exact same route the web dashboard's "connect repo" dialog
 * calls (POST /api/repos, app/api/repos/route.ts) — same
 * `BillingService.assertCanAddRepo` seat/plan check, same VCS-connection
 * validation, same audit log entry. Registering an *additional* branch
 * beyond GitHub's own default (POST /api/repos/[id]/branches) is a
 * separate, unbilled call — it only materializes a `branches` row, it
 * doesn't count against the repo-count limit. */
const add = Command.make(
  "add",
  { ownerRepo: ownerRepoArg, branch: branchOption, autoIndex: autoIndexOption },
  ({ ownerRepo, branch, autoIndex }) =>
    Effect.gen(function* () {
      const { owner, name } = yield* parseOwnerRepoArg(ownerRepo);

      const created = yield* apiRequest("POST", "/api/repos", { owner, name, autoIndex });
      if (!isRegisteredRepo(created)) {
        return yield* Effect.fail(new Error("Server returned an unexpected response registering the repo."));
      }
      yield* Console.log(`Registered ${created.owner}/${created.name}  (${created.id})`);
      yield* Console.log(`Default branch: ${created.defaultBranch}`);

      if (Option.isSome(branch) && branch.value !== created.defaultBranch) {
        const ensured = yield* apiRequest("POST", `/api/repos/${created.id}/branches`, {
          branchName: branch.value,
        });
        if (!isEnsuredBranch(ensured)) {
          return yield* Effect.fail(
            new Error("Repo was registered, but the server returned an unexpected response tracking the branch."),
          );
        }
        yield* Console.log(`Also tracking branch: ${ensured.name}`);
      }
    }).pipe(Effect.tapError((error: Error | ApiError) => Console.error(error.message))),
).pipe(Command.withDescription("Register a repo with your org (same plan/seat checks as the web dashboard)"));

/** Wraps POST /api/repos/local (plan 149) — registers the repo in the
 * CURRENT directory without ever sending us a GitHub token. Every field
 * (`owner`/`name`/`cloneUrl`/`defaultBranch`) is derived from the local git
 * checkout, not a GitHub API call: `defaultBranch` in particular comes from
 * `refs/remotes/origin/HEAD`, which a normal `git clone` already sets
 * locally. Same `assertCanAddRepo` seat/plan check as `add` — that check is
 * provider-agnostic, it just counts rows, so it enforces identically here. */
const addLocal = Command.make("add-local", {}, () =>
  Effect.gen(function* () {
    const remoteUrl = yield* getOriginRemote();
    const parsed = parseOwnerName(remoteUrl);
    if (!parsed) {
      return yield* Effect.fail(
        new Error(`Could not parse a GitHub owner/repo from this remote: ${remoteUrl}`),
      );
    }
    const defaultBranch = yield* getDefaultBranch();

    const created = yield* apiRequest("POST", "/api/repos/local", {
      owner: parsed.owner,
      name: parsed.name,
      cloneUrl: remoteUrl,
      defaultBranch,
    });
    if (!isRegisteredRepo(created)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response registering the repo."));
    }
    yield* Console.log(`Registered ${created.owner}/${created.name}  (${created.id})`);
    yield* Console.log(`Default branch: ${created.defaultBranch}`);
  }).pipe(Effect.tapError((error: Error | ApiError) => Console.error(error.message))),
).pipe(
  Command.withDescription(
    "Register the repo in the current directory, deriving everything from local git — no GitHub token needed",
  ),
);

const yesOption = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDescription("Skip the confirmation prompt"),
);

/** Wraps DELETE /api/repos/[id] (soft-delete via isShadowed — same pattern
 * as every other removable resource in this app; frees the org's repo-count
 * seat immediately since countRepos already filters shadowed rows out). */
const remove = Command.make(
  "remove",
  { ownerRepo: ownerRepoArg, yes: yesOption },
  ({ ownerRepo, yes }) =>
    Effect.gen(function* () {
      const { owner, name } = yield* parseOwnerRepoArg(ownerRepo);
      const repo = yield* findRepo(owner, name);

      if (!yes) {
        const confirmed = yield* Prompt.run(
          Prompt.confirm({ message: `Remove ${repo.owner}/${repo.name} from your org?`, initial: false }),
        );
        if (!confirmed) {
          yield* Console.log("Cancelled.");
          return;
        }
      }

      yield* apiRequest("DELETE", `/api/repos/${repo.id}`);
      yield* Console.log(`Removed ${repo.owner}/${repo.name}.`);
    }).pipe(
      (effect) => onQuit(effect, "\nCancelled."),
      Effect.tapError((error: Error | ApiError) => Console.error(error.message)),
    ),
).pipe(Command.withDescription("Remove a repo from your org"));

export const reposCommand = Command.make("repos").pipe(
  Command.withDescription("Manage connected repos"),
  Command.withSubcommands([list, add, addLocal, remove]),
);
