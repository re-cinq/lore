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
const UNTYPED = "application/octet-stream";

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
  const head = bytes.subarray(0, TEXT_LIMIT_BYTES);
  const text = TEXTUAL_CONTENT_TYPE.test(contentType)
    ? new TextDecoder().decode(head)
    : untypedText(contentType, head);

  return {
    hash,
    contentType,
    size: bytes.length,
    text,
    truncated: text !== null && bytes.length > TEXT_LIMIT_BYTES,
  };
}

// A floor station stores the files it produces with no type, so the floor files them as octet-stream; bytes that read as UTF-8 and hold no NUL are text all the same.
function untypedText(contentType: string, head: Uint8Array): string | null {
  if (contentType !== UNTYPED || head.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(head, {
      stream: true,
    });
  } catch {
    return null;
  }
}
