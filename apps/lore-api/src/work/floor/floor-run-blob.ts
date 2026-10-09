// A blob the external floor keeps, read on behalf of ONE run (run-viz FR4.4m). A blob is addressed by its hash alone, so the read is only as private as the hash is unguessable; tying it to a run the caller already has access to means a person can open what that run was given or made, and nothing else.
import type { FloorClient } from "@re-cinq/floor-client";

export type BlobFloor = Pick<FloorClient, "runs" | "stationRuns" | "blobs">;

export interface RunBlob {
  hash: string;
  contentType: string;
  size: number;
  /** The blob as text, or null for bytes a page cannot show as text. */
  text: string | null;
  /** True when `text` stops short of the blob. */
  truncated: boolean;
}

const TEXT_LIMIT_BYTES = 1_048_576;
const TEXTUAL_CONTENT_TYPE = /^(text\/|application\/(json|ya?ml|xml))/;

/** Null for a run the floor lacks, a hash the run never referenced, and a blob the floor no longer holds. */
export async function runBlob(
  floor: BlobFloor,
  runId: string,
  hash: string,
): Promise<RunBlob | null> {
  if (!(await runReferences(floor, runId, hash))) {
    return null;
  }
  const stored = await floor.blobs.get(hash);

  return stored && blobView(hash, stored);
}

/** What the run was started with, what each visit was handed, and what each reported producing. */
async function runReferences(
  floor: BlobFloor,
  runId: string,
  hash: string,
): Promise<boolean> {
  const found = await floor.runs.get(runId);

  if (!found) {
    return false;
  }
  const visits = await floor.stationRuns.list({ run: runId });
  const refs = [
    ...Object.values(found.run.startItems).map((startItem) => startItem.ref),
    ...visits.flatMap((visit) => [
      ...Object.values(visit.brief.needs),
      ...Object.values(visit.report?.produced ?? {}),
    ]),
  ];

  return refs.includes(hash);
}

function blobView(
  hash: string,
  stored: { bytes: Uint8Array; contentType: string },
): RunBlob {
  const { bytes, contentType } = stored;
  const textual = TEXTUAL_CONTENT_TYPE.test(contentType);

  return {
    hash,
    contentType,
    size: bytes.length,
    text: textual
      ? new TextDecoder().decode(bytes.subarray(0, TEXT_LIMIT_BYTES))
      : null,
    truncated: textual && bytes.length > TEXT_LIMIT_BYTES,
  };
}
