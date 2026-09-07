import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { fakePgPool } from "../../../test-helpers/fake-pg-pool.js";
import { DbLeaseBackend, FileLeaseBackend } from "./lease-backends.js";

const exporter = new InMemorySpanExporter();

trace.setGlobalTracerProvider(
  new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }),
);

let tmpDir: string;

beforeEach(async () => {
  exporter.reset();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-lease-span-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function recordedSpan() {
  const spans = exporter.getFinishedSpans();

  expect(spans).toHaveLength(1);

  return spans[0];
}

describe("lease span telemetry", () => {
  it("db acquire records lore.lease.acquire with branch, task, holder, ttl and backend", async () => {
    const { pool } = fakePgPool([
      { rowCount: 1, rows: [{ previous_holder: null }] },
    ]);

    await new DbLeaseBackend(pool).acquire("branch-x", "task-1", "pod-A", 600);

    const span = recordedSpan();

    expect(span.name).toBe("lore.lease.acquire");
    expect(span.attributes).toEqual({
      branch_name: "branch-x",
      task_id: "task-1",
      holder: "pod-A",
      ttl_sec: 600,
      backend: "db",
      outcome: "acquired",
    });
  });

  it("file acquire records the same attribute names as db, differing only in backend", async () => {
    await new FileLeaseBackend(tmpDir).acquire(
      "branch-x",
      "task-1",
      "pod-A",
      600,
    );

    expect(recordedSpan().attributes).toEqual({
      branch_name: "branch-x",
      task_id: "task-1",
      holder: "pod-A",
      ttl_sec: 600,
      backend: "file",
      outcome: "acquired",
    });
  });

  it("acquire with no task records task_id as the empty string", async () => {
    await new FileLeaseBackend(tmpDir).acquire("branch-x", null, "pod-A", 600);

    expect(recordedSpan().attributes).toMatchObject({ task_id: "" });
  });

  it("release omits task_id and ttl_sec, which the operation does not have", async () => {
    const { pool } = fakePgPool([{ rowCount: 1, rows: [] }]);

    await new DbLeaseBackend(pool).release("branch-x", "pod-A");

    expect(recordedSpan().attributes).toEqual({
      branch_name: "branch-x",
      holder: "pod-A",
      backend: "db",
      outcome: "released",
    });
  });

  it("refresh with a phase records it, and without one omits the attribute", async () => {
    const { pool } = fakePgPool([
      { rowCount: 1, rows: [] },
      { rowCount: 1, rows: [] },
    ]);
    const backend = new DbLeaseBackend(pool);

    await backend.refresh("branch-x", "pod-A", 600, "review");
    await backend.refresh("branch-x", "pod-A", 600);

    const [withPhase, without] = exporter.getFinishedSpans();

    expect(withPhase?.attributes).toMatchObject({ phase: "review" });
    expect(without?.attributes).not.toHaveProperty("phase");
  });

  it("reap records only the backend and the count it swept", async () => {
    await new FileLeaseBackend(tmpDir).reapExpired(new Date());

    expect(recordedSpan().attributes).toEqual({
      backend: "file",
      reaped_count: 0,
    });
  });
});
