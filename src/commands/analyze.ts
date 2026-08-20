import { Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { runLocalScan } from "./scan.js";

const prOption = Flag.integer("pr").pipe(
  Flag.withDescription("Pull request number to analyze"),
);

/** Thin wrapper over `scan`'s credential-free pipeline (`runLocalScan`),
 * always PR-scoped. Previously hit the token-based `/api/analysis`, which
 * required a real GitHub VCS connection — most repos registered via
 * `repos add-local` never have one, so this always failed with "Bad
 * credentials" for them. Resolving the PR via the local `gh` CLI (same as
 * `scan --pr`) instead means `analyze --pr` now works on any repo, VCS
 * token or not. */
export const analyzeCommand = Command.make("analyze", { pr: prOption }, ({ pr }) =>
  runLocalScan({ base: Option.none(), pr: Option.some(pr), context: false }),
).pipe(
  Command.withDescription(
    "Trigger analysis for a pull request in the current repo, using only local git content — no GitHub token needed",
  ),
);
