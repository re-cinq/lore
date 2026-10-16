import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  saveUtopiaCommitsHead,
  saveUtopiaMirrorSettings,
  saveUtopiaSource,
  utopiaSourceFor,
} from "../outbound/utopia-sources.js";

describe("lore.utopia_sources", () => {
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
      "DELETE FROM lore.utopia_sources WHERE repo LIKE 'it-utopia/%'",
    );
    await pool.query("DELETE FROM lore.repos WHERE owner = 'it-utopia'");
  });

  afterAll(async () => {
    await pool?.query(
      "DELETE FROM lore.utopia_sources WHERE repo LIKE 'it-utopia/%'",
    );
    await pool?.query("DELETE FROM lore.repos WHERE owner = 'it-utopia'");
    await pool?.end();
  });

  it("keeps the commit cursor c1 and the auto_review setting when the mirror settings are saved again, and the cursor write keeps the knowledge base beside it", async () => {
    await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged, settings)
       VALUES ('it-utopia', 'cursor', 'it-utopia/cursor', true, '{"auto_review": true}')`,
    );
    await saveUtopiaMirrorSettings(pool, "it-utopia/cursor", {
      kb_id: "kb-1",
      source_id: "src-1",
      ontology_version: 3,
    });
    await saveUtopiaCommitsHead(pool, "it-utopia/cursor", "c1");
    await saveUtopiaMirrorSettings(pool, "it-utopia/cursor", {
      kb_id: "kb-1",
      source_id: "src-1",
      ontology_version: 4,
    });
    const { rows } = await pool.query<{ settings: unknown }>(
      "SELECT settings FROM lore.repos WHERE full_name = 'it-utopia/cursor'",
    );

    expect(rows[0]?.settings).toEqual({
      auto_review: true,
      utopia: {
        kb_id: "kb-1",
        source_id: "src-1",
        ontology_version: 4,
        commits_head: "c1",
      },
    });
  });

  it("reads the source saved for it-utopia/Lore back as it-utopia/lore, and a second save overwrites the key", async () => {
    const first = { repo: "it-utopia/Lore", kbId: "kb-1", sourceId: "src-1" };

    await saveUtopiaSource(pool, { ...first, key: "utp_old" });
    await saveUtopiaSource(pool, {
      ...first,
      sourceId: "src-2",
      key: "utp_new",
    });

    expect({
      read: await utopiaSourceFor(pool, "it-utopia/lore"),
      missing: await utopiaSourceFor(pool, "it-utopia/ghost"),
    }).toEqual({
      read: { id: "src-2", key: "utp_new", kbId: "kb-1" },
      missing: null,
    });
  });

  it("grants lore every privilege and lore_ui none", async () => {
    const { rows } = await pool.query<{ lore: boolean; ui: boolean | null }>(
      `SELECT has_table_privilege('lore', 'lore.utopia_sources', 'SELECT') AS lore,
              (SELECT has_table_privilege('lore_ui', 'lore.utopia_sources', 'SELECT')
                 WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui')) AS ui`,
    );

    expect(rows[0]).toMatchObject({ lore: true, ui: false });
  });
});
