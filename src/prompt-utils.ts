/** Shared handling for `@effect/cli`'s `Prompt.run` — used by both `chat`
 * (the REPL loop) and `repos remove` (the y/n confirmation). Ctrl+C during a
 * prompt fails with a `Terminal.QuitException`, which is constructed with an
 * empty payload and so has no `.message` — piping it through a generic
 * `Console.error(error.message)` handler (as `repos remove` did before this
 * extraction) prints a blank line and exits non-zero for what the user
 * experiences as a normal, deliberate cancel. */
import { Terminal } from "@effect/platform";
import { Console, Effect } from "effect";

/** Treats Ctrl+C as a graceful exit: prints `quitMessage` and succeeds.
 * Any other failure is left untouched, for the caller's own error handling.
 * Written with `catchAll` + a manual guard (rather than `catchIf`) so
 * TypeScript's ordinary control-flow narrowing — not a generic overload's
 * inference, which doesn't reliably narrow a fully generic `E` against a
 * `(u: unknown) => u is X` guard — is what removes `QuitException` from the
 * resulting error type. */
export const onQuit = <A, E, R>(effect: Effect.Effect<A, E, R>, quitMessage: string) =>
  effect.pipe(
    Effect.catchAll((error) =>
      Terminal.isQuitException(error) ? Console.log(quitMessage) : Effect.fail(error),
    ),
  );
