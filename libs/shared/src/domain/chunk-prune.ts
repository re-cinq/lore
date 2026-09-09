import type { ContentType } from "./content-classify.js";

/** Which indexed paths no longer belong in a repo's chunk store: those the tree at HEAD no longer has (a rename's old path, a deleted file) and those today's classifier refuses (a generated file indexed before the exclusion existed). The sweep that used to catch both retired with the nightly reindex (#1880). */
export function planChunkPrune(
  indexedPaths: string[],
  presentPaths: string[],
  classify: (path: string) => ContentType | null,
): string[] {
  const present = new Set(presentPaths);

  return indexedPaths.filter(
    (path) => !present.has(path) || classify(path) === null,
  );
}
