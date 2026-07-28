#!/usr/bin/env bun
import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { FetchHttpClient } from "@effect/platform";
import { Effect } from "effect";
import { authCommand } from "./commands/auth.js";
import { analyzeCommand } from "./commands/analyze.js";
import { reposCommand } from "./commands/repos.js";
import { findingsCommand } from "./commands/findings.js";
import { chatCommand } from "./commands/chat.js";
import { scanCommand } from "./commands/scan.js";
import pkg from "../package.json" with { type: "json" };

const rootCommand = Command.make("aftermerge").pipe(
  Command.withDescription("AfterMerge CLI — sign in and run checks from your terminal"),
  Command.withSubcommands([authCommand, analyzeCommand, reposCommand, findingsCommand, chatCommand, scanCommand]),
);

// Read from package.json (same source `http.ts`'s CLI_USER_AGENT already
// uses) rather than a second hardcoded literal — the two previously
// disagreed the moment either was bumped without the other, so `--version`
// and the User-Agent the server logs could report different versions of
// the same binary.
const cli = Command.run(rootCommand, {
  name: "AfterMerge CLI",
  version: pkg.version,
});

cli(process.argv).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(BunContext.layer),
  (effect) =>
    BunRuntime.runMain(effect, {
      // Every command already prints its own clean message via
      // Effect.tapError before its failure propagates (for a correct
      // non-zero exit code) — without this, Effect's own default error
      // reporting would ALSO dump the raw Cause on top of that message.
      disableErrorReporting: true,
    }),
);
