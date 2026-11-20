// Binds the mirror sync tick to the ports this process holds (composition root).
import { syncMirror } from "../../outbound/mirror-sync.js";
import { settings } from "../../outbound/queues.js";
import { mirrorSyncTick } from "./mirror-sync-tick.js";

export function runMirrorSyncTick(): Promise<string> {
  return mirrorSyncTick({
    repoSettings: () => settings().onboardedRepoSettings(),
    sync: syncMirror,
  });
}
