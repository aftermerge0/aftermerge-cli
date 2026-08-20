export const SCAN_STEP_ORDER = [
  "resolve",
  "read-base",
  "index-base",
  "read-head",
  "index-head",
  "start",
  "analyze",
] as const;

export type ScanStepId = (typeof SCAN_STEP_ORDER)[number];

export type ScanStepState = "pending" | "active" | "done" | "failed";

export interface ScanStep {
  readonly id: ScanStepId;
  readonly title: string;
  readonly state: ScanStepState;
  readonly detail?: string;
}

export type ScanProgressEvent =
  | { readonly kind: "step"; readonly step: ScanStepId; readonly detail?: string }
  | { readonly kind: "analyze"; readonly status: string };

const TITLES: Record<ScanStepId, string> = {
  resolve: "resolve refs",
  "read-base": "read base",
  "index-base": "index base",
  "read-head": "read head",
  "index-head": "index head",
  start: "start run",
  analyze: "run scenario",
};

/** Weights land on the *active* step so long POSTs (index) and the 2s
 * analysis poll hold a stable bar instead of sitting at 6%. */
const WEIGHT: Record<ScanStepId, number> = {
  resolve: 8,
  "read-base": 16,
  "index-base": 36,
  "read-head": 44,
  "index-head": 64,
  start: 72,
  analyze: 78,
};

export const initialScanSteps = (): ScanStep[] =>
  SCAN_STEP_ORDER.map((id) => ({
    id,
    title: TITLES[id],
    state: "pending" as const,
  }));

export const applyScanEvent = (
  steps: readonly ScanStep[],
  event: ScanProgressEvent,
): ScanStep[] => {
  const stepId = event.kind === "analyze" ? "analyze" : event.step;
  const detail =
    event.kind === "analyze"
      ? event.status
      : event.detail;
  const activeIndex = SCAN_STEP_ORDER.indexOf(stepId);

  return steps.map((step, i) => {
    if (i < activeIndex) {
      return { ...step, state: "done" };
    }
    if (i === activeIndex) {
      return {
        ...step,
        state: "active",
        detail: detail ?? step.detail,
      };
    }
    return { ...step, state: "pending", detail: undefined };
  });
};

export const failActiveStep = (steps: readonly ScanStep[]): ScanStep[] =>
  steps.map((step) =>
    step.state === "active" ? { ...step, state: "failed" } : step,
  );

export const completeScanSteps = (steps: readonly ScanStep[]): ScanStep[] =>
  steps.map((step) => ({ ...step, state: "done" as const }));

export const percentForSteps = (
  steps: readonly ScanStep[],
  analyzeStatus?: string,
): number => {
  if (steps.every((step) => step.state === "done")) {
    return 100;
  }
  const active = steps.find((step) => step.state === "active");
  if (!active) {
    return 0;
  }
  if (active.id === "analyze") {
    if (analyzeStatus === "running") {
      return 88;
    }
    if (analyzeStatus === "completed") {
      return 100;
    }
    return WEIGHT.analyze;
  }
  return WEIGHT[active.id];
};

export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
};
