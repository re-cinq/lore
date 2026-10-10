// The previews of the files one card lists (run-viz FR4.4m), read once per new set of hashes; an answer for an older set is dropped, and the rows stay with the set they were read for.
import { useEffect, useState } from "react";
import { readBlobPreviews, type BlobPreview } from "@/lib/blob-previews";
import { itemValueOf } from "@/lib/item-value";

type Previews = Record<string, BlobPreview>;

interface ShownPreviews {
  key: string;
  previews: Previews;
}

const NONE: Previews = {};

export function useBlobPreviews(
  runId: string,
  refs: readonly string[],
): Previews {
  const key = refs
    .filter((ref) => itemValueOf(ref, runId).kind === "blob")
    .join(",");
  const [shown, setShown] = useState<ShownPreviews | null>(null);

  useEffect(() => readPreviewsFor(runId, key, setShown), [runId, key]);

  return shown && shown.key === key ? shown.previews : NONE;
}

/** Reads the previews for one set of hashes; the returned cleanup cancels it, so an answer for an older set never lands. */
function readPreviewsFor(
  runId: string,
  key: string,
  setShown: (shown: ShownPreviews) => void,
): (() => void) | undefined {
  if (key === "") {
    return undefined;
  }
  const read = new AbortController();

  readBlobPreviews(runId, key.split(","), read.signal)
    .then((previews) => {
      if (!read.signal.aborted) {
        setShown({ key, previews });
      }
    })
    .catch(() => {});

  return () => read.abort();
}
