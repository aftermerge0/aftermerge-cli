import { describe, expect, test } from "bun:test";
import {
  applyScanEvent,
  completeScanSteps,
  failActiveStep,
  formatElapsed,
  initialScanSteps,
  percentForSteps,
} from "./scan-progress.js";

describe("scan progress", () => {
  test("starts all pending at 0%", () => {
    const steps = initialScanSteps();
    expect(steps.every((s) => s.state === "pending")).toBe(true);
    expect(percentForSteps(steps)).toBe(0);
  });

  test("activates index-base and marks earlier steps done", () => {
    const steps = applyScanEvent(initialScanSteps(), {
      kind: "step",
      step: "index-base",
      detail: "main · 12 files",
    });
    expect(steps[0]?.state).toBe("done");
    expect(steps[1]?.state).toBe("done");
    expect(steps[2]?.state).toBe("active");
    expect(steps[2]?.detail).toBe("main · 12 files");
    expect(steps[3]?.state).toBe("pending");
    expect(percentForSteps(steps)).toBe(36);
  });

  test("analyze pending vs running vs complete", () => {
    const pending = applyScanEvent(initialScanSteps(), {
      kind: "analyze",
      status: "pending",
    });
    expect(percentForSteps(pending, "pending")).toBe(78);
    const running = applyScanEvent(pending, {
      kind: "analyze",
      status: "running",
    });
    expect(percentForSteps(running, "running")).toBe(88);
    expect(percentForSteps(completeScanSteps(running))).toBe(100);
  });

  test("failActiveStep marks only the live step", () => {
    const active = applyScanEvent(initialScanSteps(), {
      kind: "step",
      step: "read-head",
    });
    const failed = failActiveStep(active);
    expect(failed.find((s) => s.id === "read-head")?.state).toBe("failed");
    expect(failed.find((s) => s.id === "resolve")?.state).toBe("done");
  });

  test("formatElapsed", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(4500)).toBe("4s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
  });
});
