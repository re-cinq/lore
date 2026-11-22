import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { revokePersonAccess } from "./person-access.js";
import { onSessionEnded } from "./session-ended.js";

function poolRevoking(ids: string[]) {
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("RETURNING id") ? ids.map((id) => ({ id })) : [],
    })),
    release: vi.fn(),
  };

  return { connect: vi.fn(async () => client) } as unknown as Pool;
}

describe("revokePersonAccess announcing", () => {
  it("announces every session row it revoked", async () => {
    const ended = vi.fn();
    const stop = onSessionEnded(ended);

    await revokePersonAccess(poolRevoking(["row-1", "row-2"]), 4242);
    stop();

    expect(ended.mock.calls).toEqual([["row-1"], ["row-2"]]);
  });
});
