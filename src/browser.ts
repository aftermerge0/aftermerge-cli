import { Effect } from "effect";

/** Best-effort: opening a browser is never allowed to fail the CLI run — the
 * caller already printed the URL for the user to open manually. This means
 * the async body below must never reject (a rejection inside `Effect.promise`
 * becomes an uncatchable defect, not a normal Effect failure — see the
 * `parseUrl` comment in url.ts for the same footgun), so everything is
 * wrapped in a plain try/catch rather than relying on Effect's error
 * channel. */
export const openInBrowser = (url: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      const parsed = new URL(url);
      // The server supplies this URL. Only ever hand a real http(s) link to
      // the OS opener: a non-web scheme (file://, custom handlers) would do
      // more than "open a web page", and re-serializing through `URL` first
      // also rules out a value like "-a Calculator" being parsed as a flag
      // by `open`/`xdg-open` (it can't parse as an absolute http(s) URL).
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

      const target = parsed.toString();
      const command =
        process.platform === "darwin"
          ? ["open", target]
          : process.platform === "win32"
            ? // NOT `["cmd", "/c", "start", "", target]` — `cmd.exe` parses its
              // own command line for `&`/`|`/`^` as separators/pipes
              // independent of argv-quoting (the "BatBadBut"/CVE-2024-27980
              // class of Windows footgun), and those characters survive
              // WHATWG URL serialization unescaped. `rundll32` opens the URL
              // via the shell's URL handler directly, with no command-line
              // shell in between to reinterpret it.
              ["rundll32", "url.dll,FileProtocolHandler", target]
            : ["xdg-open", target];
      const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      await proc.exited;
    } catch {
      // best-effort — see doc comment above
    }
  });
