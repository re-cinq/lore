import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { overlayScope } from "../../domain/spec-trace/trace-scope.js";
import { upsertOverlay, listOverlays } from "./overlay.js";
import { projectFailure, failuresTouching } from "./failure-nodes.js";
import {
  pruneGraphRetention,
  retentionCutoff,
  GRAPH_RETENTION_DAYS,
} from "./graph-retention.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe("retentionCutoff", () => {
  it("is the retention window before the given instant", () => {
    expect(
      retentionCutoff(new Date("2026-01-15T00:00:00.000Z"), 14).toISOString(),
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("defaults to the same fourteen days the run telemetry keeps", () => {
    expect(GRAPH_RETENTION_DAYS).toBe(14);
  });
});

describe.skipIf(!reachable)("pruneGraphRetention (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  it("reaps an expired overlay and an expired failure in one pass", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await upsertOverlay(client, overlayScope(repo, "feat/old"), {
      headCommit: "sha",
      at: new Date("2020-01-01T00:00:00.000Z"),
    });
    await projectFailure(client, repo, {
      assemblyRunId: "run-old",
      stationRunId: randomUUID(),
      nodeId: "validate",
      iteration: 1,
      failureClass: "unknown",
      failureDetail: "src/old.ts(1,1): error TS1000: stale",
      commit: "sha-old",
      occurredAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    expect(
      await pruneGraphRetention(client, repo, {
        now: new Date("2026-01-15T00:00:00.000Z"),
      }),
    ).toEqual({ overlays: 1, failures: 1 });
  });

  it("leaves an overlay and a failure inside the window alone", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await upsertOverlay(client, overlayScope(repo, "feat/new"), {
      headCommit: "sha",
      at: new Date("2026-01-14T00:00:00.000Z"),
    });
    await projectFailure(client, repo, {
      assemblyRunId: "run-new",
      stationRunId: randomUUID(),
      nodeId: "validate",
      iteration: 1,
      failureClass: "unknown",
      failureDetail: "src/new.ts(1,1): error TS1000: fresh",
      commit: "sha-new",
      occurredAt: new Date("2026-01-14T00:00:00.000Z"),
    });
    await pruneGraphRetention(client, repo, {
      now: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect({
      overlays: (await listOverlays(client, repo)).length,
      failures: (await failuresTouching(client, repo, "src/new.ts")).length,
    }).toEqual({ overlays: 1, failures: 1 });
  });
});
