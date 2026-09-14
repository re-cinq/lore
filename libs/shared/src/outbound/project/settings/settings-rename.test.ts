import { describe, it, expect } from "vitest";
import { InMemorySettings } from "./settings-memory.js";
import { PgSettings } from "./settings-pg.js";
import type { MemoryTxClient, PgPool } from "../../memory-store.js";

const OLD_ID = "5f0ffc55-0000-4000-8000-000000000001";
const NEW_ID = "5f0ffc55-0000-4000-8000-000000000002";

interface CapturedQuery {
  text: string;
  params?: unknown[];
}

function transactionalPool(
  capture: CapturedQuery[],
  repoRows: Array<{ id: string; full_name: string }>,
  failOn?: string,
): PgPool & { connect(): Promise<MemoryTxClient> } {
  const query = async <T>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }> => {
    capture.push({ text, params });

    if (failOn && text.includes(failOn)) {
      return Promise.reject(new Error(`${failOn} failed`));
    }

    return {
      rows: (text.includes("SELECT id, full_name") ? repoRows : []) as T[],
    };
  };

  return { query, connect: async () => ({ query, release: () => undefined }) };
}

describe("InMemorySettings.renameRepo", () => {
  it("renames re-cinq/HAL-engine to re-cinq/HALEngine in place when only the old row exists", async () => {
    const port = new InMemorySettings([
      { id: OLD_ID, full_name: "re-cinq/HAL-engine", team: "hal" },
    ]);

    expect(
      await port.renameRepo("re-cinq/HAL-engine", "re-cinq/HALEngine"),
    ).toBe("renamed");
    expect(await port.record("re-cinq/HALEngine")).toMatchObject({
      id: OLD_ID,
      owner: "re-cinq",
      name: "HALEngine",
      fullName: "re-cinq/HALEngine",
      team: "hal",
    });
    expect(await port.allRepos()).toEqual(["re-cinq/HALEngine"]);
  });

  it("merges re-cinq/HAL-engine into re-cinq/HALEngine, moving its reviewer definition and dropping its conflicting implementation definition", async () => {
    const port = new InMemorySettings([
      {
        id: OLD_ID,
        full_name: "re-cinq/HAL-engine",
        agent_definitions: ["implementation", "reviewer"],
      },
      {
        id: NEW_ID,
        full_name: "re-cinq/HALEngine",
        agent_definitions: ["implementation"],
      },
    ]);

    expect(
      await port.renameRepo("re-cinq/HAL-engine", "re-cinq/HALEngine"),
    ).toBe("merged");
    expect(port.repos).toEqual([
      {
        id: NEW_ID,
        full_name: "re-cinq/HALEngine",
        agent_definitions: ["implementation", "reviewer"],
      },
    ]);
  });

  it("returns absent and keeps re-cinq/lore when re-cinq/HAL-engine has no row", async () => {
    const port = new InMemorySettings([{ full_name: "re-cinq/lore" }]);

    expect(
      await port.renameRepo("re-cinq/HAL-engine", "re-cinq/HALEngine"),
    ).toBe("absent");
    expect(await port.allRepos()).toEqual(["re-cinq/lore"]);
  });
});

describe("PgSettings.renameRepo", () => {
  it("updates owner, name and full_name of re-cinq/HAL-engine's row inside one transaction when re-cinq/HALEngine has none", async () => {
    const capture: CapturedQuery[] = [];
    const store = new PgSettings(
      transactionalPool(capture, [
        { id: OLD_ID, full_name: "re-cinq/HAL-engine" },
      ]),
    );

    expect(
      await store.renameRepo("re-cinq/HAL-engine", "re-cinq/HALEngine"),
    ).toBe("renamed");
    expect(capture).toMatchObject([
      { text: "BEGIN" },
      { params: [["re-cinq/HAL-engine", "re-cinq/HALEngine"]] },
      {
        text: expect.stringContaining("UPDATE lore.repos"),
        params: [OLD_ID, "re-cinq", "HALEngine", "re-cinq/HALEngine"],
      },
      { text: "COMMIT" },
    ]);
  });

  it("moves non-conflicting agent definitions to re-cinq/HALEngine's id and deletes re-cinq/HAL-engine's row inside one transaction when both rows exist", async () => {
    const capture: CapturedQuery[] = [];
    const store = new PgSettings(
      transactionalPool(capture, [
        { id: OLD_ID, full_name: "re-cinq/HAL-engine" },
        { id: NEW_ID, full_name: "re-cinq/HALEngine" },
      ]),
    );

    expect(
      await store.renameRepo("re-cinq/HAL-engine", "re-cinq/HALEngine"),
    ).toBe("merged");
    expect(capture).toMatchObject([
      { text: "BEGIN" },
      { params: [["re-cinq/HAL-engine", "re-cinq/HALEngine"]] },
      {
        text: expect.stringContaining("UPDATE lore.agent_definitions"),
        params: [OLD_ID, NEW_ID],
      },
      {
        text: expect.stringContaining("DELETE FROM lore.repos"),
        params: [OLD_ID],
      },
      { text: "COMMIT" },
    ]);
  });

  it("returns absent without writing when re-cinq/HAL-engine has no row", async () => {
    const capture: CapturedQuery[] = [];
    const store = new PgSettings(
      transactionalPool(capture, [
        { id: NEW_ID, full_name: "re-cinq/HALEngine" },
      ]),
    );

    expect(
      await store.renameRepo("re-cinq/HAL-engine", "re-cinq/HALEngine"),
    ).toBe("absent");
    expect(capture.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT id, full_name"),
      "COMMIT",
    ]);
  });

  it("rolls back and rethrows when deleting re-cinq/HAL-engine's row fails", async () => {
    const capture: CapturedQuery[] = [];
    const store = new PgSettings(
      transactionalPool(
        capture,
        [
          { id: OLD_ID, full_name: "re-cinq/HAL-engine" },
          { id: NEW_ID, full_name: "re-cinq/HALEngine" },
        ],
        "DELETE FROM lore.repos",
      ),
    );

    await expect(
      store.renameRepo("re-cinq/HAL-engine", "re-cinq/HALEngine"),
    ).rejects.toThrow(new Error("DELETE FROM lore.repos failed"));
    expect(capture.at(-1)?.text).toBe("ROLLBACK");
  });
});
