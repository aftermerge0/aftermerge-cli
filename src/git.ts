import { Effect } from "effect";

/** Generic, product-agnostic git plumbing — reading the local checkout's
 * remote/branch/commit state. Scan-specific content archival lives in
 * `upload.ts`, kept separate so this file stays reusable git wrapping with
 * no opinion about what any particular command does with it. */

const runGit = (args: string[]): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
      }
      return stdout.trim();
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(`Could not run git ${args.join(" ")}.`)),
  });

/** Runs a git subcommand and returns its raw (untrimmed) stdout as a
 * `Buffer` — for callers reading structured/`-z`-terminated or binary output
 * where trimming or UTF-8 text decoding would be wrong. */
const runGitRawBytes = (args: string[]): Effect.Effect<Buffer, Error> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
      }
      return Buffer.from(stdout);
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(`Could not run git ${args.join(" ")}.`)),
  });

/** A ref string starting with `-` would otherwise be handed straight to git
 * as a positional argument and can be misread as a flag (e.g. a `--base`
 * value of `--upload-pack=...`) — not a privilege boundary (this only ever
 * runs against the user's own local checkout), but it silently produces
 * confusing/wrong results instead of the clear error a mistyped ref should
 * get. Every function below that takes a caller-supplied ref checks this
 * before it reaches a git invocation. */
function assertNotOptionLike(ref: string): Effect.Effect<void, Error> {
  if (ref.startsWith("-")) {
    return Effect.fail(new Error(`'${ref}' is not a valid ref (it looks like a flag, not a branch/commit).`));
  }
  return Effect.void;
}

/** Normalizes a git remote / stored clone URL (SSH scp-style, `ssh://`, or
 * HTTPS, with or without `.git`) to one comparable, case-insensitive form —
 * `cloneUrl` is always stored as GitHub's `https://…/owner/repo.git`
 * (Octokit's `clone_url`, see app/api/repos/discover/route.ts), while `git
 * remote get-url origin` can be any of the forms above depending on how the
 * user cloned. Order matters: the trailing-slash strip must run BEFORE the
 * `.git` strip, or `.../Widgets.git/` and `.../Widgets.git` normalize to
 * different strings (the former only had its slash stripped, never its
 * `.git`, since `/\.git$/` no longer matches once a trailing `/` is in the
 * way — this was a real bug: those two forms of the same URL failed to
 * match each other). */
const normalizeCloneUrlPreservingCase = (url: string): string =>
  url
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/(?:[^@/]+@)?/, "https://")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");

export const normalizeCloneUrl = (url: string): string => normalizeCloneUrlPreservingCase(url).toLowerCase();

export const getOriginRemote = (): Effect.Effect<string, Error> =>
  runGit(["remote", "get-url", "origin"]).pipe(
    Effect.mapError(() => new Error("Not a git repository, or no 'origin' remote is configured here.")),
  );

/** owner/name parsed from a GitHub clone URL, e.g.
 * "https://github.com/acme/widgets" → { owner: "acme", name: "widgets" }.
 * Matches against the case-PRESERVING normalization, not `normalizeCloneUrl`
 * — the latter lowercases for case-insensitive comparison elsewhere, and
 * matching against it here silently registered every repo under a
 * lowercased owner/name (e.g. "Acme/Widgets" stored as "acme/widgets"),
 * corrupting the org's actual repo listing. */
export const parseOwnerName = (cloneUrl: string): { owner: string; name: string } | null => {
  const match = normalizeCloneUrlPreservingCase(cloneUrl).match(/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  return { owner: match[1], name: match[2] };
};

export const getCurrentBranch = (): Effect.Effect<string, Error> =>
  runGit(["rev-parse", "--abbrev-ref", "HEAD"]);

export const resolveCommitSha = (ref: string): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    yield* assertNotOptionLike(ref);
    return yield* runGit(["rev-parse", ref]).pipe(
      Effect.mapError(() => new Error(`'${ref}' is not a valid local ref (branch/commit).`)),
    );
  });

/** The remote's default branch, from the local clone's own record of it
 * (`refs/remotes/origin/HEAD`, set by a normal `git clone` — no network
 * call). Falls back to the current branch if that ref is unset (a shallow
 * or unusual clone), which is what `--base` is for overriding anyway. */
export const getDefaultBranch = (): Effect.Effect<string, Error> =>
  runGit(["symbolic-ref", "refs/remotes/origin/HEAD"]).pipe(
    Effect.map((ref) => ref.replace(/^refs\/remotes\/origin\//, "")),
    Effect.catch(() => getCurrentBranch()),
  );

/** Internal export for `upload.ts`, which needs to list/read blobs at a ref
 * — kept here rather than duplicated since it's still generic git plumbing,
 * just lower-level than the rest of this file's public surface. */
export const gitInternals = { runGit, runGitRawBytes, assertNotOptionLike };

/** Resolves a ref's commit sha, falling back to `origin/<ref>` if the bare
 * ref name isn't a valid local ref — e.g. a PR's head branch is often only
 * fetched as a remote-tracking ref, never checked out as a local branch. */
export const resolveCommitShaOrRemote = (ref: string): Effect.Effect<string, Error> =>
  resolveCommitSha(ref).pipe(
    Effect.catch(() => resolveCommitSha(`origin/${ref}`)),
    Effect.mapError(
      () => new Error(`'${ref}' isn't available locally — run \`git fetch origin ${ref}\` or \`gh pr checkout <n>\` first.`),
    ),
  );
