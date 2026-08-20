#!/usr/bin/env bun
import { runMain } from "@effect/platform-bun/BunRuntime";
import { layer as bunServicesLayer } from "@effect/platform-bun/BunServices";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { authCommand } from "./commands/auth.js";
import { analyzeCommand } from "./commands/analyze.js";
import { reposCommand } from "./commands/repos.js";
import { findingsCommand } from "./commands/findings.js";
import { chatCommand } from "./commands/chat.js";
import { scanCommand } from "./commands/scan.js";
import { wantsTui } from "./wants-tui.js";
import pkg from "../package.json" with { type: "json" };

export const rootCommand = Command.make("aftermerge").pipe(
  Command.withDescription("AfterMerge — terminal app. Type `aftermerge` or `am`."),
  Command.withSubcommands([authCommand, analyzeCommand, reposCommand, findingsCommand, chatCommand, scanCommand]),
);

export const runCli = (argv: readonly string[]) => {
  const args = argv.slice(2).filter((arg) => arg !== "--no-tui");
  const effect = Command.runWith(rootCommand, {
    version: pkg.version,
    renderErrors: false,
  })(args).pipe(Effect.provide(Layer.mergeAll(FetchHttpClient.layer, bunServicesLayer)));
  runMain(effect, {
    // Every command already prints its own clean message via
    // Effect.tapError before its failure propagates (for a correct
    // non-zero exit code) — without this, Effect's own default error
    // reporting would ALSO dump the raw Cause on top of that message.
    disableErrorReporting: true,
  });
};

if (import.meta.main) {
  if (wantsTui(process.argv)) {
    const { bootTui } = await import("./ui/boot.js");
    await bootTui(process.argv);
  } else {
    runCli(process.argv);
  }
}
