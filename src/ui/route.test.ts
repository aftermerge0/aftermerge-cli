import { describe, expect, test } from "bun:test";
import { parseRoute } from "./route.js";

describe("parseRoute", () => {
  test("empty argv defaults to scan", () => {
    expect(parseRoute([])).toEqual({ view: "scan" });
  });

  test("bun-style argv defaults to scan", () => {
    expect(parseRoute(["bun", "src/index.ts"])).toEqual({ view: "scan" });
  });

  test("chat", () => {
    expect(parseRoute(["chat"])).toEqual({ view: "chat" });
  });

  test("scan --pr 12", () => {
    expect(parseRoute(["scan", "--pr", "12"])).toEqual({ view: "scan", pr: 12 });
  });

  test("--pr=8 defaults to scan", () => {
    expect(parseRoute(["--pr=8"])).toEqual({ view: "scan", pr: 8 });
  });

  test("findings", () => {
    expect(parseRoute(["findings"])).toEqual({ view: "findings" });
  });

  test("analyze is not a view and defaults to scan", () => {
    expect(parseRoute(["analyze"])).toEqual({ view: "scan" });
  });

  test("invalid --pr values are omitted", () => {
    expect(parseRoute(["scan", "--pr", "0"])).toEqual({ view: "scan" });
    expect(parseRoute(["scan", "--pr", "-1"])).toEqual({ view: "scan" });
    expect(parseRoute(["scan", "--pr", "NaN"])).toEqual({ view: "scan" });
  });
});
