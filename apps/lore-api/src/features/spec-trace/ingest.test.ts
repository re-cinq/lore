import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";
import { classifyFile } from "@re-cinq/lore-shared";

vi.mock("../../platform/github-client.js", () => ({
  getOctokit: vi.fn(),
  isAppConfigured: vi.fn(),
}));
vi.mock("@re-cinq/lore-server-core/platform/db.js", () => ({
  getQueryEmbedding: vi.fn(),
}));

import { getOctokit, isAppConfigured } from "../../platform/github-client.js";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import { ingestFiles } from "./ingest.js";

describe("classifyFile", () => {
  it("classifies CLAUDE.md as doc", () => {
    expect(classifyFile("CLAUDE.md")).toBe("doc");
  });

  it("classifies nested CLAUDE.md as doc", () => {
    expect(classifyFile("teams/platform/CLAUDE.md")).toBe("doc");
  });

  it("classifies ADRs", () => {
    expect(classifyFile("adrs/ADR-001.md")).toBe("adr");
  });

  it("classifies specs", () => {
    expect(classifyFile("specs/my-feature/spec.md")).toBe("spec");
    expect(classifyFile(".specify/spec.md")).toBe("spec");
  });

  it("classifies code files", () => {
    expect(classifyFile("src/index.ts")).toBe("code");
    expect(classifyFile("main.go")).toBe("code");
    expect(classifyFile("lib/auth.py")).toBe("code");
  });

  it("classifies source files under a nested specs/ dir as code, not spec", () => {
    expect(classifyFile("web-ui/src/app/specs/page.tsx")).toBe("code");
    expect(
      classifyFile("web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.tsx"),
    ).toBe("code");
  });

  it("skips binary files", () => {
    expect(classifyFile("logo.png")).toBeNull();
    expect(classifyFile("package-lock.json")).toBeNull();
    expect(classifyFile("fonts/Inter.woff2")).toBeNull();
  });

  it("skips unknown file types", () => {
    expect(classifyFile("Dockerfile")).toBeNull();
    expect(classifyFile(".env")).toBeNull();
  });
});

describe("IngestFile type handling", () => {
  it("distinguishes path strings from content objects", () => {
    const pathFile = "CLAUDE.md";
    const contentFile = { path: "CLAUDE.md", content: "# Lore" };

    expect(typeof pathFile === "string").toBe(true);
    expect(typeof contentFile === "string").toBe(false);
    expect(typeof contentFile !== "string" && contentFile.content).toBeTruthy();
  });

  it("extracts path from both formats", () => {
    const pathFile = "CLAUDE.md";
    const contentFile = { path: "README.md", content: "# Hello" };

    const getPath = (f: string | { path: string; content: string }) =>
      typeof f === "string" ? f : f.path;

    expect(getPath(pathFile)).toBe("CLAUDE.md");
    expect(getPath(contentFile)).toBe("README.md");
  });
});

describe("commit SHA fallback", () => {
  it("should use HEAD when commit is from a different repo", () => {
    const localRepo: string = "re-cinq/lore";
    const targetRepo: string = "re-cinq/website-cf";
    const localHead = "abc1234";

    const commit = localRepo === targetRepo ? localHead : "HEAD";

    expect(commit).toBe("HEAD");
  });

  it("should use specific commit when repos match", () => {
    const localRepo: string = "re-cinq/lore";
    const targetRepo: string = "re-cinq/lore";
    const localHead = "abc1234";

    const commit = localRepo === targetRepo ? localHead : "HEAD";

    expect(commit).toBe("abc1234");
  });

  it("should retry refs in order: specific commit, then HEAD", () => {
    const commit: string = "abc1234";
    const refs = commit !== "HEAD" ? [commit, "HEAD"] : ["HEAD"];

    expect(refs).toEqual(["abc1234", "HEAD"]);
  });

  it("should not duplicate HEAD in retry list", () => {
    const commit: string = "HEAD";
    const refs = commit !== "HEAD" ? [commit, "HEAD"] : ["HEAD"];

    expect(refs).toEqual(["HEAD"]);
  });
});

type Row = Record<string, unknown>;

function fakePool() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT team FROM lore.repos")) {
      return { rows: [] as Row[] };
    }

    if (sql.includes("information_schema.schemata")) {
      return { rows: [] as Row[] };
    }

    if (sql.startsWith("INSERT INTO")) {
      return { rows: [{ id: "chunk-1" }] as Row[] };
    }

    return { rows: [] as Row[] };
  });

  return { pool: { query } as unknown as Pool, query };
}

function queuedOctokit(steps: Array<() => unknown>) {
  let call = 0;
  const getContent = vi.fn(async () => {
    const step = steps[call++];

    return step();
  });

  return { rest: { repos: { getContent } } };
}

const fileEntry = (content: string) => ({
  type: "file",
  content: Buffer.from(content).toString("base64"),
});
const notFoundErr = () => {
  const err = new Error("not found") as Error & { status?: number };

  err.status = 404;

  return err;
};
const serverErr = () => {
  const err = new Error("boom") as Error & { status?: number };

  err.status = 500;

  return err;
};

describe("ingestFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAppConfigured).mockReturnValue(true);
    vi.mocked(getQueryEmbedding).mockResolvedValue(null);
  });

  it("ingests a file resolved at the given commit without retrying HEAD", async () => {
    const octokit = queuedOctokit([
      () => ({ data: fileEntry("const a = 1;") }),
    ]);

    vi.mocked(getOctokit).mockResolvedValue(
      octokit as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const { pool } = fakePool();
    const result = await ingestFiles(pool, ["src/a.ts"], "o/r", "abc1234");

    expect(result.results).toEqual([
      {
        file: "src/a.ts",
        status: "ingested",
        chunk_id: "chunk-1",
        embedded: false,
      },
    ]);
    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(1);
  });

  it("falls back to HEAD when the commit is unknown to the repo", async () => {
    const octokit = queuedOctokit([
      () => {
        throw notFoundErr();
      },
      () => ({ data: fileEntry("const a = 1;") }),
    ]);

    vi.mocked(getOctokit).mockResolvedValue(
      octokit as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const { pool } = fakePool();
    const result = await ingestFiles(pool, ["src/a.ts"], "o/r", "deadbeef");

    expect(result.results).toEqual([
      {
        file: "src/a.ts",
        status: "ingested",
        chunk_id: "chunk-1",
        embedded: false,
      },
    ]);
    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(2);
    expect(octokit.rest.repos.getContent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ref: "HEAD" }),
    );
  });

  it("marks a file deleted (no HEAD retry) when the commit is already HEAD and the file 404s", async () => {
    const octokit = queuedOctokit([
      () => {
        throw notFoundErr();
      },
    ]);

    vi.mocked(getOctokit).mockResolvedValue(
      octokit as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const { pool, query } = fakePool();
    const result = await ingestFiles(pool, ["src/gone.ts"], "o/r", "HEAD");

    expect(result.results).toEqual([
      { file: "src/gone.ts", status: "deleted" },
    ]);
    expect(result.deleted).toBe(1);
    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(1);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM")),
    ).toBe(true);
  });

  it("skips a not-a-file result (directory) without deleting or throwing", async () => {
    const octokit = queuedOctokit([() => ({ data: { type: "dir" } })]);

    vi.mocked(getOctokit).mockResolvedValue(
      octokit as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const { pool } = fakePool();
    const result = await ingestFiles(pool, ["src/adir"], "o/r", "abc1234");

    expect(result.results).toEqual([
      {
        file: "src/adir",
        status: "skipped",
        error: "not a file (directory?)",
      },
    ]);
  });

  it("skips an unsupported file type without a GitHub call for inline content", async () => {
    const { pool } = fakePool();
    const result = await ingestFiles(
      pool,
      [{ path: "logo.png", content: "binarydata" }],
      "o/r",
      "abc1234",
    );

    expect(result.results).toEqual([
      { file: "logo.png", status: "skipped", error: "unsupported file type" },
    ]);
    expect(getOctokit).not.toHaveBeenCalled();
  });

  it("records an error result (not a thrown error) for a non-404 GitHub failure", async () => {
    const octokit = queuedOctokit([
      () => {
        throw serverErr();
      },
    ]);

    vi.mocked(getOctokit).mockResolvedValue(
      octokit as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const { pool } = fakePool();
    const result = await ingestFiles(pool, ["src/broken.ts"], "o/r", "abc1234");

    expect(result.results).toEqual([
      { file: "src/broken.ts", status: "error", error: "boom" },
    ]);
    expect(result.errors).toBe(1);
  });

  it("tallies ingested, deleted, and error counts across a mixed batch", async () => {
    const octokit = queuedOctokit([
      () => ({ data: fileEntry("const a = 1;") }),
      () => {
        throw notFoundErr();
      },
      () => {
        throw serverErr();
      },
    ]);

    vi.mocked(getOctokit).mockResolvedValue(
      octokit as unknown as Awaited<ReturnType<typeof getOctokit>>,
    );

    const { pool } = fakePool();
    const result = await ingestFiles(
      pool,
      ["src/a.ts", "src/gone.ts", "src/broken.ts"],
      "o/r",
      "HEAD",
    );

    expect(result.ingested).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(1);
  });
});
