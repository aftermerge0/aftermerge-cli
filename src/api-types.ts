/** Shared wire-response shapes for the web app's existing `app/api/**`
 * routes, and the type guards that validate an `apiRequest` response before
 * it's trusted. Centralized here because `analyze`, `scan`, `findings`, and
 * `repos` all consume the same repo/run/finding shapes — previously each
 * command redeclared its own copy, and the copies had already started to
 * drift (e.g. `scan.ts`'s guards lost the comment explaining why they
 * exist, and `repos.ts`'s `RepoRow` didn't declare `cloneUrl` while
 * `analyze.ts`'s did, even though `GET /api/repos` returns the same row
 * shape to both). */

/**
 * Ids on the wire are `bigint` identity columns in the web app's schema
 * (D25), so JSON carries them as NUMBERS — `{"id": 4}`, never `{"id": "4"}`.
 * The frozen app used string ids and every guard below was written against
 * that, which is why each one rejected each real row and every command died
 * with its generic "unexpected response" message.
 *
 * Accept both rather than pinning to number: the REST routes are a shim with
 * a sunset (D27) and the RPC surface that replaces them may well emit
 * strings, so a guard that demands one type would break again on the way out.
 *
 * `idToString` is for the two places an id is COMPARED or handed to a
 * string-typed parameter. Interpolating into a URL needs nothing — a template
 * string coerces on its own.
 */
export type WireId = string | number;

export const isWireId = (value: unknown): value is WireId =>
  (typeof value === "string" && value.length > 0) ||
  (typeof value === "number" && Number.isInteger(value));

export const idToString = (id: WireId): string => String(id);

export interface RepoRow {
  readonly id: WireId;
  readonly owner: string;
  readonly name: string;
  readonly cloneUrl: string;
}

export interface RegisteredRepo extends RepoRow {
  readonly defaultBranch: string;
}

export interface EnsuredBranch {
  readonly id: WireId;
  readonly name: string;
}

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface AnalysisRun {
  readonly id: WireId;
  readonly status: RunStatus;
}

export interface Finding {
  readonly title: string;
  readonly severity: string;
  readonly band: string;
  readonly description: string;
}

export interface IndexedBranch {
  readonly repositoryId: WireId;
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
    isWireId(v.id) &&
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
  return isWireId(v.id) && typeof v.name === "string";
};

export const isAnalysisRun = (value: unknown): value is AnalysisRun => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isWireId(v.id) && typeof v.status === "string" && KNOWN_STATUSES.has(v.status);
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
    isWireId(v.repositoryId) &&
    typeof v.owner === "string" &&
    typeof v.name === "string" &&
    typeof v.branchName === "string" &&
    typeof v.commitSha === "string" &&
    (v.ingestSource === "clone" || v.ingestSource === "upload")
  );
};
