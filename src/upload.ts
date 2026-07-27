import { Console, Effect } from "effect";
import { gitInternals } from "./git.js";

/** Reads every tracked, plain-file blob at a git ref, for `scan`'s
 * credential-free upload (plan 149). Deliberately does zero file-selection
 * (extension allowlists, directory exclusions, "what's worth analyzing") —
 * that's the server's real IP (`select.ts`), never duplicated into the CLI
 * (plan 149 §1.D). This file only decides what a GENERIC uploader must
 * exclude: things that aren't file content at all (submodules, symlinks),
 * and content that can't be safely represented as one JSON string (invalid
 * UTF-8, oversized files).
 *
 * This intentionally reads blob content via `git cat-file` rather than
 * `git archive | tar -x` into a temp directory (the previous approach):
 * - `git archive <ref> | tar -x` swallows `git archive`'s own exit code —
 *   Bun's shell pipeline (no `pipefail`) takes the LAST command's exit
 *   status, and `tar` exits 0 on an empty/short input. A failing `git
 *   archive` (bad ref, a broken clean/smudge filter, `export-subst` error)
 *   previously went undetected and surfaced as a confusing "could not read
 *   extracted file" error instead of git's real message.
 * - `tar -x` extracts a submodule as an empty directory and a symlink as
 *   either a dangling link or a copy of its target's content under the
 *   wrong path — both silently wrong, and a submodule/broken-symlink
 *   previously aborted the ENTIRE scan (EISDIR/ENOENT reading the
 *   extracted path).
 * Reading blobs directly via `ls-tree`'s reported mode sidesteps all of the
 * above: submodules (`160000`) and symlinks (`120000`) are filtered out
 * before any content read is attempted, and there's no filesystem
 * extraction step (no temp directory, no `tar` dependency, no Windows-
 * specific extraction quirks) at all. */

const MAX_FILE_BYTES = 500_000; // matches the server's per-file cap (app/api/ingest/upload/route.ts)
const READ_CONCURRENCY = 8;

// Regular file blob modes only — excludes symlinks (120000) and gitlinks /
// submodules (160000), neither of which is "file content" a generic
// uploader should try to read.
const BLOB_MODES = new Set(["100644", "100755"]);

interface TreeEntry {
  readonly mode: string;
  readonly sha: string;
  readonly path: string;
}

export interface ArchivedFile {
  readonly path: string;
  readonly content: string;
}

/** Parses `git ls-tree -r -z`'s NUL-terminated output:
 * `"<mode> <type> <sha>\t<path>\0..."`. Run with `core.quotePath=false` so
 * non-ASCII paths come through as raw UTF-8 instead of git's default
 * C-style octal-escaped quoting (`"caf\303\251.txt"` literally) — reading
 * `--name-only` output without `-z`/`quotePath=false` made any repo with a
 * single non-ASCII filename fail outright (`readFile` on the literal quoted
 * string never resolves to a real path). `-z` also makes filenames
 * containing newlines (legal in git) unambiguous to split on. */
function parseLsTreeEntries(raw: Buffer): TreeEntry[] {
  const text = raw.toString("utf8");
  const entries: TreeEntry[] = [];
  for (const entry of text.split("\0")) {
    if (entry.length === 0) continue;
    const tabIndex = entry.indexOf("\t");
    if (tabIndex === -1) continue;
    const info = entry.slice(0, tabIndex).split(" ");
    const [mode, , sha] = info;
    if (!mode || !sha) continue;
    entries.push({ mode, sha, path: entry.slice(tabIndex + 1) });
  }
  return entries;
}

const listBlobsAtRef = (ref: string): Effect.Effect<TreeEntry[], Error> =>
  Effect.gen(function* () {
    yield* gitInternals.assertNotOptionLike(ref);
    const raw = yield* gitInternals.runGitRawBytes(["-c", "core.quotePath=false", "ls-tree", "-r", "-z", ref]);
    return parseLsTreeEntries(raw).filter((entry) => BLOB_MODES.has(entry.mode));
  });

const readBlob = (sha: string): Effect.Effect<Buffer, Error> => gitInternals.runGitRawBytes(["cat-file", "-p", sha]);

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** Rejects anything that isn't losslessly representable as a JSON string.
 * The previous check compared re-encoded byte length ("a file that isn't
 * valid UTF-8 re-encodes to a different length"), which has real false
 * negatives: a truncated multi-byte sequence collapses to exactly one
 * U+FFFD replacement character, which can round-trip at the SAME byte
 * length as the truncated original (e.g. a 3-byte truncated 4-byte emoji →
 * one 3-byte U+FFFD). `{ fatal: true }` rejects any invalid sequence
 * outright instead of guessing from length. NUL bytes are separately
 * rejected because they're valid UTF-8 but not storable in a Postgres
 * `text` column. */
function decodeUtf8OrNull(bytes: Buffer): string | null {
  try {
    const text = strictUtf8Decoder.decode(bytes);
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

/** Every tracked, plain-file blob's content AT a given commit — not the
 * working tree, so uncommitted local edits are never included, matching
 * "analyze commit <sha>" semantics for both the head and base ref. No
 * file-selection/filtering logic here by design (see module doc above); the
 * server applies the real rules after upload. A single unreadable/oversized/
 * non-UTF-8 file is skipped (with a warning), not fatal to the whole scan —
 * previously, an aborted read anywhere aborted the entire command. */
export const readTrackedFilesAtRef = (ref: string): Effect.Effect<ArchivedFile[], Error> =>
  Effect.gen(function* () {
    const entries = yield* listBlobsAtRef(ref);

    const results = yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(readBlob(entry.sha));
          if (exit._tag === "Failure") {
            yield* Console.error(`  (skipping '${entry.path}': could not read its content)`);
            return null;
          }
          const bytes = exit.value;
          if (bytes.byteLength > MAX_FILE_BYTES) return null;
          const content = decodeUtf8OrNull(bytes);
          if (content === null) return null;
          return { path: entry.path, content };
        }),
      { concurrency: READ_CONCURRENCY },
    );

    return results.filter((file): file is ArchivedFile => file !== null);
  });
