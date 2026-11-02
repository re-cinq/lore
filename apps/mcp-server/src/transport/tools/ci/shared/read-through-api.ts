import { errorMessage } from "@re-cinq/lore-shared";
import { textResult, proxyGetApi } from "../../shared/deps.js";
import { renderProxied } from "../../shared/render-proxied.js";

// The CI reads: what GitHub Actions said about a branch, and one job's log. Served in agent mode too, so a pod repairing a red build reads the verdict instead of reproducing the build — run 997026f5 rebuilt its whole workspace to learn one lint error, and died at 1Gi doing it.

/** One GET through the API, pretty-printed, or the reason it could not be read. */
export async function readThroughApi(
  toolName: string,
  path: string,
  what: string,
) {
  try {
    return renderProxied(await proxyGetApi(path), {
      op: `reading ${what}`,
      subject: what,
      toolName,
    });
  } catch (err) {
    return textResult(`Error reading ${what}: ${errorMessage(err)}`);
  }
}
