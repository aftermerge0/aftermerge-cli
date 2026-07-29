# AfterMerge CLI

A terminal client for AfterMerge — sign in once, then run the same PR
analysis checks the web dashboard runs, without leaving your shell.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Command reference](#command-reference)
- [Global behavior](#global-behavior-every-command-gets-these-for-free)
- [Exit codes](#exit-codes)
- [Where your credentials live](#where-your-credentials-live)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Installation

**macOS (Apple Silicon) / Linux** — no Bun runtime required, installs a standalone binary:

```sh
curl -fsSL https://raw.githubusercontent.com/aftermerge0/aftermerge-cli/main/install.sh | sh
```

**From source** (any platform Bun supports) — requires [Bun](https://bun.sh) 1.x and Git:

```sh
git clone git@github.com:aftermerge0/aftermerge-cli.git
cd aftermerge-cli
bun install
bun link
```

Either way, verify it's on your `PATH`:

```sh
aftermerge --version
```

See [SETUP.md](SETUP.md) for the full walkthrough of both install paths,
running from source without installing globally, and uninstalling.

## Quick start

```sh
aftermerge auth login          # defaults to https://www.aftermerge.dev; pass --server for a self-hosted instance
aftermerge repos add-local     # or: repos add <owner/name>, from the web dashboard
aftermerge scan                # or: analyze --pr <number>
```

Every command below assumes `aftermerge` is on your `PATH` per
[Installation](#installation) above.

---

## Command reference

### `auth login`

Signs you in via your browser. Required before any other command works.

```sh
aftermerge auth login [--server <url>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--server` | `https://www.aftermerge.dev` | Base URL of your AfterMerge deployment. Point this at a self-hosted instance with `--server https://your-instance.example.com`, or at a local dev server with `--server http://localhost:3000`. Must be `https://`, or `localhost`/`127.0.0.1`/`[::1]` for local dev — a plain-`http://` non-local server is rejected outright, since your session token would otherwise be sent in cleartext. |

What happens:

1. The CLI asks the server for a device code and a short human-readable code.
2. It prints both and opens your default browser to an approval page.
3. It polls in the background until you approve (or deny, or the code
   expires — default 30 minutes).
4. On approval, it stores a session token locally — in your OS's keychain
   (macOS Keychain / Windows Credential Manager / Linux Secret Service) where
   one is available, or a permission-locked file (`600`/`700`) as a fallback
   when it isn't. See **Where your credentials live** below for the details.

Example:

```
$ aftermerge auth login

  Code: WDJB-MKRS
  Visit: https://www.aftermerge.dev/device?user_code=WDJB-MKRS

Opening your browser — waiting for you to approve...
Signed in.
```

If you don't approve within the expiry window, or you click Deny, the CLI
prints the reason and exits non-zero.

### `auth whoami`

Shows who you're currently signed in as.

```sh
aftermerge auth whoami
```

```
$ aftermerge auth whoami
Signed in as Jane Doe (jane@example.com)
Organization: org_a1b2c3
Server: https://app.aftermerge.dev
```

If you're not signed in (or your session has expired), it says so and exits
non-zero — safe to use in a script as a preflight check:

```sh
aftermerge auth whoami > /dev/null 2>&1 || aftermerge auth login
```

### `auth logout`

Deletes your locally stored credentials. Does not need network access; this
only removes the local file, it doesn't revoke the session server-side.

```sh
aftermerge auth logout
```

---

### `analyze`

Triggers the same PR analysis pipeline the web dashboard runs, for the repo
in your current directory.

```sh
aftermerge analyze --pr <number>
```

| Flag | Required | Meaning |
|---|---|---|
| `--pr` | yes | Pull request number to analyze. |

**How it figures out which repo you mean:** it runs `git remote get-url
origin` in your current directory, normalizes that URL (handles both
`git@github.com:owner/repo.git` and `https://github.com/owner/repo.git`
forms), and matches it against the repos connected to your organization. You
must run this from inside a checkout of a repo that's already connected via
the web dashboard — the CLI doesn't register new repos (that requires a
GitHub App install, which is a browser-only flow).

What happens after the repo is matched:

1. Starts a new analysis run for that PR (subject to the same tier/billing
   limits the web app enforces — e.g. daily/monthly run quotas).
2. Polls the run's status every 2 seconds and prints each state transition.
3. Once the run completes, fetches and prints every finding.

Example — a full successful run:

```
$ aftermerge analyze --pr 128
Starting analysis for acme/billing-service PR #128...
  running...
  running...
  running...
  completed...
3 finding(s):
  [high/high-confidence] Missing null check on payment webhook
  [medium/medium-confidence] Race condition in cache invalidation
  [low/medium-confidence] Unused import in retry handler
```

Example — repo not connected yet:

```
$ aftermerge analyze --pr 1
This repo isn't connected yet. Connect it from the web dashboard first, then try again.
```
(exits non-zero)

Example — hitting a plan limit:

```
$ aftermerge analyze --pr 200
Starting analysis for acme/billing-service PR #200...
Monthly analysis run limit: plan limit of 25 would be exceeded (currently 25, adding 1). Upgrade your plan to continue.
```
(exits non-zero — this is the exact same message the web dashboard would show for the same limit, not a CLI-specific rewording)

A run that fails or gets cancelled (e.g. a newer run started for the same
branch superseded it) is reported the same way, and also exits non-zero.

---

### `scan`

The credential-free equivalent of `analyze` — analyzes your current branch
against a base ref using only the content already in your local git
checkout. No GitHub token is ever required or sent, for either registering
the repo (see `repos add-local` below) or running the analysis.

```sh
aftermerge scan [--base <ref>]
```

| Flag | Required | Meaning |
|---|---|---|
| `--base` | no | Base ref to diff against. Defaults to the repo's configured default branch. |

**How it figures out which repo you mean:** the same `git remote get-url
origin` + match-against-connected-repos logic `analyze` uses — but here the
repo must have been registered via `repos add-local` (credential-free), not
necessarily through the web dashboard.

What happens:

1. Resolves your current branch (the "head") and the base ref, and their
   commit shas — entirely locally, no server/token involved. Fails clearly
   if you're in a detached-HEAD state (no branch checked out) or if head and
   base are the same commit.
2. Reads every tracked file at both refs via `git` directly (no filesystem
   extraction step) and uploads each ref's content for the server to index.
   Uploading an already-indexed commit (e.g. a base branch a prior `scan`
   already covered) is cheap — the server's freshness check skips
   re-ingesting it.
3. Starts an analysis run comparing the two refs, then polls and prints
   findings exactly like `analyze`.

Example:

```
$ aftermerge scan --base main
Reading main (base)...
Uploading and indexing main (482 files)...
Reading my-feature-branch (head)...
Uploading and indexing my-feature-branch (486 files)...
Starting analysis for acme/billing-service (main...my-feature-branch)...
Run id: a1b2c3d4-...
  running...
  running...
  completed...
2 finding(s):
  [high/high-confidence] Missing null check on payment webhook
  [low/medium-confidence] Unused import in retry handler
```

Notes:

- There's no "pull request" concept here — no GitHub token means no PR
  metadata to fetch. Findings and status work identically; the run just
  isn't tied to a PR number.
- Large repos take longer on the first `scan` against a brand-new base
  branch (nothing to reuse yet); subsequent scans against an
  already-indexed base are faster.

---

### `repos list`

Lists every repo connected to your organization.

```sh
aftermerge repos list
```

```
$ aftermerge repos list
acme/billing-service  (7f3e1c9a-...)
acme/frontend         (9b2d4e11-...)
```

The id in parentheses is what other commands (like a future `analyze --repo`
override, not yet built) would take. Right now it's mainly useful for
cross-referencing with the web dashboard.

---

### `repos add <owner/name>`

Registers a repo with your org — the same seat/plan check and GitHub lookup
the web dashboard's "connect repo" dialog performs, from your terminal.
Requires a GitHub connection already configured for your org (this command
still talks to GitHub to fetch the repo's real metadata; for a token-free
alternative see `repos add-local` below).

```sh
aftermerge repos add <owner/name> [--branch <name>] [--auto-index]
```

| Flag | Required | Meaning |
|---|---|---|
| `--branch` | no | Also track this branch, if it differs from GitHub's configured default branch. |
| `--auto-index` | no | Index the default branch immediately after registering (uses analysis/LLM budget — off by default, same as the web dashboard). |

```
$ aftermerge repos add acme/billing-service
Registered acme/billing-service  (7f3e1c9a-...)
Default branch: main
```

### `repos add-local`

Registers the repo in your **current directory** without ever sending us a
GitHub token — every field (owner, name, clone URL, default branch) is
derived from your local git checkout. This is what `scan` requires before it
can run against a repo. Subject to the same seat/plan limit as `repos add`
(it's provider-agnostic — it just counts registered repos, regardless of how
each one's metadata was sourced).

```sh
aftermerge repos add-local
```

```
$ aftermerge repos add-local
Registered acme/billing-service  (7f3e1c9a-...)
Default branch: main
```

### `repos remove <owner/name>`

Removes a repo from your org (soft-deleted; frees the org's repo-count seat
immediately). Prompts for confirmation unless `--yes`/`-y` is passed.

```sh
aftermerge repos remove <owner/name> [--yes]
```

```
$ aftermerge repos remove acme/billing-service
Remove acme/billing-service from your org? (y/N) y
Removed acme/billing-service.
```

Pressing **Ctrl+C** at the confirmation prompt cancels cleanly (prints
"Cancelled.", exits `0`) rather than removing anything.

---

### `findings list <run-id>`

Lists every finding for a specific analysis run, by run id.

```sh
aftermerge findings list <run-id>
```

`<run-id>` is a positional argument — the id printed by `analyze`, or found
in the web dashboard's run URL.

```
$ aftermerge findings list a1b2c3d4-...
[high/high-confidence] Missing null check on payment webhook
  The webhook handler dereferences `event.data.object` without checking...
[medium/medium-confidence] Race condition in cache invalidation
  Two concurrent requests can both pass the cache-miss check before...
```

---

### `chat`

An interactive chat session with your repo's knowledge graph — the same
underlying chat the web dashboard offers, in your terminal.

```sh
aftermerge chat
```

```
$ aftermerge chat
Chatting — type a message, or 'exit' to quit.

You: what routes does the billing service expose?

It exposes three HTTP routes: POST /webhooks/stripe, GET /invoices/:id...

You: exit

Exiting chat.
```

Notes and current limitations (v1 scope, documented rather than hidden):

- Reuses one thread across a session — subsequent messages have the prior
  conversation as context, same as the web chat.
- Only renders plain-text replies. The underlying chat can also do tool
  calls (e.g. "search the code graph") and reasoning steps — the CLI
  currently only extracts and prints text content, so a response that leans
  heavily on tool calls may print less than you'd see on the web dashboard.
  This is a known, intentional v1 gap, not a bug.
- Pressing **Ctrl+C** exits cleanly (exit code 0) — this is treated as a
  deliberate quit, not an error, even though the mechanism (a special
  "quit" signal from the terminal library) is technically an exceptional
  condition under the hood.
- Same billing gates as web chat (daily/monthly message quotas, burst rate
  limiting) — a `LimitExceeded`/`RateLimitExceeded` message on a turn prints
  the exact server message and lets you keep the session open to try again
  later, rather than killing the whole session over one blocked message.

---

## Global behavior (every command gets these for free)

These come from `@effect/cli`, not from anything we wrote — every command
and subcommand supports them automatically:

| Flag | Effect |
|---|---|
| `-h`, `--help` | Show usage/help for that command |
| `--version` | Print the CLI's version |
| `--completions <sh\|bash\|fish\|zsh>` | Generate a shell-completion script |
| `--wizard` | Interactively build up the command's flags step by step |
| `--log-level <level>` | Adjust internal log verbosity (`debug`, `info`, `warning`, `error`, etc.) |

## Exit codes

This matters if you're scripting against the CLI (CI, a pre-push hook,
etc.) — every command follows the same contract:

- **`0`** — the command completed successfully (including a deliberate
  `exit`/Ctrl+C out of `chat`).
- **non-zero** — anything went wrong: not signed in, network error, a repo
  that isn't connected, a run that failed/was cancelled, a plan limit hit,
  an unexpected response from the server. In every case, the reason is
  printed as a single clean line to stderr before the process exits — never
  a raw stack trace for an expected failure.

## Where your credentials live

Your session token is stored in your OS's native keychain where one is
available:

- macOS Keychain
- Windows Credential Manager
- Linux Secret Service (`libsecret` — most desktop environments; a headless
  box with no Secret Service running doesn't have one)

The (non-secret) server URL you signed into is kept alongside it in a plain
file, `~/.config/aftermerge/config.json`.

If no keychain is available on your machine, the CLI falls back to storing
the token itself in a permission-locked file
(`~/.config/aftermerge/credentials.json`, `600`/`700` permissions) instead —
you'll see a one-time warning when this happens. If a keychain later
becomes available (e.g. you copy your config to a different machine), the
next command transparently migrates the token in and removes the plaintext
fallback file — no re-login required.

`auth logout` clears the token from wherever it's actually stored (keychain
and/or fallback file) and removes both local files. There is currently no
support for being signed into more than one server/org at a time from the
same machine — logging into a different server overwrites the previous
credentials.

## Troubleshooting

**"Not signed in. Run `aftermerge auth login` first."** — either you haven't
run `auth login` yet, or your session has expired/been revoked. Run
`auth login` again.

**"\<server\> is not a valid URL — did you forget "http://" or "https://"?"**
— the `--server` value needs a scheme; `--server app.example.com` won't
work, `--server https://app.example.com` will.

**"Refusing to sign in to \<server\> over plain HTTP..."** — `--server` must
be `https://`, or `localhost`/`127.0.0.1`/`[::1]` for local dev. A plain
`http://` URL to any other host is rejected before any request is sent, so
your session token is never put on the wire in cleartext.

**"This repo isn't connected yet."** on `analyze` — the repo has to already
be registered with your org via the web dashboard (which drives the GitHub
App install) before the CLI can start a run against it. On `scan`, run
`repos add-local` first instead — no web dashboard/GitHub App needed.

**"You're in a detached HEAD state..."** on `scan` — `scan` needs a real
checked-out branch (it uses the branch name as part of what gets uploaded).
Check out a branch first (`git checkout <branch>`), then re-run `scan`.

**A command hangs on `analyze`'s polling step** — this only happens if the
server never returns a terminal status (`completed`/`failed`/`cancelled`)
for a run; this mirrors the web dashboard's own behavior (it polls
indefinitely too) rather than guessing at a timeout. If you believe a run is
stuck, check it in the web dashboard directly.

## Contributing

Bug reports and pull requests are welcome — open an issue or PR against
[aftermerge0/aftermerge-cli](https://github.com/aftermerge0/aftermerge-cli).
See [SETUP.md](SETUP.md) for running the CLI from source, and run
`bun run typecheck` and `bun run lint` before submitting a change.

## License

[MIT](LICENSE)
