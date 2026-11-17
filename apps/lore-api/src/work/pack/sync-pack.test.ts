import { describe, expect, it } from "vitest";
import { syncPack } from "./sync-pack.js";
import {
  EXTENDED_REVIEWER,
  EXTENSION,
  fakeLeases,
  fakePack,
  SHIPPED_REVIEWER,
} from "./pack-fakes.fixtures.js";

describe("syncPack", () => {
  it("applies the pack under the pack-sync lease and releases it", async () => {
    const pack = fakePack();
    const leases = fakeLeases();

    pack.files = [EXTENSION];
    pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);

    const result = await syncPack(pack.deps(), leases, "replica-a");

    expect({
      result,
      reviewer: pack.floorAgents.get("reviewer"),
      held: [...leases.held],
    }).toEqual({
      result: {
        status: "applied",
        commit: "c0ffee1",
        changed: ["agent/reviewer"],
      },
      reviewer: EXTENDED_REVIEWER,
      held: [],
    });
  });

  it("skips when another replica holds the lease and leaves its lease alone", async () => {
    const pack = fakePack();
    const leases = fakeLeases();

    pack.files = [EXTENSION];
    pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);
    await leases.acquire("pack-sync", null, "replica-b");

    const result = await syncPack(pack.deps(), leases, "replica-a");

    expect({
      result,
      reviewer: pack.floorAgents.get("reviewer"),
      held: [...leases.held],
    }).toEqual({
      result: { skipped: "lease held" },
      reviewer: SHIPPED_REVIEWER,
      held: [["pack-sync", "replica-b"]],
    });
  });

  it("releases the lease when the apply itself throws", async () => {
    const pack = fakePack();
    const leases = fakeLeases();
    const deps = {
      ...pack.deps(),
      readSync: async () => {
        throw new Error("settings are down");
      },
    };

    await expect(syncPack(deps, leases, "replica-a")).rejects.toThrow(
      new Error("settings are down"),
    );
    expect([...leases.held]).toEqual([]);
  });
});
