import { Prompt } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Console, Effect } from "effect";

/** Wraps the user's own local `gh` CLI — resolving a PR number to its
 * branch names/metadata is a local read using the user's existing `gh`
 * auth, never proxied through or touching our servers. Kept separate from
 * git.ts (different subprocess/tool), same spawn/exit-code wrapping pattern. */

export interface PrRefs {
  readonly number: number;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly title: string | null;
  readonly state: string;
  readonly url: string;
}

const GH_NOT_FOUND_MESSAGE =
  "`gh` CLI not found — install it (https://cli.github.com) or use `analyze --pr` instead, which only needs a connected repo.";

interface GhInstallPlan {
  readonly label: string;
  readonly command: readonly [string, ...string[]];
}

/** Only package managers that install into the user's own prefix — never a
 * plan that needs `sudo`. Homebrew covers both macOS and Linux (linuxbrew);
 * plain Linux with no brew has no reliable no-sudo option, so it falls
 * through to the manual-install message rather than reaching for
 * apt/dnf/pacman. */
const detectGhInstallPlan = (): GhInstallPlan | null => {
  switch (process.platform) {
    case "darwin":
    case "linux":
      return Bun.which("brew") ? { label: "Homebrew", command: ["brew", "install", "gh"] } : null;
    case "win32":
      if (Bun.which("winget")) {
        return { label: "winget", command: ["winget", "install", "--id", "GitHub.cli", "-e", "--source", "winget"] };
      }
      if (Bun.which("choco")) return { label: "Chocolatey", command: ["choco", "install", "gh", "-y"] };
      return null;
    default:
      return null;
  }
};

/** Offers to install `gh` on the user's behalf when it's missing, via
 * whichever no-sudo package manager is available. Never fails the Effect —
 * declining, no detected manager, and a failed install all resolve to
 * `false` so the caller can fall back to GH_NOT_FOUND_MESSAGE uniformly. */
const offerGhInstall = (): Effect.Effect<boolean, never, Prompt.Prompt.Environment> =>
  Effect.gen(function* () {
    const plan = detectGhInstallPlan();
    if (!plan) {
      yield* Console.log(GH_NOT_FOUND_MESSAGE);
      return false;
    }

    const commandLine = plan.command.join(" ");
    // Ctrl+C here means "decline the install," not "crash" — same
    // treatment as the --context picker in scan.ts.
    const confirmed = yield* Prompt.run(
      Prompt.confirm({
        message: `\`gh\` CLI not found. Install it now via ${plan.label} (\`${commandLine}\`)?`,
        initial: false,
      }),
    ).pipe(Effect.catchAll((error) => (Terminal.isQuitException(error) ? Effect.succeed(false) : Effect.fail(error))));
    if (!confirmed) {
      yield* Console.log(GH_NOT_FOUND_MESSAGE);
      return false;
    }

    yield* Console.log(`Running \`${commandLine}\`...`);
    const installed = yield* Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn([...plan.command], { stdout: "inherit", stderr: "inherit" });
        return (await proc.exited) === 0;
      },
      catch: () => "install-failed" as const,
    }).pipe(Effect.catchAll(() => Effect.succeed(false)));

    if (!installed || !Bun.which("gh")) {
      yield* Console.error(
        `\`${commandLine}\` didn't leave \`gh\` on PATH — install it manually: https://cli.github.com`,
      );
      return false;
    }
    yield* Console.log("gh installed.");
    return true;
  });

interface GhPrView {
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly title?: string | null;
  readonly state: string;
  readonly url: string;
}

const isGhPrView = (value: unknown): value is GhPrView => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.headRefName === "string" &&
    typeof v.baseRefName === "string" &&
    typeof v.state === "string" &&
    typeof v.url === "string"
  );
};

class GhNotFoundError extends Error {}

const runGhPrView = (prNumber: number): Effect.Effect<PrRefs, Error> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["gh", "pr", "view", String(prNumber), "--json", "headRefName,baseRefName,title,state,url"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        const message = stderr.trim() || `gh pr view ${prNumber} failed`;
        const authHint = /auth/i.test(message) ? " Run `gh auth login` to authenticate." : "";
        throw new Error(message + authHint);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        throw new Error(`'gh pr view ${prNumber}' returned unexpected output.`);
      }
      if (!isGhPrView(parsed)) {
        throw new Error(`'gh pr view ${prNumber}' returned an unexpected shape.`);
      }
      return {
        number: prNumber,
        headBranch: parsed.headRefName,
        baseBranch: parsed.baseRefName,
        title: parsed.title ?? null,
        state: parsed.state,
        url: parsed.url,
      } satisfies PrRefs;
    },
    // Bun.spawn throws synchronously when `gh` isn't on PATH — as a plain
    // Error whose MESSAGE is "Executable not found in $PATH: ..." (no
    // "ENOENT" substring in the text at all) but whose `.code` property is
    // literally "ENOENT" (confirmed by inspecting the thrown object directly
    // — checking the message text, as an earlier version of this code did,
    // never matches).
    catch: (cause) => {
      const code = cause && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : undefined;
      if (code === "ENOENT") {
        return new GhNotFoundError(GH_NOT_FOUND_MESSAGE);
      }
      return cause instanceof Error ? cause : new Error(`Could not resolve PR #${prNumber} via gh.`);
    },
  });

/** Same as `runGhPrView`, but on `gh` missing (ENOENT), offers to install it
 * on the user's behalf and retries once — falls back to the plain
 * not-found error if the user declines, no install plan applies, or the
 * install fails. */
export const resolvePrRefs = (prNumber: number): Effect.Effect<PrRefs, Error, Prompt.Prompt.Environment> =>
  runGhPrView(prNumber).pipe(
    Effect.catchAll((error) =>
      error instanceof GhNotFoundError
        ? offerGhInstall().pipe(
            Effect.flatMap((installed) => (installed ? runGhPrView(prNumber) : Effect.fail(error))),
          )
        : Effect.fail(error),
    ),
  );
