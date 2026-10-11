// The first 4 KiB of the blobs a card shows, read from the browser through the session-authed proxy (run-viz FR4.4m). A blob is named by its content's hash, so what was read once is kept for the page's life and never asked for again.
import type { components } from "@/lib/api/schema";

export type BlobPreview =
  components["schemas"]["BlobPreviews"]["previews"][string];

const REQUEST_TIMEOUT_MS = 15_000;
const held = new Map<string, BlobPreview>();

/** The previews held for these hashes after asking for those not held yet; a failed read leaves them out. */
export async function readBlobPreviews(
  runId: string,
  hashes: readonly string[],
  cancel?: AbortSignal,
): Promise<Record<string, BlobPreview>> {
  const missing = [...new Set(hashes)].filter((hash) => !held.has(hash));

  if (missing.length > 0) {
    await readInto(runId, missing, cancel);
  }

  return Object.fromEntries(
    hashes.flatMap((hash) => {
      const preview = held.get(hash);

      return preview ? [[hash, preview]] : [];
    }),
  );
}

async function readInto(
  runId: string,
  hashes: readonly string[],
  cancel?: AbortSignal,
): Promise<void> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(previewsUrl(runId, hashes), {
    signal: cancel ? AbortSignal.any([cancel, timeout]) : timeout,
  });

  if (!response.ok) {
    return;
  }
  const body = (await response.json()) as Partial<
    components["schemas"]["BlobPreviews"]
  >;

  for (const [hash, preview] of Object.entries(body.previews ?? {})) {
    held.set(hash, preview);
  }
}

function previewsUrl(runId: string, hashes: readonly string[]): string {
  const query = hashes.map((hash) => `hash=${hash}`).join("&");

  return `/api/assembly-runs/${encodeURIComponent(runId)}/blob-previews?${query}`;
}
