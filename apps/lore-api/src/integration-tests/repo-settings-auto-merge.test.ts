import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { buildServer } from "../app/build-server.js";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const REPO = "test/settings-auto-merge";

describe("PUT /api/repos/{owner}/{repo}/settings with an auto_merge block", () => {
  let pool: pg.Pool;
  const token = process.env.LORE_INGEST_TOKEN;

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("DELETE FROM lore.repos WHERE full_name = $1", [REPO]);
  });

  afterEach(async () => {
    await pool.query("DELETE FROM lore.repos WHERE full_name = $1", [REPO]);
  });

  afterAll(async () => {
    process.env.LORE_INGEST_TOKEN = token;
    await pool?.end();
  });

  it("keeps auto_merge.enabled true when the settings page saves min_age_hours 6", async () => {
    await pool.query(
      "INSERT INTO lore.repos (owner, name, full_name, settings) VALUES ('test', 'settings-auto-merge', $1, $2)",
      [REPO, JSON.stringify({ auto_merge: { enabled: true } })],
    );

    const res = await buildServer(() => pool).inject({
      method: "PUT",
      url: `/api/repos/${REPO}/settings`,
      headers: AUTH,
      payload: JSON.stringify({
        settings: { auto_merge: { min_age_hours: 6 } },
      }),
    });
    const { rows } = await pool.query<{ auto_merge: unknown }>(
      "SELECT settings->'auto_merge' AS auto_merge FROM lore.repos WHERE full_name = $1",
      [REPO],
    );

    expect({ status: res.statusCode, autoMerge: rows[0]?.auto_merge }).toEqual({
      status: 200,
      autoMerge: { enabled: true, min_age_hours: 6 },
    });
  });

  it("keeps digest.enabled true when the settings page saves the digest's time 10:00, and clears the block for digest null", async () => {
    await pool.query(
      "INSERT INTO lore.repos (owner, name, full_name, settings) VALUES ('test', 'settings-auto-merge', $1, $2)",
      [REPO, JSON.stringify({ digest: { enabled: true, time: "09:00" } })],
    );
    const save = (settings: unknown) =>
      buildServer(() => pool).inject({
        method: "PUT",
        url: `/api/repos/${REPO}/settings`,
        headers: AUTH,
        payload: JSON.stringify({ settings }),
      });
    const digest = async () =>
      (
        await pool.query<{ digest: unknown }>(
          "SELECT settings->'digest' AS digest FROM lore.repos WHERE full_name = $1",
          [REPO],
        )
      ).rows[0]?.digest;

    await save({ digest: { time: "10:00" } });
    const saved = await digest();

    await save({ digest: null });

    expect({ saved, cleared: await digest() }).toEqual({
      saved: { enabled: true, time: "10:00" },
      cleared: null,
    });
  });

  it("saves digest time 10:00 into a block cleared to null as the object time 10:00, and switches the digest on there as enabled true", async () => {
    await pool.query(
      "INSERT INTO lore.repos (owner, name, full_name, settings) VALUES ('test', 'settings-auto-merge', $1, $2)",
      [REPO, JSON.stringify({ digest: null })],
    );
    const digest = async () =>
      (
        await pool.query<{ digest: unknown }>(
          "SELECT settings->'digest' AS digest FROM lore.repos WHERE full_name = $1",
          [REPO],
        )
      ).rows[0]?.digest;

    await buildServer(() => pool).inject({
      method: "PUT",
      url: `/api/repos/${REPO}/settings`,
      headers: AUTH,
      payload: JSON.stringify({ settings: { digest: { time: "10:00" } } }),
    });
    const saved = await digest();

    await pool.query(
      "UPDATE lore.repos SET settings = jsonb_set(settings, '{digest}', 'null') WHERE full_name = $1",
      [REPO],
    );
    await buildServer(() => pool).inject({
      method: "PUT",
      url: `/api/repos/${REPO}/loops/digest`,
      headers: AUTH,
      payload: JSON.stringify({ enabled: true }),
    });

    expect({ saved, switched: await digest() }).toEqual({
      saved: { time: "10:00" },
      switched: { enabled: true },
    });
  });
});
