import { describe, it, expect } from "vitest";
import { InMemoryChunks } from "@re-cinq/lore-shared/project/chunks/chunks-memory.js";
import { healStaleChunkerFiles } from "./reindex.js";

const REPO = "octo/repo";
const SCHEMA = "platform";

function codeRow(id: string, filePath: string, chunkerVersion?: number) {
  return {
    id,
    schema: SCHEMA,
    content: "code",
    contentType: "code",
    team: SCHEMA,
    repo: REPO,
    filePath,
    metadata:
      chunkerVersion === undefined
        ? { ingested_by: "reindex-job" }
        : { ingested_by: "reindex-job", chunker_version: chunkerVersion },
    embedding: null,
    ingestedAt: new Date().toISOString(),
  };
}

describe("healStaleChunkerFiles", () => {
  it("re-ingests code files chunked by an older chunker and skips current ones", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));

    chunks.rows.push(
      codeRow("1", "src/stale.test.ts"),
      codeRow("2", "src/older.ts", 1),
      codeRow("3", "src/current.ts", 2),
    );
    const ingested: string[] = [];

    const healed = await healStaleChunkerFiles(
      chunks,
      SCHEMA,
      REPO,
      new Set(),
      async (filePath) => ingested.push(filePath),
    );

    expect(healed).toBe(2);
    expect(ingested).toEqual(["src/older.ts", "src/stale.test.ts"]);
  });

  it("skips files the changed-file loop already re-ingested this run", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));

    chunks.rows.push(codeRow("1", "src/stale.test.ts"));
    const ingested: string[] = [];

    const healed = await healStaleChunkerFiles(
      chunks,
      SCHEMA,
      REPO,
      new Set(["src/stale.test.ts"]),
      async (filePath) => ingested.push(filePath),
    );

    expect(healed).toBe(0);
    expect(ingested).toEqual([]);
  });

  it("logs and continues past a per-file ingest failure", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));

    chunks.rows.push(
      codeRow("1", "src/bad.ts", 1),
      codeRow("2", "src/ok.ts", 1),
    );

    const healed = await healStaleChunkerFiles(
      chunks,
      SCHEMA,
      REPO,
      new Set(),
      (filePath) =>
        filePath === "src/bad.ts"
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(),
    );

    expect(healed).toBe(1);
  });
});
