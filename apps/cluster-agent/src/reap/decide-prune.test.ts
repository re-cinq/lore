import { describe, it, expect } from "vitest";
import {
  decidePrune,
  type PrunableAgent,
  type PrunableRecipe,
} from "./decide-prune.js";

const NOW = new Date("2026-08-30T12:00:00Z");
const HOUR = 3_600_000;
const TTL = 72 * HOUR;

const agent = (
  name: string,
  agedHours: number,
  phase: string | undefined,
  stationRef = `pt-${name}`,
): PrunableAgent => ({
  name,
  phase,
  createdAt: new Date(NOW.getTime() - agedHours * HOUR),
  stationRef,
});

const recipe = (name: string, agedHours: number): PrunableRecipe => ({
  name,
  createdAt: new Date(NOW.getTime() - agedHours * HOUR),
});

const prune = (input: {
  agents?: PrunableAgent[];
  stations?: PrunableRecipe[];
  definitions?: PrunableRecipe[];
  maxPerTick?: number;
}) =>
  decidePrune({
    agents: input.agents ?? [],
    stations: input.stations ?? [],
    definitions: input.definitions ?? [],
    now: NOW,
    ttlMs: TTL,
    maxPerTick: input.maxPerTick ?? 50,
  });

describe("decidePrune — which Agent CRs go", () => {
  it("deletes a terminal CR older than the retention window", () => {
    expect(prune({ agents: [agent("old", 96, "Succeeded")] }).agents).toEqual([
      "old",
    ]);
  });

  it("keeps a terminal CR inside the window, which is the forensic record", () => {
    expect(prune({ agents: [agent("recent", 12, "Failed")] }).agents).toEqual(
      [],
    );
  });

  it("never deletes a CR that has not gone terminal, however old", () => {
    expect(
      prune({ agents: [agent("running", 500, "Running")] }).agents,
    ).toEqual([]);
    expect(
      prune({ agents: [agent("unstamped", 500, undefined)] }).agents,
    ).toEqual([]);
  });

  it("bounds one tick, so a first sweep over a backlog does not storm the apiserver", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      agent(`a${i}`, 96, "Succeeded"),
    );

    expect(prune({ agents: many, maxPerTick: 50 }).agents).toHaveLength(50);
  });
});

describe("decidePrune — which per-task clones go", () => {
  it("deletes a pt-* clone once no surviving CR references it", () => {
    const result = prune({
      agents: [agent("gone", 96, "Succeeded", "pt-task-1")],
      stations: [recipe("pt-task-1", 96)],
      definitions: [recipe("pt-task-1", 96)],
    });

    expect(result).toMatchObject({
      agents: ["gone"],
      stations: ["pt-task-1"],
      definitions: ["pt-task-1"],
    });
  });

  it("keeps a clone a surviving CR still references", () => {
    const result = prune({
      agents: [
        agent("old", 96, "Succeeded", "pt-shared"),
        agent("young", 1, "Running", "pt-shared"),
      ],
      stations: [recipe("pt-shared", 96)],
      definitions: [recipe("pt-shared", 96)],
    });

    expect(result).toMatchObject({
      agents: ["old"],
      stations: [],
      definitions: [],
    });
  });

  it("never touches a builtin def-* recipe, whatever its age", () => {
    const result = prune({
      stations: [
        recipe("def-validate", 900),
        recipe("implementation-tdd", 900),
      ],
      definitions: [recipe("def-validate", 900)],
    });

    expect(result).toMatchObject({ stations: [], definitions: [] });
  });

  it("keeps a young orphan clone, so a task mid-dispatch does not lose its recipe", () => {
    const result = prune({
      stations: [recipe("pt-just-made", 1)],
      definitions: [recipe("pt-just-made", 1)],
    });

    expect(result).toMatchObject({ stations: [], definitions: [] });
  });

  it("reports nothing to do for an empty cluster", () => {
    expect(prune({})).toEqual({ agents: [], stations: [], definitions: [] });
  });
});
