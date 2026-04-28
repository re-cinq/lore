import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  DbLeaseBackend,
  FileLeaseBackend,
} from "../supervisor/lease.js";

// ── pg.Pool mock ───────────────────────────────────────────────────────

type Call = { sql: string; values: unknown[] };

function mockPool(responses: Array<{ rowCount: number; rows?: unknown[] }>) {
  const calls: Call[] = [];
  let i = 0;
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      const r = responses[i++] ?? { rowCount: 0, rows: [] };
      return { rowCount: r.rowCount, rows: r.rows ?? [] };
    }),
  };
  // The lease module only uses `pool.query`; satisfy the type via cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pool: pool as any, calls };
}

// ── DbLeaseBackend ─────────────────────────────────────────────────────

describe("DbLeaseBackend.acquire", () => {
  it("returns acquired:true on first acquire (no prior row)", async () => {
    const { pool, calls } = mockPool([
      { rowCount: 1, rows: [{ previous_holder: null }] },
    ]);
    const backend = new DbLeaseBackend(pool);
    const r = await backend.acquire("branch-x", "task-1", "pod-A", 600);
    expect(r).toEqual({ acquired: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("INSERT INTO pipeline.task_leases");
    expect(calls[0].sql).toContain("ON CONFLICT (branch_name)");
    expect(calls[0].sql).toContain(
      "WHERE pipeline.task_leases.expires_at < now()",
    );
    expect(calls[0].sql).toContain("WITH prev AS");
    expect(calls[0].values).toEqual(["branch-x", "task-1", "pod-A", 600]);
  });

  it("returns acquired:true with tookOverFrom on takeover (T027)", async () => {
    const { pool } = mockPool([
      { rowCount: 1, rows: [{ previous_holder: "pod-A" }] },
    ]);
    const r = await new DbLeaseBackend(pool).acquire(
      "branch-x",
      "task-1",
      "pod-B",
    );
    expect(r).toEqual({ acquired: true, tookOverFrom: "pod-A" });
  });

  it("returns acquired:false with currentHolder when lease still valid", async () => {
    const { pool, calls } = mockPool([
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ holder: "pod-A" }] },
    ]);
    const r = await new DbLeaseBackend(pool).acquire(
      "branch-x",
      "task-1",
      "pod-B",
    );
    expect(r).toEqual({ acquired: false, currentHolder: "pod-A" });
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).toContain("SELECT holder FROM pipeline.task_leases");
  });

  it("uses default TTL of 600s when not specified", async () => {
    const { pool, calls } = mockPool([
      { rowCount: 1, rows: [{ previous_holder: null }] },
    ]);
    await new DbLeaseBackend(pool).acquire("b", "t", "h");
    expect(calls[0].values).toEqual(["b", "t", "h", 600]);
  });
});

describe("DbLeaseBackend.refresh", () => {
  it("returns true when current holder refreshes", async () => {
    const { pool, calls } = mockPool([{ rowCount: 1 }]);
    const ok = await new DbLeaseBackend(pool).refresh(
      "branch-x",
      "pod-A",
      600,
      "implement",
    );
    expect(ok).toBe(true);
    expect(calls[0].sql).toContain("UPDATE pipeline.task_leases");
    expect(calls[0].sql).toContain("WHERE branch_name = $1 AND holder = $4");
    expect(calls[0].values).toEqual(["branch-x", 600, "implement", "pod-A"]);
  });

  it("returns false when not held by holder", async () => {
    const { pool } = mockPool([{ rowCount: 0 }]);
    const ok = await new DbLeaseBackend(pool).refresh("branch-x", "pod-stale");
    expect(ok).toBe(false);
  });

  it("preserves existing phase via COALESCE when phase omitted", async () => {
    const { pool, calls } = mockPool([{ rowCount: 1 }]);
    await new DbLeaseBackend(pool).refresh("branch-x", "pod-A");
    expect(calls[0].values).toEqual(["branch-x", 600, null, "pod-A"]);
    expect(calls[0].sql).toContain("COALESCE($3, phase)");
  });
});

describe("DbLeaseBackend.release", () => {
  it("returns true when holder releases its own lease", async () => {
    const { pool, calls } = mockPool([{ rowCount: 1 }]);
    const ok = await new DbLeaseBackend(pool).release("branch-x", "pod-A");
    expect(ok).toBe(true);
    expect(calls[0].sql).toContain("DELETE FROM pipeline.task_leases");
    expect(calls[0].values).toEqual(["branch-x", "pod-A"]);
  });

  it("returns false when not held (idempotent)", async () => {
    const { pool } = mockPool([{ rowCount: 0 }]);
    const ok = await new DbLeaseBackend(pool).release("branch-x", "pod-A");
    expect(ok).toBe(false);
  });
});

// ── FileLeaseBackend ───────────────────────────────────────────────────

describe("FileLeaseBackend", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-lease-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("acquires from empty state and persists a record", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    const r = await backend.acquire("lore/feature/foo", "task-1", "holder-A");
    expect(r).toEqual({ acquired: true });
    const fname = path.join(
      tmpDir,
      encodeURIComponent("lore/feature/foo") + ".json",
    );
    const raw = JSON.parse(await fs.readFile(fname, "utf-8"));
    expect(raw.holder).toBe("holder-A");
    expect(raw.task_id).toBe("task-1");
  });

  it("rejects acquire when an unexpired lease exists", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    await backend.acquire("b", "t1", "holder-A", 600);
    const r = await backend.acquire("b", "t2", "holder-B");
    expect(r).toEqual({ acquired: false, currentHolder: "holder-A" });
  });

  it("allows takeover after the prior lease has expired and reports tookOverFrom (T027)", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    await backend.acquire("b", "t1", "holder-A", -1); // expires immediately
    const r = await backend.acquire("b", "t2", "holder-B");
    expect(r).toEqual({ acquired: true, tookOverFrom: "holder-A" });
  });

  it("refresh by current holder extends the expiry", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    await backend.acquire("b", "t1", "holder-A", 60);
    const ok = await backend.refresh("b", "holder-A", 600, "implement");
    expect(ok).toBe(true);
  });

  it("refresh by non-holder returns false", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    await backend.acquire("b", "t1", "holder-A");
    const ok = await backend.refresh("b", "holder-B");
    expect(ok).toBe(false);
  });

  it("refresh on missing record returns false", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    expect(await backend.refresh("nope", "anyone")).toBe(false);
  });

  it("release by holder removes the record", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    await backend.acquire("b", "t1", "holder-A");
    expect(await backend.release("b", "holder-A")).toBe(true);
    // file should be gone
    const fname = path.join(tmpDir, encodeURIComponent("b") + ".json");
    await expect(fs.access(fname)).rejects.toThrow();
  });

  it("release by non-holder returns false and leaves record", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    await backend.acquire("b", "t1", "holder-A");
    expect(await backend.release("b", "holder-B")).toBe(false);
    const fname = path.join(tmpDir, encodeURIComponent("b") + ".json");
    await fs.access(fname); // does not throw
  });

  it("encodes branch names with slashes correctly", async () => {
    const backend = new FileLeaseBackend(tmpDir);
    await backend.acquire("lore/feature/with/slashes", "t", "h");
    const files = await fs.readdir(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("lore%2Ffeature%2Fwith%2Fslashes");
  });
});
