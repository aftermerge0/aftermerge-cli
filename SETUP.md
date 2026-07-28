# Setting up the `aftermerge` CLI

This is the practical install guide: how to get a global `aftermerge` command
on your machine. For what each command does once it's installed, see the
[command reference in the README](README.md#command-reference).

## Option A — standalone binary via curl (no Bun required)

`.github/workflows/release.yml` builds a standalone executable per
OS/arch with `bun build --compile` on every pushed `v*` tag, and attaches
each one to the GitHub Release. `install.sh` (in the repo root) detects your
OS/arch, downloads the matching binary from the latest release, and drops it
in `~/.aftermerge/bin` (override with `AFTERMERGE_INSTALL_DIR`).

```sh
curl -fsSL https://raw.githubusercontent.com/aftermerge0/aftermerge-cli/main/install.sh | sh
```

If `~/.aftermerge/bin` isn't already on your `PATH`, the script prints the
`export PATH=...` line to add to your shell profile — it never edits your
shell config for you.

Supported today: macOS (arm64/x64) and Linux (x64/arm64). No Windows binary
yet — use Option B or C below on Windows.

To remove it later, just delete the binary: `rm ~/.aftermerge/bin/aftermerge`
(or wherever `AFTERMERGE_INSTALL_DIR` pointed).

## Option B — global command via `bun link`

Requires [Bun](https://bun.sh) 1.x (`curl -fsSL https://bun.sh/install | bash`)
and Git. The package already declares a `bin` entry (`aftermerge` →
`src/index.ts`), so `bun link` registers it as a real global command.

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

## Option C — run from source, no global install

If you'd rather not touch your global bin dir (e.g. CI, a one-off check),
requires Bun as in Option B:

```sh
git clone git@github.com:aftermerge0/aftermerge-cli.git
cd aftermerge-cli
bun install
bun run src/index.ts <command> [args]
```

## First run

Once `aftermerge` resolves on your `PATH`:

```sh
aftermerge auth login --server https://your-instance.example.com
```

See the README's [`auth login`](README.md#auth-login) section for what the
device-approval flow looks like and where the session token ends up.
