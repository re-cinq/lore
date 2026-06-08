import { describe, it, expect } from "vitest";
import { createProject } from "./project-factory.js";
import type { PgPool, DgraphClientPort } from "../../memory-store.js";

/**
 * Project wiring — built from a fullName + the two DB connections, it
 * initializes its own ports lazily. We drive it with a fake PgPool (the
 * memory-store fake-pool style) and a fake Dgraph client; no live database.
 */

function fakePool(capture: Array<{ text: string; params?: unknown[] }>, rows: unknown[] = []): PgPool {
  return {
    query: async (text: string, params?: unknown[]) => {
      capture.push({ text, params });
      return { rows };
    },
  };
}

const noDgraph = {} as DgraphClientPort;

describe("Project wiring", () => {
  it("builds the tasks port from the pg connection and queries bound to the repo", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const project = createProject("re-cinq/lore", fakePool(capture), noDgraph, {});

    await project.tasks.pendingTasks();

    expect(capture[0].params).toEqual(["re-cinq/lore", ["pending", "queued", "awaiting_approval"]]);
  });

  it("memoizes a port across accesses (one build, reused)", () => {
    const project = createProject("re-cinq/lore", fakePool([]), noDgraph, {});

    expect(project.tasks).toBeInstanceOf(Object);
    // accessing twice must not throw and must reuse the same underlying port
    expect(() => project.tasks).not.toThrow();
  });

  it("throws a clear error for a port whose adapter is not wired yet", () => {
    const project = createProject("re-cinq/lore", fakePool([]), noDgraph, {});

    expect(() => project.knowledge).toThrow(
      new Error('Project port "knowledge" is not wired yet (pending its live adapter)'),
    );
  });
});
