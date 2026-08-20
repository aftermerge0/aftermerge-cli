import { useTheme } from "@/hooks/use-theme";
import { AFTERMERGE_COLORS } from "@/lib/terminal-themes/aftermerge";

export interface FindingRow {
  readonly id?: string;
  readonly severity: string;
  readonly band: string;
  readonly title: string;
  readonly description?: string;
}

export const SAMPLE_FINDINGS: FindingRow[] = [
  {
    id: "1",
    severity: "critical",
    band: "runtime",
    title: "Unhandled rejection in webhook handler",
  },
  {
    id: "2",
    severity: "high",
    band: "api",
    title: "N+1 query on repository list",
  },
  {
    id: "3",
    severity: "medium",
    band: "tests",
    title: "Snapshot drift after ingest",
  },
];

const gutterFor = (
  severity: string,
): { ch: string; color: string } => {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "error") {
    return { ch: "█", color: AFTERMERGE_COLORS.danger };
  }
  if (s === "high") {
    return { ch: "▓", color: AFTERMERGE_COLORS.accent };
  }
  return { ch: "░", color: AFTERMERGE_COLORS.muted };
};

const pad = (value: string, width: number): string => {
  const s = value.length > width ? value.slice(0, width) : value;
  return s + " ".repeat(Math.max(0, width - s.length));
};

export const FindingList = ({
  findings,
  maxRows = 16,
  selected,
}: {
  findings: FindingRow[];
  maxRows?: number;
  selected?: number;
}) => {
  const theme = useTheme();
  const visible = findings.slice(0, maxRows);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.colors.mutedForeground}>{" "}</text>
        <text fg={theme.colors.mutedForeground}>{pad("sev", 9)}</text>
        <text fg={theme.colors.mutedForeground}>{pad("band", 10)}</text>
        <text fg={theme.colors.mutedForeground}>title</text>
      </box>
      {visible.map((row, i) => {
        const gutter = gutterFor(row.severity);
        const isSelected = i === selected;
        return (
          <box key={row.id ?? String(i)} flexDirection="row" gap={1}>
            <text fg={gutter.color}>{gutter.ch}</text>
            <text fg={theme.colors.foreground}>
              {pad(row.severity.toLowerCase(), 9)}
            </text>
            <text fg={theme.colors.mutedForeground}>
              {pad(row.band.toLowerCase(), 10)}
            </text>
            <text
              fg={
                isSelected ? theme.colors.accent : theme.colors.foreground
              }
            >
              {row.title}
            </text>
          </box>
        );
      })}
      {findings.length > maxRows ? (
        <text fg={theme.colors.mutedForeground}>
          {`${findings.length - maxRows} more`}
        </text>
      ) : null}
    </box>
  );
};
