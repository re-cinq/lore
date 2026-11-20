// A push to a public mirror's default branch brings its commits back to the private repository at once (specs/public-mirror); a push to any other branch of the mirror is dropped like its other events.
import type { MirrorSyncResult } from "@re-cinq/lore-shared/release/mirror-sync.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { syncMirror } from "../outbound/mirror-sync.js";
import {
  withMirrorDrop,
  type MirrorOwnerOf,
  type MirrorPushHandler,
} from "./mirror-drop.js";

export interface MirrorPushSyncDeps {
  defaultBranch(mirror: string): Promise<string>;
  sync(repo: string): Promise<MirrorSyncResult>;
}

export function mirrorPushSync(
  deps: MirrorPushSyncDeps,
  log: (line: string) => void = console.log,
): MirrorPushHandler {
  return async ({ owner, mirror, branch }) => {
    if (branch !== (await deps.defaultBranch(mirror))) {
      log(
        `[stations] dropped github.push to ${branch} of ${mirror}: not its default branch`,
      );

      return;
    }
    const { decision } = await deps.sync(owner);

    log(`[stations] push to ${mirror} synced ${owner}: ${decision}`);
  };
}

/** `withMirrorDrop` with the push of a mirror's default branch wired to the sync of its private repository. */
export function withProductionMirrorDrop(
  handlers: Map<string, EventHandler>,
  ownerOf: MirrorOwnerOf,
): Map<string, EventHandler> {
  const onMirrorPush = mirrorPushSync({
    defaultBranch: (mirror) =>
      new PlatformGitHub(process.env).getDefaultBranch(mirror),
    sync: syncMirror,
  });

  return withMirrorDrop(handlers, ownerOf, console.log, onMirrorPush);
}
