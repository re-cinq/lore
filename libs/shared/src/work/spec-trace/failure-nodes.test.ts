import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { upsertByXid } from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  projectFailure,
  resolveFailures,
  failuresTouching,
  pruneFailures,
} from "./failure-nodes.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

const TSC_OUTPUT =
  "src/widget.ts(12,5): error TS2345: Argument of type 'string' is not assignable";

function failure(overrides: Record<string, unknown> = {}) {
  return {
    assemblyRunId: "run-1",
    stationRunId: randomUUID(),
    nodeId: "validate",
    iteration: 1,
    failureClass: "unknown",
    failureDetail: TSC_OUTPUT,
    commit: "sha-red",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe.skipIf(!reachable)("projectFailure (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  it("projects a typecheck failure with an edge to the file its output named", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    expect(await projectFailure(client, repo, failure())).toEqual({
      projected: true,
      files: 1,
      chunks: 0,
    });
  });

  it("returns the projected failure to a query for the file it named", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const record = failure();

    await projectFailure(client, repo, record);

    expect(await failuresTouching(client, repo, "src/widget.ts")).toEqual([
      {
        stationRunId: record.stationRunId,
        nodeId: "validate",
        iteration: 1,
        failureClass: "unknown",
        failureDetail: TSC_OUTPUT,
        commit: "sha-red",
        occurredAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("projects nothing for an infra failure, which implicates no file", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    expect(
      await projectFailure(
        client,
        repo,
        failure({ failureClass: "infra", failureDetail: "pod evicted" }),
      ),
    ).toEqual({ projected: false, files: 0, chunks: 0 });
  });

  it("projects nothing for a code-class failure whose output names no file", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    expect(
      await projectFailure(
        client,
        repo,
        failure({ failureDetail: "exit status 1" }),
      ),
    ).toEqual({ projected: false, files: 0, chunks: 0 });
  });

  it("links the code chunk whose line range contains the failing line", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await upsertByXid(client, "CodeChunk", `${repo}|src/widget.ts|10`, {
      "CodeChunk.repo": repo,
      "CodeChunk.file_path": "src/widget.ts",
      "CodeChunk.start_line": 10,
      "CodeChunk.end_line": 20,
    });

    expect(await projectFailure(client, repo, failure())).toMatchObject({
      chunks: 1,
    });
  });

  it("re-projecting the same station run leaves one failure, not two", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const record = failure();

    await projectFailure(client, repo, record);
    await projectFailure(client, repo, record);

    expect(await failuresTouching(client, repo, "src/widget.ts")).toHaveLength(
      1,
    );
  });

  it("returns nothing for a file no failure ever named", async () => {
    expect(
      await failuresTouching(
        client,
        `spec-trace/${randomUUID()}`,
        "src/never.ts",
      ),
    ).toEqual([]);
  });
});

describe.skipIf(!reachable)("resolveFailures (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  it("stamps the sha of the attempt that went green onto the earlier failure", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await projectFailure(client, repo, failure());
    const stamped = await resolveFailures(
      client,
      repo,
      { assemblyRunId: "run-1", nodeId: "validate" },
      "sha-green",
    );
    const [hit] = await failuresTouching(client, repo, "src/widget.ts");

    expect({ stamped, resolvedByCommit: hit.resolvedByCommit }).toEqual({
      stamped: 1,
      resolvedByCommit: "sha-green",
    });
  });

  it("stamps nothing when the run had no failure on that node", async () => {
    expect(
      await resolveFailures(
        client,
        `spec-trace/${randomUUID()}`,
        { assemblyRunId: "run-9", nodeId: "validate" },
        "sha-green",
      ),
    ).toBe(0);
  });
});

describe.skipIf(!reachable)("pruneFailures (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  it("drops a failure older than the cutoff and keeps a newer one", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await projectFailure(client, repo, failure());
    await projectFailure(
      client,
      repo,
      failure({ occurredAt: new Date("2026-06-01T00:00:00.000Z") }),
    );

    expect({
      dropped: await pruneFailures(client, repo, new Date("2026-03-01Z")),
      left: (await failuresTouching(client, repo, "src/widget.ts")).length,
    }).toEqual({ dropped: 1, left: 1 });
  });
});
