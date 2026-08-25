import { describe, it, expect, afterEach } from "vitest";
import { initPool, getPool, resetPool } from "./pg-pool.js";

afterEach(() => {
  resetPool();
});

describe("the shared pool", () => {
  it("refuses to hand out a pool before boot has made one", () => {
    expect(() => getPool()).toThrow(/not initialized/);
  });

  it("reads the database and user from the env the charts set", () => {
    const pool = initPool({
      LORE_DB_HOST: "db.internal",
      LORE_DB_PORT: "6432",
      LORE_DB_NAME: "lore",
      LORE_DB_USER: "lore",
      LORE_DB_PASSWORD: "secret",
    });

    expect({
      database: pool.options.database,
      user: pool.options.user,
      host: pool.options.host,
      port: pool.options.port,
    }).toEqual({
      database: "lore",
      user: "lore",
      host: "db.internal",
      port: 6432,
    });
  });

  it("falls back to the local defaults when nothing is configured", () => {
    const pool = initPool({});

    expect({
      database: pool.options.database,
      host: pool.options.host,
      port: pool.options.port,
    }).toEqual({ database: "lore", host: "localhost", port: 5432 });
  });
});
