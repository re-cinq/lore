import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { ingestSpecTrace } from "./ingest-spec-trace.js";
import { failuresTouching } from "./failure-nodes.js";
import { readOverlay } from "./overlay.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

function payload(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "validate-failed",
    assemblyRunId: "run-7",
    stationRunId: randomUUID(),
    nodeId: "validate",
    iteration: 1,
    failureClass: "unknown",
    failureDetail: "src/widget.ts(12,5): error TS2345: bad argument",
    commit: "sha-red",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe.skipIf(!reachable)("the failure ingest kind (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  it("records a failed node against the file its output named", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await ingestSpecTrace(client, repo, "failure", payload());

    expect(await failuresTouching(client, repo, "src/widget.ts")).toMatchObject(
      [{ nodeId: "validate", commit: "sha-red" }],
    );
  });

  it("writes no overlay for a failure, which is a fact about the repo and not a branch snapshot", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await ingestSpecTrace(client, repo, "failure", payload());

    expect(await readOverlay(client, repo, "run-7")).toBeNull();
  });

  it("stamps the resolving sha when a later attempt on the same node succeeds", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await ingestSpecTrace(client, repo, "failure", payload());
    await ingestSpecTrace(
      client,
      repo,
      "failure",
      payload({ outcome: "success", iteration: 2, commit: "sha-green" }),
    );

    expect(await failuresTouching(client, repo, "src/widget.ts")).toMatchObject(
      [{ resolvedByCommit: "sha-green" }],
    );
  });

  it("records a failure whose occurredAt crossed the ingest JSON as a string", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const overTheWire: unknown = JSON.parse(JSON.stringify(payload()));

    await ingestSpecTrace(client, repo, "failure", overTheWire);

    expect(await failuresTouching(client, repo, "src/widget.ts")).toMatchObject(
      [{ occurredAt: "2026-01-01T00:00:00Z" }],
    );
  });
});
