export const VIEW_IDS = ["scan", "repos", "findings", "chat", "auth"] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export interface ParsedRoute {
  view: ViewId;
  pr?: number;
}

const VIEW_SET = new Set<string>(VIEW_IDS);

const isViewId = (value: string): value is ViewId => VIEW_SET.has(value);

const parsePositiveInt = (raw: string | undefined): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    return undefined;
  }
  return n;
};

/** Drop bun/node/binary path so we can parse both full process.argv and sliced args. */
const positionalArgs = (argv: string[]): string[] => {
  const start = argv.findIndex(
    (a) => isViewId(a) || a === "analyze" || a.startsWith("-"),
  );
  if (start === -1) {
    return [];
  }
  return argv.slice(start);
};

export const parseRoute = (argv: string[]): ParsedRoute => {
  const args = positionalArgs(argv);
  let view: ViewId = "scan";
  let pr: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (isViewId(arg)) {
      view = arg;
      continue;
    }
    if (arg === "--pr") {
      pr = parsePositiveInt(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--pr=")) {
      pr = parsePositiveInt(arg.slice(5));
    }
  }

  return pr === undefined ? { view } : { view, pr };
};
