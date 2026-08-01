import { Effect } from "effect";

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

export const resolvePrRefs = (prNumber: number): Effect.Effect<PrRefs, Error> =>
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
        return new Error(GH_NOT_FOUND_MESSAGE);
      }
      return cause instanceof Error ? cause : new Error(`Could not resolve PR #${prNumber} via gh.`);
    },
  });
