import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, expect, it } from "vitest";
import type { MirrorSyncResult } from "@re-cinq/lore-shared/release/mirror-sync.js";
import { mirrorSyncTick } from "./mirror-sync-tick.js";

const MIRRORED = "acme/private-app";
const ALSO_MIRRORED = "acme/second-app";
const PLAIN = "acme/plain-app";

function scene(failing: string[] = []) {
  const synced: string[] = [];
  const deps = {
    repoSettings: async () => [
      { full_name: MIRRORED, settings: { public_mirror: "acme/public-app" } },
      { full_name: PLAIN, settings: {} },
      { full_name: "acme/no-settings", settings: null },
      {
        full_name: ALSO_MIRRORED,
        settings: { public_mirror: "acme/second-public" },
      },
    ],
    sync: async (repo: string): Promise<MirrorSyncResult> => {
      synced.push(repo);

      enforceTrue(!failing.includes(repo), Error, "github down");

      return { decision: "nothing" };
    },
  };

  return { deps, synced };
}

describe("the mirror sync tick", () => {
  it("syncs only the two repositories that name a public mirror", async () => {
    const { deps, synced } = scene();

    expect({ answer: await mirrorSyncTick(deps), synced }).toEqual({
      answer: "synced 2 of 2 mirrored repo(s)",
      synced: [MIRRORED, ALSO_MIRRORED],
    });
  });

  it("still syncs acme/second-app when acme/private-app fails, and counts one of two", async () => {
    const { deps, synced } = scene([MIRRORED]);

    expect({ answer: await mirrorSyncTick(deps), synced }).toEqual({
      answer: "synced 1 of 2 mirrored repo(s)",
      synced: [MIRRORED, ALSO_MIRRORED],
    });
  });

  it("syncs nothing when no repository names a mirror", async () => {
    const synced: string[] = [];
    const answer = await mirrorSyncTick({
      repoSettings: async () => [{ full_name: PLAIN, settings: {} }],
      sync: async (repo) => {
        synced.push(repo);

        return { decision: "nothing" };
      },
    });

    expect({ answer, synced }).toEqual({
      answer: "synced 0 of 0 mirrored repo(s)",
      synced: [],
    });
  });
});
