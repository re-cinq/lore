import { errorMessage } from "@re-cinq/lore-shared";
import {
  deniedError,
  unconfiguredError,
  textResult,
  proxyGetApi,
  type ProxyResult,
} from "../../shared/deps.js";

// The CI reads: what GitHub Actions said about a branch, and one job's log. Served in agent mode too, so a pod repairing a red build reads the verdict instead of reproducing the build — run 997026f5 rebuilt its whole workspace to learn one lint error, and died at 1Gi doing it.

/** One GET through the API, pretty-printed; a read with no local fallback, so the server's own reason is surfaced plainly rather than the write-oriented "unreachable" copy. */
export async function readThroughApi(
  toolName: string,
  path: string,
  what: string,
) {
  try {
    const proxied = await proxyGetApi(path);

    return proxied.ok
      ? textResult(JSON.stringify(JSON.parse(proxied.body), null, 2))
      : readRefusal(toolName, what, proxied);
  } catch (err) {
    return textResult(`Error reading ${what}: ${errorMessage(err)}`);
  }
}

function readRefusal(
  toolName: string,
  what: string,
  proxied: Exclude<ProxyResult, { ok: true }>,
) {
  if (proxied.reason === "not_configured") {
    return unconfiguredError(`reading ${what}`);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return textResult(
    `Could not read ${what} from the Lore API: ${proxied.detail}`,
  );
}
