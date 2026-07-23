import { chmod, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

const CONFIG_DIR = join(homedir(), ".config", "aftermerge");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");

/** Plan 145 v1: bearer token only, stored locally, never on our servers.
 * `baseUrl` travels with it so a login against a non-default server
 * (self-hosted / local dev) doesn't need to be re-specified on every command. */
export interface Credentials {
  readonly baseUrl: string;
  readonly token: string;
}

export const saveCredentials = (credentials: Credentials): Effect.Effect<void> =>
  Effect.promise(async () => {
    // Owner-only dir: closes the brief window between Bun.write (creates the
    // file at the platform default mode) and the chmod below — even though
    // the file is momentarily world/group-readable, a 0o700 dir means no
    // other user can traverse into it to read it. `mkdir`'s `mode` only
    // applies when it actually creates the dir, so chmod it unconditionally
    // too — otherwise a dir left looser by an earlier run stays that way.
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    await chmod(CONFIG_DIR, 0o700);
    await Bun.write(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
    // Secrets file: owner read/write only. Runs unconditionally on every
    // save, so a file left looser by an older version gets tightened too.
    await chmod(CREDENTIALS_PATH, 0o600);
  });

export const loadCredentials = (): Effect.Effect<Credentials | null> =>
  Effect.promise(async () => {
    const file = Bun.file(CREDENTIALS_PATH);
    if (!(await file.exists())) return null;
    return (await file.json()) as Credentials;
  });

export const clearCredentials = (): Effect.Effect<void> =>
  Effect.promise(async () => {
    await rm(CREDENTIALS_PATH, { force: true });
  });
