import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import {
  activeSpecRepos,
  chunkSchemas,
  createDetectTickHandler,
  detectBranchName,
  specRepos,
  specReposSql,
} from "./fan-out.js";

function fakeJobRuns() {
  const started: string[] = [];
  const failed: Array<{ runId: string; reason: string }> = [];

  return {
    started,
    failed,
    jobRuns: {
      start: async (jobName: string) => {
        started.push(jobName);

        return `jr-${started.length}`;
      },
      fail: async (runId: string, reason: string) => {
        failed.push({ runId, reason });
      },
    },
  };
}

describe("detectBranchName", () => {
  it("keys the run on definition + repo (the old lease key, now the overlap-guard key)", () => {
    expect(detectBranchName("spec-drift", "re-cinq/lore")).toBe(
      "detect/spec-drift/re-cinq/lore",
    );
  });
});

describe("createDetectTickHandler", () => {
  it("starts one spec-drift assembly line per target repo with branch, job_ref run and job_run_id", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const listed: number[] = [];
    const { started, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-drift", {
      assemblyLines,
      jobRuns,
      jobRef: async () => "spec_drift",
      listTargetRepos: async () => {
        listed.push(1);

        return ["re-cinq/lore", "re-cinq/other"];
      },
    });

    await handler({});

    expect(listed).toHaveLength(1);
    // The job_run is pre-created here (the walk closes it via args.job_run_id)
    // and the branch reproduces the old lease key for the overlap guard.
    expect(started).toEqual([
      "spec_drift:re-cinq/lore",
      "spec_drift:re-cinq/other",
    ]);
    expect(
      assemblyLines.rows.map((r) => ({
        definitionName: r.definitionName,
        repo: r.repo,
        branch: r.branch,
        args: r.args,
      })),
    ).toEqual([
      {
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
        branch: "detect/spec-drift/re-cinq/lore",
        args: { job_run_id: "jr-1" },
      },
      {
        definitionName: "spec-drift",
        repo: "re-cinq/other",
        branch: "detect/spec-drift/re-cinq/other",
        args: { job_run_id: "jr-2" },
      },
    ]);
  });

  it("params.repo restricts the fan-out to that repo without enumerating", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const { jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("gap-detect", {
      assemblyLines,
      jobRuns,
      jobRef: async () => "gap_detection",
      listTargetRepos: async () => {
        throw new Error("must not enumerate on a single-repo tick");
      },
    });

    await handler({ repo: "re-cinq/lore" });

    expect(assemblyLines.rows).toEqual([
      expect.objectContaining({
        definitionName: "gap-detect",
        repo: "re-cinq/lore",
        branch: "detect/gap-detect/re-cinq/lore",
      }),
    ]);
  });

  it("no target repos starts nothing", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const { started, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-coverage-validate", {
      assemblyLines,
      jobRuns,
      jobRef: async () => "spec_coverage_validate",
      listTargetRepos: async () => [],
    });

    await handler({});

    expect(assemblyLines.rows).toEqual([]);
    expect(started).toEqual([]);
  });

  it("fails the just-created job_run when assemblyLines.start throws before rethrowing", async () => {
    const { started, failed, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-drift", {
      assemblyLines: {
        start: async () => {
          throw new Error("db down");
        },
      } as never,
      jobRuns,
      jobRef: async () => "spec_drift",
      listTargetRepos: async () => ["re-cinq/lore"],
    });

    await expect(handler({})).rejects.toThrow("db down");
    expect(started).toEqual(["spec_drift:re-cinq/lore"]);
    // the orphaned job_run is failed, not left running forever.
    expect(failed).toEqual([
      { runId: "jr-1", reason: expect.stringContaining("db down") },
    ]);
  });
});

function fakeQuery(byCall: unknown[][]) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let call = 0;
  const q = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
    calls.push({ text, params });

    return (byCall[call++] ?? []) as T[];
  };

  return { calls, q };
}

describe("chunkSchemas", () => {
  it("always includes org_shared alongside the provisioned team schemas", async () => {
    const { calls, q } = fakeQuery([
      [{ table_schema: "platform" }, { table_schema: "data" }],
    ]);

    expect(await chunkSchemas(q)).toEqual(["org_shared", "platform", "data"]);
    expect(calls[0]?.text).toContain("information_schema.tables");
    expect(calls[0]?.text).toContain("table_name = 'chunks'");
    expect(calls[0]?.text).toContain("SELECT team FROM lore.repos");
  });

  it("drops team names that fail the schema-name gate", async () => {
    const { q } = fakeQuery([
      [
        { table_schema: "platform" },
        { table_schema: "bad; DROP TABLE lore.repos" },
        { table_schema: "Upper" },
      ],
    ]);

    expect(await chunkSchemas(q)).toEqual(["org_shared", "platform"]);
  });
});

describe("specReposSql", () => {
  it("unions the chunks table of every given schema", () => {
    const sql = specReposSql(["org_shared", "platform"], { activeOnly: false });

    expect(sql).toContain("FROM org_shared.chunks");
    expect(sql).toContain("FROM platform.chunks");
    expect(sql).toContain("UNION ALL");
  });

  it("activeOnly gates each repo on a code chunk inside the activity window", () => {
    const sql = specReposSql(["org_shared"], { activeOnly: true });

    expect(sql).toContain("content_type IN ('spec', 'code')");
    expect(sql).toContain("HAVING bool_or(content_type = 'spec')");
    expect(sql).toContain(
      "bool_or(content_type = 'code' AND ingested_at > now() - ($1 || ' days')::interval)",
    );
  });

  it("without activeOnly scans spec chunks only and takes no parameters", () => {
    const sql = specReposSql(["org_shared", "platform"], { activeOnly: false });

    expect(sql).toContain("content_type = 'spec'");
    expect(sql).not.toContain("'code'");
    expect(sql).not.toContain("$1");
  });
});

describe("activeSpecRepos", () => {
  it("returns a team-schema repo with no org_shared rows and passes the 7-day window", async () => {
    const { calls, q } = fakeQuery([
      [{ table_schema: "platform" }],
      [{ repo: "re-cinq/app" }],
    ]);

    expect(await activeSpecRepos(q)).toEqual(["re-cinq/app"]);
    expect(calls[1]?.text).toContain("FROM platform.chunks");
    expect(calls[1]?.text).toContain("FROM org_shared.chunks");
    expect(calls[1]?.params).toEqual(["7"]);
  });
});

describe("specRepos", () => {
  it("issues one union over all chunk schemas grouped by repo", async () => {
    const { calls, q } = fakeQuery([
      [{ table_schema: "platform" }],
      [{ repo: "re-cinq/lore" }],
    ]);

    expect(await specRepos(q)).toEqual(["re-cinq/lore"]);
    expect(calls[1]?.text).toContain("FROM platform.chunks");
    expect(calls[1]?.text).toContain("FROM org_shared.chunks");
    expect(calls[1]?.text).toContain("GROUP BY repo");
    expect(calls[1]?.params).toBeUndefined();
  });
});
