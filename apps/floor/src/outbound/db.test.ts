import { describe, it, expect, vi, afterEach } from "vitest";
import type pg from "pg";
import { initPool } from "./db.js";

describe("initPool", () => {
  let pool: pg.Pool | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool?.end();
  });

  it("logs an emitted pool error instead of crashing the process on an idle-client failure (#1044)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    pool = initPool();
    const backendDeath = new Error(
      "terminating connection due to administrator command",
    );

    pool.emit("error", backendDeath);

    expect(errorSpy).toHaveBeenCalledWith(
      "[db] pg pool error (idle client):",
      backendDeath,
    );
  });
});
