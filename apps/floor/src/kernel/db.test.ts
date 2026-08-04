import { describe, it, expect, vi, afterEach } from "vitest";
import type pg from "pg";
import { initPool } from "./db.js";

describe("initPool", () => {
  let pool: pg.Pool | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool?.end();
  });

  // With no "error" listener attached, EventEmitter's emit("error") throws
  // synchronously — this test reaching its assertion proves the process
  // survives an idle-client failure instead of crashing (#1044).
  it("logs an emitted pool error instead of crashing the process", () => {
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
