import { describe, expect, it } from "vitest";
import {
  PACK_PUSH_EVENTS,
  packPushHandlers,
  type PackPushDeps,
} from "./pack-push-handlers.js";

const PACK = { repo: "acme/lore-pack", ref: "main" };

function scene(config: PackPushDeps["config"]) {
  const syncs: string[] = [];
  const handler = packPushHandlers({
    config,
    sync: async () => {
      syncs.push("sync");

      return "pack a1b2c3d applied: triager";
    },
  }).get("github.push");

  return {
    syncs,
    push: (params: Record<string, unknown>) => handler?.(params),
  };
}

describe("packPushHandlers", () => {
  it("subscribes to github.push", () => {
    expect(PACK_PUSH_EVENTS).toEqual(["github.push"]);
  });

  it("syncs when acme/lore-pack's main is pushed", async () => {
    const { syncs, push } = scene(PACK);

    await push({ repo: "acme/lore-pack", branch: "main" });

    expect(syncs).toEqual(["sync"]);
  });

  it("reads the repo name regardless of case", async () => {
    const { syncs, push } = scene(PACK);

    await push({ repo: "Acme/Lore-Pack", branch: "main" });

    expect(syncs).toEqual(["sync"]);
  });

  it("does not sync a push to another branch of the pack repo", async () => {
    const { syncs, push } = scene(PACK);

    await push({ repo: "acme/lore-pack", branch: "wip" });

    expect(syncs).toEqual([]);
  });

  it("does not sync a push to another repo", async () => {
    const { syncs, push } = scene(PACK);

    await push({ repo: "acme/app", branch: "main" });

    expect(syncs).toEqual([]);
  });

  it("syncs a push to any branch when the pack names no ref, since the default branch is lore-api's to read", async () => {
    const { syncs, push } = scene({ repo: "acme/lore-pack", ref: undefined });

    await push({ repo: "acme/lore-pack", branch: "trunk" });

    expect(syncs).toEqual(["sync"]);
  });

  it("syncs nothing on a deployment with no pack repo", async () => {
    const { syncs, push } = scene(null);

    await push({ repo: "acme/lore-pack", branch: "main" });

    expect(syncs).toEqual([]);
  });
});
