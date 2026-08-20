import { afterEach, describe, expect, test } from "bun:test";
import { wantsTui } from "./wants-tui.js";

const argv = (...flags: string[]) => ["bun", "src/index.ts", ...flags];

const originalCi = process.env.CI;
const originalTerm = process.env.TERM;

afterEach(() => {
  if (originalCi === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = originalCi;
  }
  if (originalTerm === undefined) {
    delete process.env.TERM;
  } else {
    process.env.TERM = originalTerm;
  }
});

describe("wantsTui", () => {
  test("--no-tui returns false regardless of TTY", () => {
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    expect(wantsTui(argv("--no-tui"))).toBe(false);
  });

  test("--help returns false regardless of TTY", () => {
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    expect(wantsTui(argv("--help"))).toBe(false);
  });

  test("-h returns false regardless of TTY", () => {
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    expect(wantsTui(argv("-h"))).toBe(false);
  });

  test("--version returns false regardless of TTY", () => {
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    expect(wantsTui(argv("--version"))).toBe(false);
  });

  test("CI env returns false", () => {
    process.env.CI = "true";
    process.env.TERM = "xterm-256color";
    expect(wantsTui(argv())).toBe(false);
  });

  test("TERM=dumb returns false", () => {
    delete process.env.CI;
    process.env.TERM = "dumb";
    expect(wantsTui(argv())).toBe(false);
  });

  test("happy path without flags", () => {
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    const result = wantsTui(argv());
    if (process.stdin.isTTY && process.stdout.isTTY) {
      expect(result).toBe(true);
    } else {
      expect(typeof result).toBe("boolean");
    }
  });
});
