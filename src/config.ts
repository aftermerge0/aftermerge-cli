import { chmod, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

const CONFIG_DIR = join(homedir(), ".config", "aftermerge");
// Non-secret: which server this machine is signed into. Kept separate from
// the token itself so the token can live in the OS keychain (below) while
// this stays a plain file.
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
// Legacy/fallback location: pre-plan-147 versions stored `{ baseUrl, token }`
// here in cleartext. Still used as a fallback when the OS keychain is
// unavailable (§2's "don't hard-fail on machines without a keyring daemon").
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");

const KEYRING_SERVICE = "aftermerge-cli";
// v1 supports exactly one signed-in server at a time (multi-org/multi-server
// support is deferred) — a single fixed account name is sufficient; logging
// into a different server overwrites this entry, same as it overwrote the
// old plaintext file.
const KEYRING_ACCOUNT = "default";

/** v1: bearer token only, stored locally, never on our servers.
 * `baseUrl` travels with it so a login against a non-default server
 * (self-hosted / local dev) doesn't need to be re-specified on every command. */
export interface Credentials {
  readonly baseUrl: string;
  readonly token: string;
}

interface StoredConfig {
  readonly baseUrl: string;
}

let warnedFallback = false;

/** Printed at most once per process — a construction failure (e.g. no
 * Secret Service running on a headless Linux box) is retried on every call
 * otherwise, which would otherwise mean one warning per HTTP request. */
function warnFallbackOnce(reason: string): void {
  if (warnedFallback) return;
  warnedFallback = true;
  console.error(
    `Warning: could not use the OS keychain (${reason}). Falling back to a permission-locked file at ${CREDENTIALS_PATH}.`,
  );
}

async function keyringSet(token: string): Promise<boolean> {
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    await entry.setPassword(token);
    return true;
  } catch (cause) {
    warnFallbackOnce(cause instanceof Error ? cause.message : String(cause));
    return false;
  }
}

async function keyringGet(): Promise<string | null> {
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    return (await entry.getPassword()) ?? null;
  } catch {
    return null;
  }
}

async function keyringDelete(): Promise<void> {
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    await entry.deletePassword();
  } catch {
    // Nothing stored, or no keyring available on this machine — either way
    // there's nothing to clean up.
  }
}

async function ensureConfigDir(): Promise<void> {
  // Owner-only dir: closes the brief window between Bun.write (creates the
  // file at the platform default mode) and the chmod below — even though
  // the file is momentarily world/group-readable, a 0o700 dir means no
  // other user can traverse into it to read it. `mkdir`'s `mode` only
  // applies when it actually creates the dir, so chmod it unconditionally
  // too — otherwise a dir left looser by an earlier run stays that way.
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await chmod(CONFIG_DIR, 0o700);
}

async function writeBaseUrl(baseUrl: string): Promise<void> {
  await ensureConfigDir();
  await Bun.write(CONFIG_PATH, JSON.stringify({ baseUrl } satisfies StoredConfig, null, 2));
  await chmod(CONFIG_PATH, 0o600);
}

async function writeFallbackCredentials(credentials: Credentials): Promise<void> {
  await ensureConfigDir();
  await Bun.write(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
  // Secrets file: owner read/write only. Runs unconditionally on every
  // save, so a file left looser by an older version gets tightened too.
  await chmod(CREDENTIALS_PATH, 0o600);
}

/** Reads the legacy plaintext file, migrating it into the keychain if one is
 * available now (it may not have been when the file was written). Migration
 * is a courtesy, never a requirement of the read: if `keyringSet` or the
 * `config.json` write fails partway, the legacy file is left exactly as it
 * was rather than deleted, so the NEXT read retries the migration instead of
 * landing in a state neither path can recover from. */
async function readLegacyCredentials(): Promise<Credentials | null> {
  const legacyFile = Bun.file(CREDENTIALS_PATH);
  if (!(await legacyFile.exists())) return null;
  const legacy = (await legacyFile.json()) as Credentials;

  try {
    if (await keyringSet(legacy.token)) {
      await writeBaseUrl(legacy.baseUrl);
      await rm(CREDENTIALS_PATH, { force: true });
    }
  } catch {
    // Leave the legacy file in place — it's still valid and usable even if
    // tidying it into the keychain didn't fully complete this time.
  }
  return legacy;
}

function toConfigError(cause: unknown, action: string): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Could not ${action} under ${CONFIG_DIR}: ${reason}. Run \`aftermerge auth logout\` to reset.`,
  );
}

export const saveCredentials = (credentials: Credentials): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      const storedInKeyring = await keyringSet(credentials.token);
      if (storedInKeyring) {
        await writeBaseUrl(credentials.baseUrl);
        // Don't leave the token sitting in the old plaintext location too.
        await rm(CREDENTIALS_PATH, { force: true });
      } else {
        await writeFallbackCredentials(credentials);
        // Symmetric cleanup: a STALE config.json from an earlier, successful
        // keyring-based login must not survive a fallback save, or the next
        // `loadCredentials` call finds it, fails to reach that earlier
        // keyring entry (the same unavailable keyring that just caused this
        // fallback), and reports "not signed in" — even though this save
        // just printed "Signed in." Without this, a keyring that becomes
        // unavailable after a prior login locks the user out permanently,
        // recoverable only via `auth logout`.
        await rm(CONFIG_PATH, { force: true });
      }
    },
    catch: (cause) => toConfigError(cause, "save credentials"),
  });

export const loadCredentials = (): Effect.Effect<Credentials | null, Error> =>
  Effect.tryPromise({
    try: async () => {
      const configFile = Bun.file(CONFIG_PATH);
      if (await configFile.exists()) {
        const { baseUrl } = (await configFile.json()) as StoredConfig;
        const token = await keyringGet();
        if (token) return { baseUrl, token };
        // config.json exists but the keychain entry doesn't — this can mean
        // the keyring is genuinely empty (cleared outside the CLI), or that
        // it's just unavailable THIS session (e.g. a headless/SSH session
        // with no unlocked Secret Service) while a more recent fallback save
        // exists. Check the fallback file before concluding "not signed in."
        return await readLegacyCredentials();
      }

      return await readLegacyCredentials();
    },
    catch: (cause) => toConfigError(cause, "read credentials"),
  });

export const clearCredentials = (): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await keyringDelete();
      await rm(CREDENTIALS_PATH, { force: true });
      await rm(CONFIG_PATH, { force: true });
    },
    catch: (cause) => toConfigError(cause, "clear credentials"),
  });
