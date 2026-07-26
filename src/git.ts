import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Effect } from "effect";

const MAX_FILE_BYTES = 500_000; // matches the server's per-file cap (app/api/ingest/upload/route.ts)

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

/** Normalizes a git remote / stored clone URL (SSH or HTTPS, with or without
 * `.git`) to one comparable form — `cloneUrl` is always stored as GitHub's
 * `https://…/owner/repo.git` (Octokit's `clone_url`, see
 * app/api/repos/discover/route.ts), while `git remote get-url origin` can be
 * either form depending on how the user cloned. */
export const normalizeCloneUrl = (url: string): string =>
  url
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();

export const getOriginRemote = (): Effect.Effect<string, Error> =>
  runGit(["remote", "get-url", "origin"]).pipe(
    Effect.mapError(() => new Error("Not a git repository, or no 'origin' remote is configured here.")),
  );

/** owner/name parsed from a GitHub clone URL, e.g.
 * "https://github.com/acme/widgets" → { owner: "acme", name: "widgets" }. */
export const parseOwnerName = (cloneUrl: string): { owner: string; name: string } | null => {
  const match = normalizeCloneUrl(cloneUrl).match(/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1], name: match[2] };
};

export const getCurrentBranch = (): Effect.Effect<string, Error> =>
  runGit(["rev-parse", "--abbrev-ref", "HEAD"]);

export const resolveCommitSha = (ref: string): Effect.Effect<string, Error> =>
  runGit(["rev-parse", ref]).pipe(
    Effect.mapError(() => new Error(`'${ref}' is not a valid local ref (branch/commit).`)),
  );

/** The remote's default branch, from the local clone's own record of it
 * (`refs/remotes/origin/HEAD`, set by a normal `git clone` — no network
 * call). Falls back to the current branch if that ref is unset (a shallow
 * or unusual clone), which is what `--base` is for overriding anyway. */
export const getDefaultBranch = (): Effect.Effect<string, Error> =>
  runGit(["symbolic-ref", "refs/remotes/origin/HEAD"]).pipe(
    Effect.map((ref) => ref.replace(/^refs\/remotes\/origin\//, "")),
    Effect.orElse(() => getCurrentBranch()),
  );

export interface ArchivedFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Every tracked file's content AT a given commit (not the working tree —
 * `git archive` reads from git's committed history, so uncommitted local
 * edits are never included, matching "analyze commit <sha>" semantics
 * exactly, for both the head and base ref). No file-selection/filtering
 * logic here by design (plan 149 §1.D) — the server applies the real rules
 * after upload; this only excludes what any generic uploader would (binary
 * content that isn't valid UTF-8 text, and anything over the server's own
 * per-file size cap, so an oversized file fails fast locally instead of
 * after a slow upload).
 */
export const archiveFilesAtRef = (ref: string): Effect.Effect<ArchivedFile[], Error> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "aftermerge-archive-")),
      catch: (cause) => (cause instanceof Error ? cause : new Error("Could not create a temp directory.")),
    }),
    (dir) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: async () => {
            await Bun.$`git archive ${ref} | tar -x -C ${dir}`.quiet();
          },
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(`Could not read '${ref}' from git history.`),
        });

        const listed = yield* runGit(["ls-tree", "-r", "--name-only", ref]);
        const paths = listed.split("\n").filter(Boolean);

        const files: ArchivedFile[] = [];
        for (const path of paths) {
          const bytes = yield* Effect.tryPromise({
            try: () => readFile(join(dir, path)),
            catch: (cause) =>
              cause instanceof Error ? cause : new Error(`Could not read extracted file '${path}'.`),
          });
          if (bytes.byteLength > MAX_FILE_BYTES) continue;
          const content = bytes.toString("utf8");
          // Round-trip check: a file that isn't valid UTF-8 text re-encodes
          // to something of a different byte length (replacement characters
          // aren't 1:1) — skip it rather than upload corrupted content.
          if (Buffer.byteLength(content, "utf8") !== bytes.byteLength) continue;
          files.push({ path: relative(dir, join(dir, path)), content });
        }
        return files;
      }),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
