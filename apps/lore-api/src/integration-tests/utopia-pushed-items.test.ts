import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  pushedItemsFor,
  savePushedItems,
} from "../outbound/utopia/pushed-items.js";

describe("lore.utopia_pushed_items", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query(
      readFileSync(
        new URL(
          "../../../../deploy/chart/charts/ui-helm/migrations/0123_utopia_pushed_items.sql",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
    await pool.query(
      "DELETE FROM lore.utopia_pushed_items WHERE repo LIKE 'it-pushed/%'",
    );
  });

  afterAll(async () => {
    await pool?.query(
      "DELETE FROM lore.utopia_pushed_items WHERE repo LIKE 'it-pushed/%'",
    );
    await pool?.end();
  });

  it("reads the ids saved for it-pushed/Lore back as it-pushed/lore, and a second save replaces them", async () => {
    await savePushedItems(pool, "it-pushed/Lore", "specs/a/spec.md", [
      "stmt:specs/a/spec.md#0000",
      "stmt:specs/a/spec.md#0001",
    ]);
    await savePushedItems(pool, "it-pushed/lore", "specs/a/spec.md", [
      "stmt:specs/a/spec.md#0000",
    ]);

    expect({
      saved: await pushedItemsFor(pool, "it-pushed/lore", "specs/a/spec.md"),
      other: await pushedItemsFor(pool, "it-pushed/lore", "specs/b/spec.md"),
    }).toEqual({ saved: ["stmt:specs/a/spec.md#0000"], other: [] });
  });
});
