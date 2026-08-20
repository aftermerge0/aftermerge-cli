export const wantsTui = (argv: readonly string[]): boolean => {
  const args = argv.slice(2);
  if (args.includes("--no-tui")) return false;
  if (args.includes("--help") || args.includes("-h")) return false;
  if (args.includes("--version")) return false;
  if (process.env.CI) return false;
  if (process.env.TERM === "dumb") return false;
  // Default product is the TUI — `aftermerge` and `am` on a TTY both land
  // here. Line-oriented CLI is opt-out (`--no-tui`) or non-interactive.
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
};
