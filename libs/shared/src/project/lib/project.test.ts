import { describe, it, expect } from "vitest";
import { createProject } from "./project-factory.js";
import { Project } from "./project.js";
import type { PgPool, DgraphClientPort } from "../../memory-store.js";

/**
 * Project wiring — built from a fullName + the two DB connections, createProject
 * initializes its own ports (adapters dynamically imported). We drive it with a
 * fake PgPool (the memory-store fake-pool style) and a fake Dgraph client; no
 * live database.
 */

function fakePool(
  capture: Array<{ text: string; params?: unknown[] }>,
  rows: unknown[] = [],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: rows as T[] as T[] };
    },
  };
}

const noDgraph = {} as DgraphClientPort;

describe("Project wiring", () => {
  it("builds the tasks port from the pg connection and queries bound to the repo", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const project = await createProject(
      "re-cinq/lore",
      fakePool(capture),
      noDgraph,
      {},
    );

    await project.tasks.pendingTasks();

    expect(capture[0].params).toEqual([
      "re-cinq/lore",
      ["pending", "queued", "awaiting_approval"],
    ]);
  });

  it("resolves settings through the wired pg settings port", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const project = await createProject(
      "re-cinq/lore",
      fakePool(capture, [{ settings: {} }]),
      noDgraph,
      {},
    );

    await project.settings.resolve();

    expect(capture.at(-1)?.text).toContain("SELECT settings FROM lore.repos");
  });

  it("throws a clear error when a port was not provided in the map", () => {
    const project = new Project("re-cinq/lore", new Map(), {});

    expect(() => project.tasks).toThrow(
      new Error(
        'Project port "tasks" is not wired yet (pending its live adapter)',
      ),
    );
  });

  it("starts an assembly line through the wired pg port with the repo filled in", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const project = await createProject(
      "re-cinq/lore",
      fakePool(capture, [{ id: "al-1" }]),
      noDgraph,
      {},
    );

    const assemblyLineId = await project.assemblyLines.start("implementation", {
      taskId: "task-9",
    });

    expect(assemblyLineId).toBe("al-1");
    expect(capture[0].text).toContain("INSERT INTO pipeline.assembly_runs");
    expect(capture[0].text).toContain("'assembly_line.start'");
    expect(capture[0].params).toEqual([
      "implementation",
      "task-9",
      "re-cinq/lore",
      null,
      "{}",
    ]);
  });
});
