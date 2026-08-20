import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { useAnimation } from "@/hooks/use-animation";
import { useTheme } from "@/hooks/use-theme";
import { AFTERMERGE_COLORS } from "@/lib/terminal-themes/aftermerge";
import { formatElapsed, type ScanStep } from "@/scan-progress";
import { EmptyState, ErrorLine, StatusLine, ViewHeader } from "@/ui/chrome";
import {
  FindingList,
  type FindingRow,
} from "@/ui/views/finding-list";

export type ScanStatus = "idle" | "running" | "completed" | "failed";

export interface ScanProgress {
  readonly value: number;
  readonly total?: number;
  readonly label?: string;
}

export interface ScanViewProps {
  status?: ScanStatus;
  progress?: ScanProgress;
  steps?: ScanStep[];
  startedAt?: number;
  findings?: FindingRow[];
  pr?: number;
  error?: string;
  hint?: string;
}

const statusTone = (
  status: ScanStatus,
): "muted" | "info" | "ok" | "danger" => {
  if (status === "running") {
    return "info";
  }
  if (status === "completed") {
    return "ok";
  }
  if (status === "failed") {
    return "danger";
  }
  return "muted";
};

const statusLabel = (
  status: ScanStatus,
  pr: number | undefined,
  active?: ScanStep,
  elapsed?: string,
): string => {
  if (status === "running") {
    const phase = active?.detail
      ? `${active.title} · ${active.detail}`
      : (active?.title ?? "scanning");
    const scope =
      pr === undefined ? phase : `pr ${pr} · ${phase}`;
    return elapsed ? `${scope} · ${elapsed}` : scope;
  }
  if (status === "completed") {
    return pr === undefined ? "scan complete" : `pull request ${pr} scanned`;
  }
  if (status === "failed") {
    return "scan failed";
  }
  return pr === undefined ? "no scan yet" : `pull request ${pr} queued`;
};

const markFor = (state: ScanStep["state"]): { ch: string; color: string } => {
  if (state === "done") {
    return { ch: "✓", color: AFTERMERGE_COLORS.ok };
  }
  if (state === "failed") {
    return { ch: "×", color: AFTERMERGE_COLORS.danger };
  }
  if (state === "active") {
    return { ch: "▸", color: AFTERMERGE_COLORS.accent };
  }
  return { ch: "○", color: AFTERMERGE_COLORS.muted };
};

const Stepper = ({ steps }: { steps: ScanStep[] }) => {
  const theme = useTheme();

  return (
    <box flexDirection="column" gap={0} marginTop={1} flexShrink={0}>
      {steps.map((step) => {
        const mark = markFor(step.state);
        const fg =
          step.state === "pending"
            ? theme.colors.mutedForeground
            : theme.colors.foreground;
        return (
          <box key={step.id} flexDirection="row" gap={1}>
            {step.state === "active" ? (
              <Spinner type="line" color={AFTERMERGE_COLORS.accent} />
            ) : (
              <text fg={mark.color}>{mark.ch}</text>
            )}
            <text fg={fg}>{step.title}</text>
            {step.detail ? (
              <text fg={theme.colors.mutedForeground}>{step.detail}</text>
            ) : null}
          </box>
        );
      })}
    </box>
  );
};

export const ScanView = ({
  status,
  progress,
  steps = [],
  startedAt,
  findings = [],
  pr,
  error,
  hint,
}: ScanViewProps) => {
  const theme = useTheme();
  const resolved: ScanStatus = status ?? "idle";
  useAnimation({
    intervalMs: 1000,
    isActive: resolved === "running" && startedAt !== undefined,
  });
  const elapsed =
    resolved === "running" && startedAt !== undefined
      ? formatElapsed(Date.now() - startedAt)
      : undefined;
  const active = steps.find((step) => step.state === "active");

  return (
    <box flexDirection="column" flexGrow={1}>
      <ViewHeader
        kicker="scan"
        title={
          pr === undefined
            ? "Post-merge analysis for this repo"
            : `Post-merge analysis for pull request ${pr}`
        }
      />
      <StatusLine
        tone={statusTone(resolved)}
        live={resolved === "running"}
        label={statusLabel(resolved, pr, active, elapsed)}
      />
      {resolved === "running" || resolved === "failed" ? (
        <box marginTop={1} flexDirection="column" gap={1} flexShrink={0}>
          {steps.length > 0 ? <Stepper steps={steps} /> : null}
          {resolved === "running" && progress ? (
            <ProgressBar
              value={progress.value}
              total={progress.total}
              label={progress.label}
              color={theme.colors.accent}
              fillChar="█"
              emptyChar="░"
              width={28}
            />
          ) : null}
        </box>
      ) : null}
      {error ? (
        <box marginTop={1}>
          <ErrorLine>{error}</ErrorLine>
        </box>
      ) : null}
      <box marginTop={1} flexGrow={1} flexDirection="column">
        {findings.length > 0 ? (
          <FindingList findings={findings} />
        ) : resolved === "running" ? null : resolved === "idle" ? (
          <EmptyState>press s to scan this repo</EmptyState>
        ) : resolved === "failed" ? null : (
          <EmptyState>no findings on this run</EmptyState>
        )}
      </box>
      {hint ? (
        <box flexShrink={0}>
          <text fg={theme.colors.mutedForeground}>{hint}</text>
        </box>
      ) : null}
    </box>
  );
};
