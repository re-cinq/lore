// The composition root of the public mirror's sync: GitHub reads and the pull request writes, the git clone and the installation tokens.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { GitMirrorPush } from "@re-cinq/lore-shared/project/workspace/mirror-push-git.js";
import {
  syncMirrorMain,
  type MirrorSyncDeps,
  type MirrorSyncResult,
} from "@re-cinq/lore-shared/release/mirror-sync.js";
import { settings } from "./queues.js";
import { serialByKey } from "./serial-by-key.js";

/** One bare clone per private repository, apart from the one a release push uses, so the two never fetch into the same cache. */
export function mirrorSyncCacheDir(repo: string): string {
  return join(tmpdir(), "lore-mirror-sync", repo.replace("/", "__"));
}

export function mirrorSyncDeps(): MirrorSyncDeps {
  const github = new PlatformGitHub(process.env);

  return {
    settings: settings(),
    pulls: github,
    defaultBranch: (repo) => github.getDefaultBranch(repo),
    mintToken: (repo, permissions) =>
      github.getInstallationToken(repo, permissions),
    mirrorPush: (repo) =>
      new GitMirrorPush(mirrorSyncCacheDir(repo), process.env),
  };
}

const inOrder = serialByKey();

/** The one way this process syncs a repository's public main: the release station, the tick and a push to the mirror queue behind each other. */
export function syncMirror(repo: string): Promise<MirrorSyncResult> {
  return inOrder(repo, () => syncMirrorMain(mirrorSyncDeps(), repo));
}
