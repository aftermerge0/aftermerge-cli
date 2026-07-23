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

const rootCommand = Command.make("aftermerge").pipe(
  Command.withDescription("AfterMerge CLI — sign in and run checks from your terminal"),
  Command.withSubcommands([authCommand, analyzeCommand, reposCommand, findingsCommand, chatCommand]),
);

const cli = Command.run(rootCommand, {
  name: "AfterMerge CLI",
  version: "0.1.0",
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
