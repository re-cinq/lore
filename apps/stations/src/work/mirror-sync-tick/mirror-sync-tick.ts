// The public mirror's sync tick (specs/public-mirror): every repository that names a mirror is synced; one that fails is logged and the others still run.
import {
  mirrorOf,
  type MirrorSyncResult,
} from "@re-cinq/lore-shared/release/mirror-sync.js";
import type { OnboardedRepoSettings } from "@re-cinq/lore-shared/project/settings/settings-port.js";

export interface MirrorSyncTickDeps {
  repoSettings(): Promise<OnboardedRepoSettings[]>;
  sync(repo: string): Promise<MirrorSyncResult>;
}

export async function mirrorSyncTick(
  deps: MirrorSyncTickDeps,
): Promise<string> {
  const mirrored = (await deps.repoSettings())
    .filter(({ settings }) => mirrorOf(settings) !== null)
    .map(({ full_name }) => full_name);
  const results = await Promise.allSettled(
    mirrored.map((repo) => deps.sync(repo)),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `[mirror-sync] ${mirrored[index]}: ${(result.reason as Error).message}`,
      );
    }
  });

  return `synced ${results.filter(({ status }) => status === "fulfilled").length} of ${mirrored.length} mirrored repo(s)`;
}
