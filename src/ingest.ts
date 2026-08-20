import { Effect } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { apiRequest, ApiError } from "./http.js";
import type { WireId } from "./api-types.js";
import type { ArchivedFile } from "./upload.js";

/** Uploads one ref's content and waits for ingestion — `/api/ingest/upload`
 * runs the whole ingest synchronously and is idempotent: if this exact
 * commit is already ingested, the server's own freshness check returns
 * almost immediately (see ingest-repo-from-upload.ts), so calling this for
 * a ref that's already indexed from a prior scan costs nothing beyond one
 * quick round-trip.
 *
 * `label` identifies which upload failed (e.g. "base", "head", "index") in
 * the error message — surfacing the same bare "Request failed" for every
 * caller made a partial-upload failure (e.g. base succeeds, head fails)
 * indistinguishable from the other. The uploaded state itself is benign
 * either way: nothing else happens until the caller's own next step
 * succeeds, and a retry costs only a quick freshness-check round-trip for
 * whichever ref already landed. */
export const uploadRef = (
  label: string,
  repositoryId: WireId,
  branch: string,
  commitSha: string,
  files: ArchivedFile[],
): Effect.Effect<void, ApiError | Error, HttpClient.HttpClient> =>
  apiRequest("POST", "/api/ingest/upload", { repositoryId, branch, commitSha, files }).pipe(
    Effect.asVoid,
    Effect.mapError((error) =>
      error instanceof ApiError
        ? new ApiError({ status: error.status, message: `Uploading ${label} (${branch}): ${error.message}` })
        : new Error(`Uploading ${label} (${branch}): ${error.message}`),
    ),
  );
