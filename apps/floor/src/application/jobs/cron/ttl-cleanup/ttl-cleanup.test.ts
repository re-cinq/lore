import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("../../../../data/db.js", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

import { ttlCleanupJob } from "./ttl-cleanup.js";

describe("ttlCleanupJob", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([{ count: "3" }]);
  });

  it("expires memories via the is_deleted column, not a non-existent deleted column", async () => {
    await ttlCleanupJob();
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("is_deleted = true");
    expect(sql).toContain("is_deleted = false");
    expect(sql).not.toMatch(/\bSET\s+deleted\b/);
    expect(sql).not.toMatch(/\bAND\s+deleted\b/);
    expect(sql).not.toContain("updated_at");
  });

  it("returns the count of expired memories", async () => {
    expect(await ttlCleanupJob()).toBe("Cleaned up 3 expired memories");
  });
});
