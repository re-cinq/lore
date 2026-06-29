import { describe, it, expect } from "vitest";
import { Leases } from "./leases.js";
import { FileLeaseBackend } from "./lease-backends.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

describe("Leases sub-facade", () => {
  it("acquires, refuses a held branch, then releases via the wired backend", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-leases-"));
    const leases = new Leases(new FileLeaseBackend(dir));

    const first = await leases.acquire("lore/feat/x", "task-1", "pod-a");
    expect(first).toEqual({ acquired: true });

    const second = await leases.acquire("lore/feat/x", "task-2", "pod-b");
    expect(second).toEqual({ acquired: false, currentHolder: "pod-a" });

    expect(await leases.release("lore/feat/x", "pod-a")).toBe(true);
  });

  it("reapExpired returns the leases the backend swept past the cutoff", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-leases-"));
    const leases = new Leases(new FileLeaseBackend(dir));

    await leases.acquire("lore/feat/x", "task-1", "pod-a", -1); // expired
    const expired = await leases.reapExpired(new Date());

    expect(expired.map((l) => l.task_id)).toEqual(["task-1"]);
  });
});
