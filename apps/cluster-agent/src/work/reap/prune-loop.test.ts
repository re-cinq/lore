import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  pruneIntervalMs,
  pruneOnce,
  pruneTtlMs,
  runPruneLoop,
  type PruneCluster,
  type PruneOutcome,
} from "./prune-loop.js";
import type { PrunableAgent, PrunableRecipe } from "./decide-prune.js";

const NOW = new Date("2026-08-30T12:00:00Z");
const HOUR = 3_600_000;

function cluster(seed: {
  agents?: PrunableAgent[];
  stations?: PrunableRecipe[];
  definitions?: PrunableRecipe[];
  failOn?: string;
}) {
  const deleted: string[] = [];
  const remove = async (name: string): Promise<void> => {
    enforceTrue(name !== seed.failOn, Error, "finalizer wedged");
    deleted.push(name);
  };
  const api: PruneCluster = {
    listAgents: async () => seed.agents ?? [],
    listStations: async () => seed.stations ?? [],
    listDefinitions: async () => seed.definitions ?? [],
    deleteAgent: remove,
    deleteStation: remove,
    deleteDefinition: remove,
  };

  return { api, deleted };
}

const old = (name: string, stationRef?: string): PrunableAgent => ({
  name,
  phase: "Succeeded",
  createdAt: new Date(NOW.getTime() - 96 * HOUR),
  ...(stationRef ? { stationRef } : {}),
});

describe("pruneOnce", () => {
  it("deletes what the plan names and reports the counts", async () => {
    const { api, deleted } = cluster({
      agents: [old("a1", "pt-1")],
      stations: [
        { name: "pt-1", createdAt: new Date(NOW.getTime() - 96 * HOUR) },
      ],
      definitions: [
        { name: "pt-1", createdAt: new Date(NOW.getTime() - 96 * HOUR) },
      ],
    });

    expect(
      await pruneOnce({ cluster: api, ttlMs: 72 * HOUR, now: () => NOW }),
    ).toEqual({ kind: "swept", agents: 1, stations: 1, definitions: 1 });
    expect(deleted).toEqual(["a1", "pt-1", "pt-1"]);
  });

  it("reports nothing when the cluster is already tidy", async () => {
    const { api } = cluster({});

    expect(
      await pruneOnce({ cluster: api, ttlMs: 72 * HOUR, now: () => NOW }),
    ).toEqual({ kind: "nothing" });
  });

  it("skips one object it cannot delete and still sweeps the rest", async () => {
    const { api, deleted } = cluster({
      agents: [old("wedged"), old("fine")],
      failOn: "wedged",
    });
    const outcome = await pruneOnce({
      cluster: api,
      ttlMs: 72 * HOUR,
      now: () => NOW,
      log: () => {},
    });

    expect(outcome).toMatchObject({ kind: "swept", agents: 1 });
    expect(deleted).toEqual(["fine"]);
  });

  it("answers with an outcome, never a throw, when the cluster is unreachable", async () => {
    const api: PruneCluster = {
      listAgents: async () => {
        throw new Error("apiserver unreachable");
      },
      listStations: async () => [],
      listDefinitions: async () => [],
      deleteAgent: async () => {},
      deleteStation: async () => {},
      deleteDefinition: async () => {},
    };

    expect(
      await pruneOnce({ cluster: api, ttlMs: 72 * HOUR, now: () => NOW }),
    ).toMatchObject({ kind: "error", message: "apiserver unreachable" });
  });
});

describe("runPruneLoop", () => {
  it("logs a sweep and a failure, and stops when the latch closes", async () => {
    const lines: string[] = [];
    const outcomes: PruneOutcome[] = [
      { kind: "swept", agents: 3, stations: 2, definitions: 2 },
      { kind: "error", message: "apiserver unreachable" },
      { kind: "nothing" },
    ];
    let ticks = 0;

    await runPruneLoop({
      prune: async () => outcomes[ticks++] ?? { kind: "nothing" },
      sleep: async () => {},
      intervalMs: 1000,
      running: () => ticks < 3,
      log: (line) => lines.push(line),
    });

    expect(lines).toEqual([
      "[cluster-agent] pruned 3 terminal Agent CR(s), 2 station(s), 2 definition(s)",
      "[cluster-agent] prune sweep failed: apiserver unreachable",
    ]);
  });
});

describe("the schedule and the retention window", () => {
  it("sweeps hourly unless the environment says otherwise", () => {
    expect(pruneIntervalMs({})).toBe(3600 * 1000);
    expect(
      pruneIntervalMs({ LORE_CLUSTER_AGENT_PRUNE_INTERVAL_S: "120" }),
    ).toBe(120 * 1000);
  });

  it("keeps three days of evidence by default", () => {
    expect(pruneTtlMs({})).toBe(72 * HOUR);
    expect(pruneTtlMs({ LORE_CLUSTER_AGENT_CR_TTL_HOURS: "12" })).toBe(
      12 * HOUR,
    );
  });

  it("ignores a zero or unparseable retention rather than deleting everything", () => {
    expect(pruneTtlMs({ LORE_CLUSTER_AGENT_CR_TTL_HOURS: "0" })).toBe(
      72 * HOUR,
    );
    expect(pruneTtlMs({ LORE_CLUSTER_AGENT_CR_TTL_HOURS: "soon" })).toBe(
      72 * HOUR,
    );
  });
});
