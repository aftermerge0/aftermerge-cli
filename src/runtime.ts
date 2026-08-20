import { layer as bunCryptoLayer } from "@effect/platform-bun/BunCrypto";
import { layer as bunFileSystemLayer } from "@effect/platform-bun/BunFileSystem";
import { layer as bunPathLayer } from "@effect/platform-bun/BunPath";
import { layer as bunChildProcessLayer } from "@effect/platform-bun/BunChildProcessSpawner";
import { Console, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

/** TUI path: OpenTUI owns the tty. Do not install BunTerminal / BunStdio —
 * those grab stdin. Line-oriented `--no-tui` still uses `BunServices.layer`. */
const bunCore = Layer.mergeAll(bunFileSystemLayer, bunPathLayer, bunCryptoLayer);

export const tuiLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  bunCore,
  bunChildProcessLayer.pipe(Layer.provide(bunCore)),
);

export const AppRuntime = ManagedRuntime.make(tuiLayer);

/** Capture Effect `Console.log` into React state so scan/auth work does not
 * fight the renderer with `process.stdout.write`. */
export const sinkConsole = (onLog: (line: string) => void): Console.Console =>
  Object.assign(Object.create(globalThis.console), {
    log: (...args: ReadonlyArray<unknown>) => {
      onLog(args.map(String).join(" "));
    },
    error: (...args: ReadonlyArray<unknown>) => {
      onLog(args.map(String).join(" "));
    },
    info: (...args: ReadonlyArray<unknown>) => {
      onLog(args.map(String).join(" "));
    },
    warn: (...args: ReadonlyArray<unknown>) => {
      onLog(args.map(String).join(" "));
    },
  }) as Console.Console;
