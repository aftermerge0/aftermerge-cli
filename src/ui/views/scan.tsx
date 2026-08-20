import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/hooks/use-theme";
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

const statusLabel = (status: ScanStatus, pr?: number): string => {
  if (status === "running") {
    return pr === undefined ? "scanning this repo" : `scanning pull request ${pr}`;
  }
  if (status === "completed") {
    return pr === undefined ? "scan complete" : `pull request ${pr} scanned`;
  }
  if (status === "failed") {
    return "scan failed";
  }
  return pr === undefined ? "no scan yet" : `pull request ${pr} queued`;
};

export const ScanView = ({
  status,
  progress,
  findings = [],
  pr,
  error,
  hint,
}: ScanViewProps) => {
  const theme = useTheme();
  const resolved: ScanStatus = status ?? "idle";

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
      <StatusLine tone={statusTone(resolved)} label={statusLabel(resolved, pr)} />
      {resolved === "running" ? (
        <box marginTop={1} flexDirection="column" gap={1} flexShrink={0}>
          <Spinner
            type="line"
            label="running"
            color={theme.colors.mutedForeground}
          />
          {progress ? (
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
        ) : resolved === "running" ? (
          <EmptyState>findings appear here as the run finishes</EmptyState>
        ) : resolved === "idle" ? (
          <EmptyState>press s to scan this repo</EmptyState>
        ) : (
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
