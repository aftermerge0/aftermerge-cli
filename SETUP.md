# Setting up the `aftermerge` CLI

This is the practical install guide: how to get a global `aftermerge` command
on your machine. For what each command does once it's installed, see the
[command reference in the README](README.md#command-reference).

## Prerequisites

- [Bun](https://bun.sh) 1.x. Install with `curl -fsSL https://bun.sh/install | bash`,
  then confirm with `bun --version`.
- Git.

## Option A — global command via `bun link` (works today)

The package already declares a `bin` entry (`aftermerge` →
`src/index.ts`), so `bun link` registers it as a real global command without
waiting on any future packaging step.

```sh
git clone git@github.com:aftermerge0/aftermerge-cli.git
cd aftermerge-cli
bun install
bun link
```

Verify it's on your `PATH` (bun installs its global bin dir, usually
`~/.bun/bin`, into `PATH` as part of its own setup):

```sh
aftermerge --version
```

From here, every command in the README works as `aftermerge <command>
[args]` from any directory — no more `bun run src/index.ts` prefix, and no
`cd` into the repo required first.

To remove it later:

```sh
bun unlink aftermerge-cli   # from anywhere
# or, from inside the repo:
cd aftermerge-cli && bun unlink
```

## Option B — run from source, no global install

If you'd rather not touch your global bin dir (e.g. CI, a one-off check):

```sh
git clone git@github.com:aftermerge0/aftermerge-cli.git
cd aftermerge-cli
bun install
bun run src/index.ts <command> [args]
```

## Option C — standalone compiled binary (not yet available)

`bun build --compile` can produce a single self-contained executable with no
Bun runtime dependency, distributable via a GitHub release, Homebrew tap,
etc. This packaging step is deferred — not implemented yet — so it isn't a
supported install path today. Option A is the closest equivalent in the
meantime: a real global `aftermerge` command, just one that still requires
Bun to be installed.

## First run

Once `aftermerge` resolves on your `PATH`:

```sh
aftermerge auth login --server https://your-instance.example.com
```

See the README's [`auth login`](README.md#auth-login) section for what the
device-approval flow looks like and where the session token ends up.
