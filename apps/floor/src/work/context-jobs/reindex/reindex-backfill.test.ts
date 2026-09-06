import { describe, it, expect } from "vitest";
import { InMemoryChunks } from "@re-cinq/lore-shared/project/chunks/chunks-memory.js";
import { backfillUningestedFiles, BACKFILL_FILES_PER_RUN } from "./reindex.js";

const REPO = "octo/repo";
const SCHEMA = "platform";

function row(id: string, filePath: string, ingestedBy = "reindex-job") {
  return {
    id,
    schema: SCHEMA,
    content: "code",
    contentType: "code",
    team: SCHEMA,
    repo: REPO,
    filePath,
    metadata: { ingested_by: ingestedBy },
    embedding: null,
    ingestedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("backfillUningestedFiles", () => {
  it("ingests supported tree files with no chunks and skips chunked or unsupported ones", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));

    chunks.rows.push(
      row("1", "src/chunked.ts"),
      row("2", "src/api-owned.ts", "api"),
    );
    const ingested: string[] = [];

    const backfilled = await backfillUningestedFiles(
      chunks,
      { schema: SCHEMA, repo: REPO },
      {
        treePaths: [
          "src/never.test.ts",
          "src/chunked.ts",
          "src/api-owned.ts",
          "assets/logo.png",
          "graveyard/dead.ts",
          "src/also-never.ts",
        ],
        alreadyProcessed: new Set(),
      },
      async (filePath) => {
        ingested.push(filePath);

        return true;
      },
    );

    expect(backfilled).toBe(2);
    expect(ingested).toEqual(["src/also-never.ts", "src/never.test.ts"]);
  });

  it("skips files the changed-file loop already processed this run", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));
    const ingested: string[] = [];

    const backfilled = await backfillUningestedFiles(
      chunks,
      { schema: SCHEMA, repo: REPO },
      {
        treePaths: ["src/just-ingested.ts"],
        alreadyProcessed: new Set(["src/just-ingested.ts"]),
      },
      async (filePath) => {
        ingested.push(filePath);

        return true;
      },
    );

    expect(backfilled).toBe(0);
    expect(ingested).toEqual([]);
  });

  it("caps one run at BACKFILL_FILES_PER_RUN files in sorted order", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));
    const tree = Array.from(
      { length: BACKFILL_FILES_PER_RUN + 1 },
      (_, i) => `src/${String(i).padStart(3, "0")}.ts`,
    );
    const ingested: string[] = [];

    const backfilled = await backfillUningestedFiles(
      chunks,
      { schema: SCHEMA, repo: REPO },
      {
        treePaths: [...tree].reverse(),
        alreadyProcessed: new Set(),
      },
      async (filePath) => {
        ingested.push(filePath);

        return true;
      },
    );

    expect(backfilled).toBe(BACKFILL_FILES_PER_RUN);
    expect(ingested).toEqual(tree.slice(0, BACKFILL_FILES_PER_RUN));
  });

  it("logs and continues past a per-file ingest failure", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));

    const backfilled = await backfillUningestedFiles(
      chunks,
      { schema: SCHEMA, repo: REPO },
      {
        treePaths: ["src/bad.ts", "src/ok.ts"],
        alreadyProcessed: new Set(),
      },
      (filePath) =>
        filePath === "src/bad.ts"
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(true),
    );

    expect(backfilled).toBe(1);
  });

  it("does not count a file the ingest declines", async () => {
    const chunks = new InMemoryChunks([], new Set([SCHEMA]));

    const backfilled = await backfillUningestedFiles(
      chunks,
      { schema: SCHEMA, repo: REPO },
      {
        treePaths: ["src/declined.ts"],
        alreadyProcessed: new Set(),
      },
      async () => false,
    );

    expect(backfilled).toBe(0);
  });
});
