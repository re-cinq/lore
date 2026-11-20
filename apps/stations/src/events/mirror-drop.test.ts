import { describe, expect, it } from "vitest";
import type {
  EventHandler,
  EventRow,
} from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { handleOne } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { addHandlers } from "./compose-handlers.js";
import { buildStationHandlers } from "./handlers.js";
import { withMirrorDrop, withMirrorDropStations } from "./mirror-drop.js";

const PRIVATE_REPO = "acme/private-app";
const MIRROR_REPO = "acme/public-app";
const UNRELATED_REPO = "acme/plain-app";

function settingsWithMirror(): InMemorySettings {
  return new InMemorySettings([
    { full_name: PRIVATE_REPO, settings: { public_mirror: MIRROR_REPO } },
    { full_name: UNRELATED_REPO, settings: {} },
  ]);
}

const ownerOf = (repo: string) => settingsWithMirror().mirrorOwner(repo);

function recordingHandler(reposSeen: string[]): EventHandler {
  return async (params) => {
    reposSeen.push(String(params.repo));
  };
}

async function reposReaching(
  eventName: string,
  paramsFor: (repo: string) => Record<string, unknown>,
): Promise<string[]> {
  const reposSeen: string[] = [];
  const handlers = withMirrorDrop(
    new Map([[eventName, recordingHandler(reposSeen)]]),
    ownerOf,
    () => undefined,
  );
  const handler = handlers.get(eventName)!;

  for (const repo of [MIRROR_REPO, PRIVATE_REPO, UNRELATED_REPO]) {
    await handler(paramsFor(repo));
  }

  return reposSeen;
}

describe("withMirrorDrop", () => {
  it("dispatches github.pull_request.opened for the private and the unmirrored repo and not for the mirror", async () => {
    expect(
      await reposReaching("github.pull_request.opened", (repo) => ({
        repo,
        pr_number: 7,
      })),
    ).toEqual([PRIVATE_REPO, UNRELATED_REPO]);
  });

  it("dispatches github.push for the private and the unmirrored repo and not for the mirror", async () => {
    expect(
      await reposReaching("github.push", (repo) => ({ repo, branch: "main" })),
    ).toEqual([PRIVATE_REPO, UNRELATED_REPO]);
  });

  it("dispatches github.issues.labeled for the private and the unmirrored repo and not for the mirror", async () => {
    expect(
      await reposReaching("github.issues.labeled", (repo) => ({
        repo,
        label: "priority:high",
        issue: { number: 3, labels: [] },
      })),
    ).toEqual([PRIVATE_REPO, UNRELATED_REPO]);
  });

  it("dispatches github.issue_comment.created with @lore review for the private and the unmirrored repo and not for the mirror", async () => {
    expect(
      await reposReaching("github.issue_comment.created", (repo) => ({
        repo,
        pr_number: 7,
        body: "@lore review",
      })),
    ).toEqual([PRIVATE_REPO, UNRELATED_REPO]);
  });

  it("dispatches github.release.changed for the private and the unmirrored repo and not for the mirror", async () => {
    expect(
      await reposReaching("github.release.changed", (repo) => ({ repo })),
    ).toEqual([PRIVATE_REPO, UNRELATED_REPO]);
  });

  it("dispatches github.tracker.changed for the private and the unmirrored repo and not for the mirror", async () => {
    expect(
      await reposReaching("github.tracker.changed", (repo) => ({ repo })),
    ).toEqual([PRIVATE_REPO, UNRELATED_REPO]);
  });

  it("dispatches cron.implementation_loop.tick naming the private and the unmirrored repo and not the mirror", async () => {
    expect(
      await reposReaching("cron.implementation_loop.tick", (repo) => ({
        repo,
      })),
    ).toEqual([PRIVATE_REPO, UNRELATED_REPO]);
  });

  it("drops an event naming the mirror in another letter case", async () => {
    expect(
      await reposReaching("github.push", () => ({
        repo: "ACME/Public-App",
        branch: "main",
      })),
    ).toEqual([]);
  });

  it("dispatches github.repository.renamed for the mirror", async () => {
    const reposSeen: string[] = [];
    const handlers = withMirrorDrop(
      new Map([
        [
          "github.repository.renamed",
          async (params) => {
            reposSeen.push(`${String(params.from)}>${String(params.to)}`);
          },
        ],
      ]),
      ownerOf,
      () => undefined,
    );

    await handlers.get("github.repository.renamed")!({
      from: MIRROR_REPO,
      to: "acme/public-app-renamed",
      repo: MIRROR_REPO,
    });

    expect(reposSeen).toEqual([`${MIRROR_REPO}>acme/public-app-renamed`]);
  });

  it("dispatches cron.pr_ready_check.tick naming no repo", async () => {
    const reposSeen: string[] = [];
    const handlers = withMirrorDrop(
      new Map([["cron.pr_ready_check.tick", recordingHandler(reposSeen)]]),
      ownerOf,
      () => undefined,
    );

    await handlers.get("cron.pr_ready_check.tick")!({});

    expect(reposSeen).toEqual(["undefined"]);
  });

  it("dispatches every event for every repo when no repo names a mirror", async () => {
    const reposSeen: string[] = [];
    const noMirrors = new InMemorySettings([
      { full_name: PRIVATE_REPO, settings: {} },
      { full_name: MIRROR_REPO },
    ]);
    const handlers = withMirrorDrop(
      new Map([
        ["github.push", recordingHandler(reposSeen)],
        ["github.pull_request.opened", recordingHandler(reposSeen)],
      ]),
      (repo) => noMirrors.mirrorOwner(repo),
      () => undefined,
    );

    await handlers.get("github.push")!({ repo: PRIVATE_REPO });
    await handlers.get("github.push")!({ repo: MIRROR_REPO });
    await handlers.get("github.pull_request.opened")!({ repo: PRIVATE_REPO });
    await handlers.get("github.pull_request.opened")!({ repo: MIRROR_REPO });

    expect([...handlers.keys(), ...reposSeen]).toEqual([
      "github.push",
      "github.pull_request.opened",
      PRIVATE_REPO,
      MIRROR_REPO,
      PRIVATE_REPO,
      MIRROR_REPO,
    ]);
  });

  it("logs one line naming github.push, the mirror and its private repo when it drops the event", async () => {
    const lines: string[] = [];
    const handlers = withMirrorDrop(
      new Map([["github.push", recordingHandler([])]]),
      ownerOf,
      (line) => lines.push(line),
    );

    await handlers.get("github.push")!({ repo: MIRROR_REPO, branch: "main" });

    expect(lines).toEqual([
      `[stations] dropped github.push for ${MIRROR_REPO}: the public mirror of ${PRIVATE_REPO}`,
    ]);
  });

  it("marks a dropped delivery done and neither failed nor dead-lettered", async () => {
    const transitions: string[] = [];
    const handlers = withMirrorDrop(
      new Map([["github.push", recordingHandler([])]]),
      ownerOf,
      () => undefined,
    );
    const delivery: EventRow = {
      id: "delivery-1",
      event_id: "event-1",
      subscriber: "stations",
      event_name: "github.push",
      source: "github",
      params: { repo: MIRROR_REPO, branch: "main" },
      repo: MIRROR_REPO,
      status: "claimed",
      attempts: 0,
      error: null,
      claimed_at: null,
      next_attempt_at: "2026-11-20T00:00:00Z",
      handled_at: null,
      visibility_timeout_seconds: 600,
    };

    await handleOne(delivery, {
      resolve: (name) => handlers.get(name),
      claim: async () => [],
      markDone: async (id) => void transitions.push(`done:${id}`),
      markFailed: async (id) => void transitions.push(`failed:${id}`),
      markDead: async (id) => void transitions.push(`dead:${id}`),
    });

    expect(transitions).toEqual(["done:delivery-1"]);
  });

  it("rejects github.push when the mirror lookup fails, so the bus retries it", async () => {
    const handlers = withMirrorDrop(
      new Map([["github.push", recordingHandler([])]]),
      async () => {
        throw new Error("database unreachable");
      },
      () => undefined,
    );

    await expect(
      handlers.get("github.push")!({ repo: PRIVATE_REPO, branch: "main" }),
    ).rejects.toThrow(new Error("database unreachable"));
  });

  it("drops an event for the mirror from a handler added through addHandlers after the others", async () => {
    const reposSeen: string[] = [];
    const registry = new Map<string, EventHandler>();

    addHandlers(
      registry,
      new Map([["cron.late_sweep.tick", recordingHandler(reposSeen)]]),
    );
    const handlers = withMirrorDrop(registry, ownerOf, () => undefined);

    await handlers.get("cron.late_sweep.tick")!({ repo: MIRROR_REPO });
    await handlers.get("cron.late_sweep.tick")!({ repo: PRIVATE_REPO });

    expect(reposSeen).toEqual([PRIVATE_REPO]);
  });
});

describe("buildStationHandlers", () => {
  it("answers cron.pr_ready_check.tick naming the mirror without running the sweep", async () => {
    const handlers = buildStationHandlers(ownerOf);

    await expect(
      handlers.get("cron.pr_ready_check.tick")!({ repo: MIRROR_REPO }),
    ).resolves.toBeUndefined();
  });

  it("answers github.pull_request.opened naming the mirror without refreshing any loop run", async () => {
    const handlers = buildStationHandlers(ownerOf);

    await expect(
      handlers.get("github.pull_request.opened")!({
        repo: MIRROR_REPO,
        pr_number: 7,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("withMirrorDropStations", () => {
  it("runs the station for the private repo and reports a drop for the mirror", async () => {
    const reposSeen: string[] = [];
    const stations = withMirrorDropStations(
      new Map([
        [
          "loop-tick",
          async (params) => {
            reposSeen.push(String(params.repo));

            return "ran";
          },
        ],
      ]),
      ownerOf,
      () => undefined,
    );
    const station = stations.get("loop-tick")!;

    expect({
      mirror: await station({ repo: MIRROR_REPO }),
      private: await station({ repo: PRIVATE_REPO }),
      reposSeen,
    }).toEqual({
      mirror: `dropped: ${MIRROR_REPO} is the public mirror of ${PRIVATE_REPO}`,
      private: "ran",
      reposSeen: [PRIVATE_REPO],
    });
  });
});
