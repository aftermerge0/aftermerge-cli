/** Shared wire-response shapes for the web app's existing `app/api/**`
 * routes, and the type guards that validate an `apiRequest` response before
 * it's trusted. Centralized here because `analyze`, `scan`, `findings`, and
 * `repos` all consume the same repo/run/finding shapes — previously each
 * command redeclared its own copy, and the copies had already started to
 * drift (e.g. `scan.ts`'s guards lost the comment explaining why they
 * exist, and `repos.ts`'s `RepoRow` didn't declare `cloneUrl` while
 * `analyze.ts`'s did, even though `GET /api/repos` returns the same row
 * shape to both). */

export interface RepoRow {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly cloneUrl: string;
}

export interface RegisteredRepo extends RepoRow {
  readonly defaultBranch: string;
}

export interface EnsuredBranch {
  readonly id: string;
  readonly name: string;
}

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface AnalysisRun {
  readonly id: string;
  readonly status: RunStatus;
}

export interface Finding {
  readonly title: string;
  readonly severity: string;
  readonly band: string;
  readonly description: string;
}

export interface IndexedBranch {
  readonly repositoryId: string;
  readonly owner: string;
  readonly name: string;
  readonly branchName: string;
  readonly commitSha: string;
  readonly ingestSource: "clone" | "upload";
}

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

// Guards on every cast API response before it's used: an `as`-cast alone
// doesn't stop a malformed/differently-shaped body from throwing once it's
// actually read (e.g. `.find` on a non-array, `.status` on `null`) — and a
// plain throw inside `Effect.gen` is an uncatchable defect, not a normal
// Effect failure (see url.ts's doc comment for the same footgun). These
// guards turn that into a clean, catchable `Error` instead.
export const isRepoRow = (value: unknown): value is RepoRow => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.owner === "string" &&
    typeof v.name === "string" &&
    typeof v.cloneUrl === "string"
  );
};

export const isRegisteredRepo = (value: unknown): value is RegisteredRepo =>
  isRepoRow(value) && typeof (value as unknown as Record<string, unknown>).defaultBranch === "string";

export const isEnsuredBranch = (value: unknown): value is EnsuredBranch => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string";
};

export const isAnalysisRun = (value: unknown): value is AnalysisRun => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.status === "string" && KNOWN_STATUSES.has(v.status);
};

export const isFinding = (value: unknown): value is Finding => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    typeof v.severity === "string" &&
    typeof v.band === "string" &&
    typeof v.description === "string"
  );
};

export const isIndexedBranch = (value: unknown): value is IndexedBranch => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.repositoryId === "string" &&
    typeof v.owner === "string" &&
    typeof v.name === "string" &&
    typeof v.branchName === "string" &&
    typeof v.commitSha === "string" &&
    (v.ingestSource === "clone" || v.ingestSource === "upload")
  );
};
