# AfterMerge CLI

A terminal client for AfterMerge — sign in once, then run the same PR
analysis checks the web dashboard runs, without leaving your shell.

This is a **reference for using the commands**. For how the CLI is built and
why it's architected this way, see `plans/145-cli-device-auth-and-terminal-
client.md` (the implementation plan) and `plans/146-cli-architecture-deep-
dive.md` (a from-scratch explanation of the design, written for someone new
to CLI/auth engineering).

---

## Install / run

The CLI is not yet packaged as a standalone binary (that's deferred — see
plan 145 §"Explicitly deferred"). For now, run it from source with Bun:

```sh
cd cli
bun install
bun run src/index.ts <command> [args]
```

Every example below assumes you're running from inside `cli/` this way. Once
`bun build --compile` packaging lands, the same commands will work as
`aftermerge <command> [args]` from anywhere.

---

## Command reference

### `auth login`

Signs you in via your browser. Required before any other command works.

```sh
bun run src/index.ts auth login [--server <url>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--server` | `http://localhost:3000` | Base URL of your AfterMerge deployment. Point this at a real deployment with `--server https://your-instance.example.com`. |

What happens:

1. The CLI asks the server for a device code and a short human-readable code.
2. It prints both and opens your default browser to an approval page.
3. It polls in the background until you approve (or deny, or the code
   expires — default 30 minutes).
4. On approval, it stores a session token locally at
   `~/.config/aftermerge/credentials.json` (file permissions `600`, directory
   permissions `700` — readable only by you).

Example:

```
$ bun run src/index.ts auth login --server https://app.aftermerge.dev

  Code: WDJB-MKRS
  Visit: https://app.aftermerge.dev/device?user_code=WDJB-MKRS

Opening your browser — waiting for you to approve...
Signed in.
```

If you don't approve within the expiry window, or you click Deny, the CLI
prints the reason and exits non-zero.

### `auth whoami`

Shows who you're currently signed in as.

```sh
bun run src/index.ts auth whoami
```

```
$ bun run src/index.ts auth whoami
Signed in as Jane Doe (jane@example.com)
Organization: org_a1b2c3
Server: https://app.aftermerge.dev
```

If you're not signed in (or your session has expired), it says so and exits
non-zero — safe to use in a script as a preflight check:

```sh
bun run src/index.ts auth whoami > /dev/null 2>&1 || bun run src/index.ts auth login
```

### `auth logout`

Deletes your locally stored credentials. Does not need network access; this
only removes the local file, it doesn't revoke the session server-side.

```sh
bun run src/index.ts auth logout
```

---

### `analyze`

Triggers the same PR analysis pipeline the web dashboard runs, for the repo
in your current directory.

```sh
bun run src/index.ts analyze --pr <number>
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
$ bun run src/index.ts analyze --pr 128
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
$ bun run src/index.ts analyze --pr 1
This repo isn't connected yet. Connect it from the web dashboard first, then try again.
```
(exits non-zero)

Example — hitting a plan limit:

```
$ bun run src/index.ts analyze --pr 200
Starting analysis for acme/billing-service PR #200...
Monthly analysis run limit: plan limit of 25 would be exceeded (currently 25, adding 1). Upgrade your plan to continue.
```
(exits non-zero — this is the exact same message the web dashboard would show for the same limit, not a CLI-specific rewording)

A run that fails or gets cancelled (e.g. a newer run started for the same
branch superseded it) is reported the same way, and also exits non-zero.

---

### `repos list`

Lists every repo connected to your organization.

```sh
bun run src/index.ts repos list
```

```
$ bun run src/index.ts repos list
acme/billing-service  (7f3e1c9a-...)
acme/frontend         (9b2d4e11-...)
```

The id in parentheses is what other commands (like a future `analyze --repo`
override, not yet built) would take. Right now it's mainly useful for
cross-referencing with the web dashboard.

---

### `findings list <run-id>`

Lists every finding for a specific analysis run, by run id.

```sh
bun run src/index.ts findings list <run-id>
```

`<run-id>` is a positional argument — the id printed by `analyze`, or found
in the web dashboard's run URL.

```
$ bun run src/index.ts findings list a1b2c3d4-...
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
bun run src/index.ts chat
```

```
$ bun run src/index.ts chat
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
  This is a known, intentional v1 gap (see plan 146 §6.4), not a bug.
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

`~/.config/aftermerge/credentials.json` — a JSON object with your session
token and the server URL you signed into, permissioned so only your user
account can read it. `auth logout` deletes this file. There is currently no
support for being signed into more than one server/org at a time from the
same machine (see plan 145's deferred list) — logging into a different
server overwrites the previous credentials.

## Troubleshooting

**"Not signed in. Run `aftermerge auth login` first."** — either you haven't
run `auth login` yet, or your session has expired/been revoked. Run
`auth login` again.

**"\<server\> is not a valid URL — did you forget "http://" or "https://"?"**
— the `--server` value needs a scheme; `--server app.example.com` won't
work, `--server https://app.example.com` will.

**"This repo isn't connected yet."** on `analyze` — the repo has to already
be registered with your org via the web dashboard (which drives the GitHub
App install) before the CLI can start a run against it.

**A command hangs on `analyze`'s polling step** — this only happens if the
server never returns a terminal status (`completed`/`failed`/`cancelled`)
for a run; this mirrors the web dashboard's own behavior (it polls
indefinitely too) rather than guessing at a timeout. If you believe a run is
stuck, check it in the web dashboard directly.
