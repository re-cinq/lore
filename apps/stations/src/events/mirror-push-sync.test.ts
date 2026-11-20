import { describe, expect, it } from "vitest";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { MirrorSyncResult } from "@re-cinq/lore-shared/release/mirror-sync.js";
import { withMirrorDrop } from "./mirror-drop.js";
import { mirrorPushSync } from "./mirror-push-sync.js";

const PRIVATE_REPO = "acme/private-app";
const MIRROR_REPO = "acme/public-app";

const settings = new InMemorySettings([
  { full_name: PRIVATE_REPO, settings: { public_mirror: MIRROR_REPO } },
]);

function drain() {
  const synced: string[] = [];
  const dispatched: string[] = [];
  const lines: string[] = [];
  const recording: EventHandler = async (params) => {
    dispatched.push(String(params.repo));
  };
  const onMirrorPush = mirrorPushSync(
    {
      defaultBranch: async () => "main",
      sync: async (repo): Promise<MirrorSyncResult> => {
        synced.push(repo);

        return { decision: "open-pr" };
      },
    },
    (line) => lines.push(line),
  );
  const handlers = withMirrorDrop(
    new Map([
      ["github.push", recording],
      ["github.pull_request.opened", recording],
      ["github.issues.labeled", recording],
    ]),
    (repo) => settings.mirrorOwner(repo),
    () => undefined,
    onMirrorPush,
  );

  return { handlers, synced, dispatched, lines };
}

describe("a push to a public mirror", () => {
  it("syncs acme/private-app for a github.push to main of the mirror and dispatches nothing", async () => {
    const { handlers, synced, dispatched } = drain();

    await handlers.get("github.push")!({ repo: MIRROR_REPO, branch: "main" });

    expect({ synced, dispatched }).toEqual({
      synced: [PRIVATE_REPO],
      dispatched: [],
    });
  });

  it("syncs nothing for a github.push to the branch feature of the mirror", async () => {
    const { handlers, synced, dispatched, lines } = drain();

    await handlers.get("github.push")!({
      repo: MIRROR_REPO,
      branch: "feature",
    });

    expect({ synced, dispatched, lines }).toEqual({
      synced: [],
      dispatched: [],
      lines: [
        "[stations] dropped github.push to feature of acme/public-app: not its default branch",
      ],
    });
  });

  it("reaches no handler for github.pull_request.opened and github.issues.labeled of the mirror", async () => {
    const { handlers, synced, dispatched } = drain();

    await handlers.get("github.pull_request.opened")!({
      repo: MIRROR_REPO,
      pr_number: 7,
    });
    await handlers.get("github.issues.labeled")!({
      repo: MIRROR_REPO,
      label: "priority:high",
    });

    expect({ synced, dispatched }).toEqual({ synced: [], dispatched: [] });
  });

  it("dispatches github.push, github.pull_request.opened and github.issues.labeled of the private repo as before and syncs nothing", async () => {
    const { handlers, synced, dispatched } = drain();

    await handlers.get("github.push")!({ repo: PRIVATE_REPO, branch: "main" });
    await handlers.get("github.pull_request.opened")!({
      repo: PRIVATE_REPO,
      pr_number: 7,
    });
    await handlers.get("github.issues.labeled")!({ repo: PRIVATE_REPO });

    expect({ synced, dispatched }).toEqual({
      synced: [],
      dispatched: [PRIVATE_REPO, PRIVATE_REPO, PRIVATE_REPO],
    });
  });

  it("rejects when the sync fails, so the bus retries the push", async () => {
    const handlers = withMirrorDrop(
      new Map([["github.push", async () => undefined]]),
      (repo) => settings.mirrorOwner(repo),
      () => undefined,
      mirrorPushSync({
        defaultBranch: async () => "main",
        sync: async () => {
          throw new Error("github down");
        },
      }),
    );

    await expect(
      handlers.get("github.push")!({ repo: MIRROR_REPO, branch: "main" }),
    ).rejects.toThrow(new Error("github down"));
  });
});
