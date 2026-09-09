import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { detectSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
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
    const assemblyRuns = new InMemoryAssemblyRuns();
    const listed: number[] = [];
    const { started, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-drift", {
      assemblyRuns,
      jobRuns,
      jobRef: async () => "spec_drift",
      listTargetRepos: async () => {
        listed.push(1);

        return ["re-cinq/lore", "re-cinq/other"];
      },
    });

    await handler({});

    expect(listed).toHaveLength(1);
    expect(started).toEqual([
      "spec_drift:re-cinq/lore",
      "spec_drift:re-cinq/other",
    ]);
    expect(
      assemblyRuns.rows.map((r) => ({
        blueprintName: r.blueprintName,
        repo: r.repo,
        branch: r.branch,
        args: r.args,
      })),
    ).toEqual([
      {
        blueprintName: "spec-drift",
        repo: "re-cinq/lore",
        branch: "detect/spec-drift/re-cinq/lore",
        args: { job_run_id: "jr-1" },
      },
      {
        blueprintName: "spec-drift",
        repo: "re-cinq/other",
        branch: "detect/spec-drift/re-cinq/other",
        args: { job_run_id: "jr-2" },
      },
    ]);
  });

  it("params.repo restricts the fan-out to that repo without enumerating", async () => {
    const assemblyRuns = new InMemoryAssemblyRuns();
    const { jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("gap-detect", {
      assemblyRuns,
      jobRuns,
      jobRef: async () => "gap_detection",
      listTargetRepos: async () => {
        throw new Error("must not enumerate on a single-repo tick");
      },
    });

    await handler({ repo: "re-cinq/lore" });

    expect(assemblyRuns.rows).toEqual([
      expect.objectContaining({
        blueprintName: "gap-detect",
        repo: "re-cinq/lore",
        branch: "detect/gap-detect/re-cinq/lore",
      }),
    ]);
  });

  it("no target repos starts nothing", async () => {
    const assemblyRuns = new InMemoryAssemblyRuns();
    const { started, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-coverage-validate", {
      assemblyRuns,
      jobRuns,
      jobRef: async () => "spec_coverage_validate",
      listTargetRepos: async () => [],
    });

    await handler({});

    expect(assemblyRuns.rows).toEqual([]);
    expect(started).toEqual([]);
  });

  it("starts nothing and mints no job_run for a repo already being detected", async () => {
    const { started, jobRuns } = fakeJobRuns();
    const assemblyRuns = new InMemoryAssemblyRuns();

    await assemblyRuns.start({
      blueprintName: "spec-drift",
      repo: "re-cinq/lore",
      subjectKey: detectSubject("spec-drift", "re-cinq/lore"),
    });

    const handler = createDetectTickHandler("spec-drift", {
      assemblyRuns,
      jobRuns,
      jobRef: async () => "spec_drift",
      listTargetRepos: async () => ["re-cinq/lore"],
    });

    await handler({});

    expect(assemblyRuns.rows).toHaveLength(1);
    expect(started).toEqual([]);
  });

  it("closes its own job_run when a racing tick already started the run", async () => {
    const { failed, jobRuns } = fakeJobRuns();
    const assemblyRuns = new InMemoryAssemblyRuns();

    const winner = await assemblyRuns.start({
      blueprintName: "spec-drift",
      repo: "re-cinq/lore",
      subjectKey: detectSubject("spec-drift", "re-cinq/lore"),
      args: { job_run_id: "jr-winner" },
    });
    const handler = createDetectTickHandler("spec-drift", {
      assemblyRuns: {
        findOpenBySubject: async () => null,
        start: (input: Parameters<InMemoryAssemblyRuns["start"]>[0]) =>
          assemblyRuns.start(input),
        getById: (id: string) => assemblyRuns.getById(id),
      } as never,
      jobRuns,
      jobRef: async () => "spec_drift",
      listTargetRepos: async () => ["re-cinq/lore"],
    });

    await handler({});

    expect(assemblyRuns.rows).toHaveLength(1);
    expect(assemblyRuns.rows[0].id).toBe(winner);
    expect(failed).toEqual([
      { runId: "jr-1", reason: expect.stringContaining("already running") },
    ]);
  });

  it("fails the just-created job_run when assemblyRuns.start throws before rethrowing", async () => {
    const { started, failed, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-drift", {
      assemblyRuns: {
        findOpenBySubject: async () => null,
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
