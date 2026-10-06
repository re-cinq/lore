import { afterEach, describe, expect, it, vi } from "vitest";
import { initPool, resetPool } from "./pg-pool.js";

afterEach(() => {
  resetPool();
  vi.restoreAllMocks();
});

describe("the shared pool's idle-client error", () => {
  it("logs a terminated idle client under the db prefix instead of ending the process", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = initPool({
      LORE_DB_HOST: "db",
      LORE_DB_PORT: "5432",
      LORE_DB_NAME: "lore",
      LORE_DB_USER: "lore",
    });
    const failure = new Error("terminating connection");

    pool.emit("error", failure, undefined as never);

    expect(logged).toHaveBeenCalledWith(
      "[db] pg pool error (idle client):",
      failure,
    );
  });
});
