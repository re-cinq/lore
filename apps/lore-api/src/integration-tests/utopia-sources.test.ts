import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  clearUtopiaCursors,
  saveUtopiaBase,
  saveUtopiaCommitsHead,
  saveUtopiaMirrorSettings,
  saveUtopiaTrackerSince,
  utopiaBaseFor,
} from "../outbound/utopia/sources.js";

const cleanUp = async (pool: pg.Pool) => {
  await pool.query(
    "DELETE FROM lore.utopia_bases WHERE name LIKE 'it-utopia/%'",
  );
  await pool.query(
    "DELETE FROM lore.utopia_sources WHERE repo LIKE 'it-utopia/%'",
  );
  await pool.query("DELETE FROM lore.repos WHERE owner = 'it-utopia'");
};

describe("lore.utopia_bases and the utopia settings block", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await cleanUp(pool);
  });

  afterAll(async () => {
    await cleanUp(pool);
    await pool.end();
  });

  it("keeps the commit cursor c1, the tracker cursor and the auto_review setting when the mirror settings are saved again, and each cursor write keeps the knowledge base and the other cursor beside it", async () => {
    await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged, settings)
       VALUES ('it-utopia', 'cursor', 'it-utopia/cursor', true, '{"auto_review": true}')`,
    );
    await saveUtopiaMirrorSettings(pool, "it-utopia/cursor", {
      kb_id: "kb-1",
      ontology_version: 3,
    });
    await saveUtopiaCommitsHead(pool, "it-utopia/cursor", "c1");
    await saveUtopiaTrackerSince(
      pool,
      "it-utopia/cursor",
      "2026-10-16T02:00:00Z",
    );
    await saveUtopiaMirrorSettings(pool, "it-utopia/cursor", {
      kb_id: "kb-1",
      ontology_version: 4,
    });
    const { rows } = await pool.query<{ settings: unknown }>(
      "SELECT settings FROM lore.repos WHERE full_name = 'it-utopia/cursor'",
    );

    expect(rows[0]?.settings).toEqual({
      auto_review: true,
      utopia: {
        kb_id: "kb-1",
        ontology_version: 4,
        commits_head: "c1",
        tracker_since: "2026-10-16T02:00:00Z",
      },
    });
  });

  it("reads the kb-2 saved for it-utopia/Lore back as it-utopia/lore after a first save of kb-1, and null for it-utopia/ghost", async () => {
    await saveUtopiaBase(pool, "it-utopia/Lore", "kb-1");
    await saveUtopiaBase(pool, "it-utopia/Lore", "kb-2");

    expect({
      read: await utopiaBaseFor(pool, "it-utopia/lore"),
      missing: await utopiaBaseFor(pool, "it-utopia/ghost"),
    }).toEqual({ read: "kb-2", missing: null });
  });

  it("grants lore every privilege and lore_ui none", async () => {
    const { rows } = await pool.query<{ lore: boolean; ui: boolean | null }>(
      `SELECT has_table_privilege('lore', 'lore.utopia_bases', 'SELECT') AS lore,
              (SELECT has_table_privilege('lore_ui', 'lore.utopia_bases', 'SELECT')
                 WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui')) AS ui`,
    );

    expect(rows[0]).toMatchObject({ lore: true, ui: false });
  });

  it("copies the knowledge base of every lore source into lore.utopia_bases, keeps a base already recorded, drops source_id from settings, and again changes nothing", async () => {
    await pool.query(
      `INSERT INTO lore.utopia_sources (repo, kb_id, source_id, source_key) VALUES
         ('it-utopia/old', 'kb-old', 'src-old', 'utp_old'),
         ('it-utopia/kept', 'kb-stale', 'src-kept', 'utp_kept')`,
    );
    await saveUtopiaBase(pool, "it-utopia/kept", "kb-kept");
    await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged, settings) VALUES
         ('it-utopia', 'old', 'it-utopia/old', true, '{"auto_review": true, "utopia": {"kb_id": "kb-old", "source_id": "src-old", "ontology_version": 7}}')`,
    );
    const migration = readFileSync(
      new URL(
        "../../../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0119_utopia_bases.sql",
        import.meta.url,
      ),
      "utf-8",
    );

    await pool.query(migration);
    await pool.query(migration);
    const settings = await pool.query<{ settings: unknown }>(
      "SELECT settings FROM lore.repos WHERE full_name = 'it-utopia/old'",
    );

    expect({
      old: await utopiaBaseFor(pool, "it-utopia/old"),
      kept: await utopiaBaseFor(pool, "it-utopia/kept"),
      settings: settings.rows[0]?.settings,
    }).toEqual({
      old: "kb-old",
      kept: "kb-kept",
      settings: {
        auto_review: true,
        utopia: { kb_id: "kb-old", ontology_version: 7 },
      },
    });
  });

  it("drops the commit and tracker cursors and keeps the knowledge base, the docs source, the version and every other setting, and leaves a repo with no utopia block alone", async () => {
    await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged, settings) VALUES
         ('it-utopia', 'cleared', 'it-utopia/cleared', true, '{"auto_review": true, "utopia": {"kb_id": "kb-1", "docs_source_id": "src-docs", "ontology_version": 7, "commits_head": "c1", "tracker_since": "2026-10-16T02:00:00Z"}}'),
         ('it-utopia', 'bare', 'it-utopia/bare', true, '{"auto_review": true}')`,
    );

    await clearUtopiaCursors(pool, "it-utopia/cleared");
    await clearUtopiaCursors(pool, "it-utopia/bare");
    const { rows } = await pool.query<{ full_name: string; settings: unknown }>(
      "SELECT full_name, settings FROM lore.repos WHERE owner = 'it-utopia' AND name IN ('cleared', 'bare') ORDER BY full_name",
    );

    expect(rows).toEqual([
      { full_name: "it-utopia/bare", settings: { auto_review: true } },
      {
        full_name: "it-utopia/cleared",
        settings: {
          auto_review: true,
          utopia: {
            kb_id: "kb-1",
            docs_source_id: "src-docs",
            ontology_version: 7,
          },
        },
      },
    ]);
  });
});
