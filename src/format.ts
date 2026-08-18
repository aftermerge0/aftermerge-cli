/** Presentation helpers for terminal output. Everything here is pure and
 * width-aware so `findings` and `scan` render the same way whether they're
 * piped to a file or drawn in an 80-column terminal. */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Human byte sizes for upload progress. Uses 1024 steps but the familiar
 * KB/MB labels, matching what `gh` and `git` print. */
export const formatBytes = (bytes: number, precision = 1): string => {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(precision)} ${UNITS[unit]}`;
};

/** Compact elapsed time: `1.2s`, `4m 07s`, `2h 13m`. Anything under a second
 * is reported in whole milliseconds — sub-millisecond precision is noise at
 * the scale of a network round trip. */
export const formatDuration = (millis: number): string => {
  if (millis < 1000) return `${Math.round(millis)}ms`;

  const totalSeconds = Math.floor(millis / 1000);
  if (totalSeconds < 60) return `${(millis / 1000).toFixed(1)}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
};

/** Truncates to `width` with an ellipsis, so a long branch name can't wrap
 * and break column alignment. Widths under 2 degrade to a hard cut rather
 * than returning a string that's all ellipsis. */
export const truncate = (text: string, width: number): string => {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, Math.max(0, width));
  return `${text.slice(0, width - 1)}…`;
};

export const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

/** Left-aligned fixed-width table. Column widths come from the widest cell,
 * header included, then every cell is truncated to that width so a single
 * runaway value can't stretch the table past the terminal. */
export const renderTable = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
  const widths = headers.map((header, column) =>
    rows.reduce((widest, row) => Math.max(widest, (row[column] ?? "").length), header.length),
  );

  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => truncate(cell, widths[column]!).padEnd(widths[column]!))
      .join("  ")
      .trimEnd();

  return [line(headers), ...rows.map(line)].join("\n");
};
