export const wantsTui = (argv: readonly string[]): boolean => {
  const args = argv.slice(2);
  if (args.includes("--no-tui")) return false;
  if (args.includes("--help") || args.includes("-h")) return false;
  if (args.includes("--version")) return false;
  if (process.env.CI) return false;
  if (process.env.TERM === "dumb") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
};
