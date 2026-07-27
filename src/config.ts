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
// v1 supports exactly one signed-in server at a time (plan 145 §6's
// deferred multi-org/multi-server list) — a single fixed account name is
// sufficient; logging into a different server overwrites this entry, same
// as it overwrote the old plaintext file.
const KEYRING_ACCOUNT = "default";

/** Plan 145 v1: bearer token only, stored locally, never on our servers.
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

export const saveCredentials = (credentials: Credentials): Effect.Effect<void> =>
  Effect.promise(async () => {
    const storedInKeyring = await keyringSet(credentials.token);
    if (storedInKeyring) {
      await writeBaseUrl(credentials.baseUrl);
      // Don't leave the token sitting in the old plaintext location too.
      await rm(CREDENTIALS_PATH, { force: true });
    } else {
      await writeFallbackCredentials(credentials);
    }
  });

export const loadCredentials = (): Effect.Effect<Credentials | null> =>
  Effect.promise(async () => {
    const configFile = Bun.file(CONFIG_PATH);
    if (await configFile.exists()) {
      const { baseUrl } = (await configFile.json()) as StoredConfig;
      const token = await keyringGet();
      // config.json exists but the keychain entry doesn't (cleared outside
      // the CLI, or a keyring daemon that's since become unavailable) —
      // treat this the same as never having signed in, rather than
      // silently falling back to a stale/missing file.
      return token ? { baseUrl, token } : null;
    }

    // No config.json — either a fresh install, or a plaintext credentials
    // file from before this version (or written because the keychain
    // wasn't available at login time).
    const legacyFile = Bun.file(CREDENTIALS_PATH);
    if (!(await legacyFile.exists())) return null;
    const legacy = (await legacyFile.json()) as Credentials;

    // One-time migration: now that a keyring is available (it may not have
    // been when this file was written), move the token in and stop keeping
    // it in cleartext. No user-visible re-login required.
    if (await keyringSet(legacy.token)) {
      await writeBaseUrl(legacy.baseUrl);
      await rm(CREDENTIALS_PATH, { force: true });
    }
    return legacy;
  });

export const clearCredentials = (): Effect.Effect<void> =>
  Effect.promise(async () => {
    await keyringDelete();
    await rm(CREDENTIALS_PATH, { force: true });
    await rm(CONFIG_PATH, { force: true });
  });
