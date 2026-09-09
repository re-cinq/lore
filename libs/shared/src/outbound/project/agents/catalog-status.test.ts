import { describe, it, expect } from "vitest";
import { InMemoryCatalogStatus } from "./catalog-status-memory.js";
import { PgCatalogStatus } from "./catalog-status-pg.js";
import type { PgPool } from "../../memory-store.js";

type Row = Record<string, unknown>;

function fakePool(
  rows: Row[] = [],
  capture: Array<{ text: string; params?: unknown[] }> = [],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: rows as T[] };
    },
  };
}

describe("InMemoryCatalogStatus", () => {
  it("a later verdict replaces the earlier one, so a fixed refusal stops being reported", async () => {
    const store = new InMemoryCatalogStatus({ "c-1": "central" });

    await store.record("c-1", [
      {
        name: "implementation",
        projectId: null,
        state: "refused",
        reason: "no gemini credential",
      },
    ]);
    await store.record("c-1", [
      {
        name: "implementation",
        projectId: null,
        state: "applied",
        reason: null,
      },
    ]);

    expect(await store.list()).toMatchObject([
      {
        name: "implementation",
        state: "applied",
        reason: null,
        clusterName: "central",
      },
    ]);
  });

  it("keeps one row per cluster for the same definition, so a satellite's refusal is not hidden by central's success", async () => {
    const store = new InMemoryCatalogStatus({
      "c-1": "central",
      "c-2": "satellite",
    });

    await store.record("c-1", [
      { name: "review", projectId: null, state: "applied", reason: null },
    ]);
    await store.record("c-2", [
      {
        name: "review",
        projectId: null,
        state: "refused",
        reason: "no anthropic credential",
      },
    ]);

    expect(await store.list()).toMatchObject([
      { clusterName: "central", state: "applied" },
      {
        clusterName: "satellite",
        state: "refused",
        reason: "no anthropic credential",
      },
    ]);
  });

  it("scopes by project, so a repo override's verdict is not confused with the org default's", async () => {
    const store = new InMemoryCatalogStatus({ "c-1": "central" });

    await store.record("c-1", [
      { name: "review", projectId: null, state: "applied", reason: null },
      {
        name: "review",
        projectId: "p-1",
        state: "refused",
        reason: "bad model",
      },
    ]);

    expect((await store.list()).map((r) => [r.projectId, r.state])).toEqual([
      [null, "applied"],
      ["p-1", "refused"],
    ]);
  });
});

describe("PgCatalogStatus", () => {
  it("writes the whole batch in one UNNEST statement rather than a round trip per entry", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgCatalogStatus(fakePool([], capture));

    await store.record("c-1", [
      { name: "a", projectId: null, state: "applied", reason: null },
      { name: "b", projectId: "p-1", state: "refused", reason: "why" },
    ]);

    expect(capture).toHaveLength(1);
    expect(capture[0].text).toContain("UNNEST");
    expect(capture[0].params).toEqual([
      "c-1",
      ["a", "b"],
      [null, "p-1"],
      ["applied", "refused"],
      [null, "why"],
    ]);
  });

  it("upserts on the COALESCEd identity so an org-default row cannot duplicate itself", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgCatalogStatus(fakePool([], capture));

    await store.record("c-1", [
      { name: "a", projectId: null, state: "applied", reason: null },
    ]);

    expect(capture[0].text).toContain("ON CONFLICT");
    expect(capture[0].text).toContain("COALESCE(project_id");
    expect(capture[0].text).toContain("DO UPDATE SET");
  });

  it("writes nothing at all for an empty batch", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];

    await new PgCatalogStatus(fakePool([], capture)).record("c-1", []);

    expect(capture).toEqual([]);
  });

  it("joins the cluster name onto each verdict so the read needs no second lookup", async () => {
    const store = new PgCatalogStatus(
      fakePool([
        {
          cluster_agent_id: "c-1",
          cluster_name: "central",
          name: "review",
          project_id: null,
          state: "refused",
          reason: "no anthropic credential",
          updated_at: new Date("2026-09-01T20:00:00Z"),
        },
      ]),
    );

    expect(await store.list()).toEqual([
      {
        clusterAgentId: "c-1",
        clusterName: "central",
        name: "review",
        projectId: null,
        state: "refused",
        reason: "no anthropic credential",
        updatedAt: new Date("2026-09-01T20:00:00Z"),
      },
    ]);
  });
});
