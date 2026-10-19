import { errorMessage } from "@re-cinq/lore-shared";
import { recordUtopiaMirrorFailure } from "@re-cinq/lore-shared/otel/metrics.js";

/** A mirror that fails is logged and counted and never fails the ingest: the graph is the source the checks read, the mirror is a copy. */
export async function mirrorQuietly(
  repo: string,
  path: string,
  mirror: () => Promise<void>,
): Promise<void> {
  try {
    await mirror();
  } catch (error) {
    console.error(`[utopia-mirror] ${repo} ${path}: ${errorMessage(error)}`);
    recordUtopiaMirrorFailure(repo);
  }
}
