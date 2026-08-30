import { describe, it, expect } from "vitest";
import { KubePruner } from "./kube-pruner.js";
import { pruneOnce } from "../reap/prune-loop.js";

const HOUR = 3_600_000;
const NOW = new Date("2026-08-30T12:00:00Z");
const old = new Date(NOW.getTime() - 96 * HOUR).toISOString();

/** The two CustomObjectsApi calls the pruner makes, recorded. */
function fakeApi() {
  const deleted: Array<{ plural: string; name: string }> = [];
  const api = {
    listNamespacedCustomObject: async ({ plural }: { plural: string }) => ({
      items:
        plural === "agents"
          ? [
              {
                metadata: { name: "a1", creationTimestamp: old },
                spec: { stationRef: "pt-1" },
                status: { phase: "Succeeded" },
              },
            ]
          : [{ metadata: { name: "pt-1", creationTimestamp: old } }],
    }),
    deleteNamespacedCustomObject: async ({
      plural,
      name,
    }: {
      plural: string;
      name: string;
    }) => {
      deleted.push({ plural, name });
    },
  };

  return { api, deleted };
}

describe("KubePruner driven by the real sweep", () => {
  it("deletes through the live adapter without losing `this`", async () => {
    // The sweep passes the port's methods to a helper. Handing over
    // `cluster.deleteAgent` UNBOUND drops the receiver, so the first call
    // inside KubePruner (`this.remove(...)`) throws — and `pruneOnce` swallows
    // every throw into an outcome, so the loop would log "could not delete" for
    // every object, forever, while the cache it exists to bound kept growing.
    // The in-memory doubles cannot catch this: their methods are closures.
    const { api, deleted } = fakeApi();
    const outcome = await pruneOnce({
      cluster: new KubePruner(() => api as never),
      ttlMs: 72 * HOUR,
      now: () => NOW,
      log: () => {},
    });

    expect(outcome).toEqual({
      kind: "swept",
      agents: 1,
      stations: 1,
      definitions: 1,
    });
    expect(deleted).toEqual([
      { plural: "agents", name: "a1" },
      { plural: "stations", name: "pt-1" },
      { plural: "agentdefinitions", name: "pt-1" },
    ]);
  });

  it("reads an object the apiserver reports without a creation stamp as brand new", async () => {
    // Defaulting the other way would delete whatever the parse failed to
    // understand.
    const api = {
      listNamespacedCustomObject: async ({ plural }: { plural: string }) => ({
        items:
          plural === "agents"
            ? [{ metadata: { name: "undated" }, status: { phase: "Failed" } }]
            : [],
      }),
      deleteNamespacedCustomObject: async () => {
        throw new Error("nothing should be deleted");
      },
    };

    expect(
      await pruneOnce({
        cluster: new KubePruner(() => api as never),
        ttlMs: 72 * HOUR,
        now: () => NOW,
      }),
    ).toEqual({ kind: "nothing" });
  });
});
