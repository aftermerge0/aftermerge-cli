# Design: index any branch without running analysis

## Problem

There's no CLI command that just indexes a branch. Indexing only happens today as a
side effect of something bigger:

1. `aftermerge repos add --auto-index` — indexes the repo's *default* branch, but only
   once, at registration time, and only via the GitHub-token-based `add` (not
   `add-local`).
2. `aftermerge scan` / `aftermerge analyze` — uploads and indexes both the head and
   base ref, but always proceeds to start a full analysis run afterward. There's no
   flag to index-and-stop.
3. The web dashboard.

If you just want an arbitrary branch (or a PR's branches) available as
[cross-repo context](../src/commands/scan.ts) for other scans, or refreshed after a
push, today's only option is to run a full `scan`/`analyze` you don't actually want,
burning analysis/LLM budget along with it.

## Goal

A command that uploads and indexes one or more refs — local branch, arbitrary ref, or
a PR's branches — and stops. No analysis run, no diff, no LLM cost beyond ingestion
itself.

## Proposed command

```
aftermerge repos index [ref] [--pr <n>]
```

- Lives under the `repos` namespace (`src/commands/repos.ts`), next to `add-local` —
  this is a repo-lifecycle action (make content available), not a diff/analysis
  action like `scan`.
- `ref` (positional, optional): a local branch or commit-ish. Defaults to the current
  branch (`getCurrentBranch()`) if omitted.
- `--pr <n>`: resolves the PR's head branch via the existing `resolvePrRefs` in
  `src/gh.ts` (same local-`gh`-CLI resolution `scan --pr` already uses, including the
  install-on-demand flow) and indexes *that* branch instead of `ref`. Mutually
  exclusive with a positional `ref`, same as `scan`'s `--base`/`--pr` guard.
- No `--base` — indexing a single ref doesn't need a diff partner.

### Example usage

```
$ aftermerge repos index
Indexing feat/gh-pr-analysis (42 files) at a1b2c3d...
Indexed.

$ aftermerge repos index main
Indexing main (40 files) at 9f8e7d6...
Indexed.

$ aftermerge repos index --pr 128
Resolving PR #128 via gh...
Indexing fix/retry-backoff (12 files) at 55aa66b...
Indexed.
```

## Why this needs no new server endpoint

`POST /api/ingest/upload` (wrapped by `uploadRef` in `src/commands/scan.ts:82-92`) is
already exactly "index this one ref": it takes `{ repositoryId, branch, commitSha,
files }`, runs ingestion synchronously, and is idempotent — re-uploading an
already-current commit returns almost immediately (per the existing doc comment on
`uploadRef`). `scan` already calls it twice (once for base, once for head) before ever
touching `/api/analysis/local`. This command just calls it once and never makes that
second call.

That means this is a CLI-only change: no new route, no new billing hook, nothing to
coordinate with the web app repo — *assuming* ingestion itself carries no LLM/analysis
cost. That assumption needs confirming with whoever owns `app/api/ingest/upload/route.ts`
(see open questions).

## Implementation sketch

1. Extract `uploadRef` (and its `ApiError`-wrapping) out of `scan.ts` into a shared
   module — `src/ingest.ts` — since it'd now be called from both `scan.ts` and the new
   `repos index` subcommand. Keep the exact same idempotency/error-wrapping behavior;
   this is a pure move, not a rewrite.
2. Add an `index` command to `src/commands/repos.ts`:
   ```ts
   const refArg = Args.text({ name: "ref" }).pipe(Args.optional, ...);
   const prOption = Options.integer("pr").pipe(Options.optional, ...); // same shape as scan.ts's

   const index = Command.make("index", { ref: refArg, pr: prOption }, ({ ref, pr }) =>
     Effect.gen(function* () {
       if (Option.isSome(ref) && Option.isSome(pr)) {
         return yield* Effect.fail(new Error("a ref and --pr are mutually exclusive."));
       }
       const repo = yield* resolveConnectedRepo(/* same not-connected message as scan */);
       const prRefs = Option.isSome(pr) ? yield* resolvePrRefs(pr.value) : undefined;
       const branch = prRefs ? prRefs.headBranch : Option.isSome(ref) ? ref.value : yield* getCurrentBranch();
       const commitSha = prRefs
         ? yield* resolveCommitShaOrRemote(prRefs.headBranch)
         : yield* resolveCommitShaOrRemote(branch);
       const files = yield* readTrackedFilesAtRef(commitSha);
       yield* Console.log(`Indexing ${branch} (${files.length} files) at ${commitSha}...`);
       yield* uploadRef("index", repo.id, branch, commitSha, files);
       yield* Console.log("Indexed.");
     }).pipe(Effect.tapError((error: Error | ApiError) => Console.error(error.message))),
   ).pipe(Command.withDescription("Index a branch (or --pr's head branch) without running analysis"));
   ```
   `uploadRef`'s `step` parameter is currently typed `"base" | "head"` — widen it to
   include `"index"` (or generalize it to a free-text label) since the base/head
   framing doesn't apply here.
3. Register `index` in `reposCommand`'s subcommand list (`src/commands/repos.ts`,
   bottom of the file, alongside `list`, `add`, `addLocal`, `remove`).

No changes needed to `src/upload.ts`, `src/gh.ts`, `src/api-types.ts`, or
`src/connected-repo.ts` — this reuses all of it as-is.

## Open questions

- **Does `/api/ingest/upload` cost anything on its own?** `repos add --auto-index`'s
  description says indexing "uses analysis/LLM budget," which suggests *some* indexing
  path does cost budget — need to confirm that's specific to the clone-based indexing
  `add --auto-index` triggers server-side, and not the upload-based ingest `scan`
  (and this new command) uses, before shipping this as "free."
- **Multiple refs in one call?** E.g. `aftermerge repos index main develop` to warm
  several branches at once. Punting on this for v1 — one ref per invocation keeps the
  surface small; can add a variadic `Args.text({...}).pipe(Args.repeated)` later
  without a breaking change.
- **Does this belong under `repos` or as a top-level command?** `repos index` mirrors
  `repos add-local`'s "this is about the repo, not a diff" framing, but `scan`/`analyze`
  are already top-level despite also being repo-scoped. Leaning `repos index` for
  discoverability (`aftermerge repos --help` lists it next to `add-local`), open to
  the alternative.
