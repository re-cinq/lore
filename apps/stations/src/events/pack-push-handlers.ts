// A push to the client's pack repo applies the pack at once; the tick (work/pack-sync-tick) catches a push whose webhook never arrived. lore-api holds the lease, so every replica may post.
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";

export const PACK_PUSH_EVENTS: readonly string[] = ["github.push"];

export interface PackPushDeps {
  /** The pack repo this deployment reads; null while LORE_PACK_REPO is unset. */
  config: { repo: string; ref: string | undefined } | null;
  /** Posts to lore-api's `POST /api/pack/sync` and answers what it said, in one line. */
  sync(): Promise<string>;
}

export function packPushHandlers(
  deps: PackPushDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([["github.push", onPush(deps)]]);
}

function onPush(deps: PackPushDeps): EventHandler {
  return async (params) => {
    const { repo, branch } = params as { repo?: string; branch?: string };
    const { config } = deps;

    if (!config || !isPackPush(config, repo, branch)) {
      return;
    }

    console.log(
      `[stations] push to pack ${repo} ${branch}: ${await deps.sync()}`,
    );
  };
}

/** An unset ref is the repository's default branch, which only lore-api can read: any branch's push syncs, and a sync of an unchanged head changes nothing. */
function isPackPush(
  config: { repo: string; ref: string | undefined },
  repo: string | undefined,
  branch: string | undefined,
): boolean {
  return (
    repo?.toLowerCase() === config.repo.toLowerCase() &&
    (config.ref === undefined || config.ref === branch)
  );
}
