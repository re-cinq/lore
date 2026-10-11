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
// What the run page shows in place, inside a card: past it the value is a link to the blob's own page.
const PREVIEW_LIMIT_BYTES = 4096;
const TEXTUAL_CONTENT_TYPE = /^(text\/|application\/(json|ya?ml|xml))/;
const UNTYPED = "application/octet-stream";

type StoredBlob = { bytes: Uint8Array; contentType: string };

/** Null for a run the floor lacks, a hash the run never referenced, and a blob the floor no longer holds. */
export async function runBlob(
  floor: BlobFloor,
  runId: string,
  hash: string,
): Promise<RunBlob | null> {
  const referenced = await referencedHashes(floor, runId);

  if (!referenced?.has(hash)) {
    return null;
  }
  const stored = await floor.blobs.get(hash);

  return stored && blobView(hash, stored, TEXT_LIMIT_BYTES);
}

/** The first 4 KiB of each hash the run references, by hash; a hash it does not reference, or the floor no longer holds, is left out. Null for a run the floor lacks. */
export async function blobPreviews(
  floor: BlobFloor,
  runId: string,
  hashes: readonly string[],
): Promise<Record<string, RunBlob> | null> {
  const referenced = await referencedHashes(floor, runId);

  if (!referenced) {
    return null;
  }
  const read = await Promise.all(
    [...new Set(hashes)]
      .filter((hash) => referenced.has(hash))
      .map(async (hash) => [hash, await floor.blobs.get(hash)] as const),
  );

  return Object.fromEntries(
    read.flatMap(([hash, stored]) =>
      stored ? [[hash, blobView(hash, stored, PREVIEW_LIMIT_BYTES)]] : [],
    ),
  );
}

/** What the run was started with, what each visit was handed, and what each reported producing. Null for a run the floor lacks. */
async function referencedHashes(
  floor: BlobFloor,
  runId: string,
): Promise<Set<string> | null> {
  const found = await floor.runs.get(runId);

  if (!found) {
    return null;
  }
  const visits = await floor.stationRuns.list({ run: runId });

  return new Set([
    ...Object.values(found.run.startItems).map((startItem) => startItem.ref),
    ...visits.flatMap((visit) => [
      ...Object.values(visit.brief.needs),
      ...Object.values(visit.report?.produced ?? {}),
    ]),
  ]);
}

function blobView(hash: string, stored: StoredBlob, limit: number): RunBlob {
  const { bytes, contentType } = stored;
  const cut = bytes.length > limit;
  const text = textOf(stored, limit);

  return {
    hash,
    contentType,
    size: bytes.length,
    text,
    truncated: text !== null && cut,
  };
}

// A floor station stores the files it produces with no type, so the floor files them as octet-stream; bytes that read as UTF-8 and hold no NUL are text all the same. Only a cut head may end mid-character.
function textOf(
  { bytes, contentType }: StoredBlob,
  limit: number,
): string | null {
  const head = bytes.subarray(0, limit);
  const stream = bytes.length > limit;

  if (TEXTUAL_CONTENT_TYPE.test(contentType)) {
    return new TextDecoder().decode(head, { stream });
  }

  return contentType === UNTYPED && !head.includes(0)
    ? strictUtf8(head, { stream })
    : null;
}

function strictUtf8(
  head: Uint8Array,
  options: TextDecodeOptions,
): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(head, options);
  } catch {
    return null;
  }
}
