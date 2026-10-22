import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  kindSourceFor,
  saveKindSource,
} from "../outbound/utopia-kind-sources.js";

describe("lore.utopia_kind_sources", () => {
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
      "DELETE FROM lore.utopia_kind_sources WHERE repo LIKE 'it-kinds/%'",
    );
  });

  afterAll(async () => {
    await pool?.query(
      "DELETE FROM lore.utopia_kind_sources WHERE repo LIKE 'it-kinds/%'",
    );
    await pool?.end();
  });

  it("reads the docs source saved for it-kinds/Lore back as it-kinds/lore, and a second save replaces its id and key", async () => {
    const first = {
      repo: "it-kinds/Lore",
      kind: "docs" as const,
      kbId: "kb-1",
    };

    await saveKindSource(pool, first, { id: "src-1", key: "utp_old" });
    await saveKindSource(pool, first, { id: "src-2", key: "utp_new" });

    expect({
      read: await kindSourceFor(pool, "it-kinds/lore", "docs"),
      missing: await kindSourceFor(pool, "it-kinds/ghost", "docs"),
    }).toEqual({
      read: { id: "src-2", key: "utp_new", kbId: "kb-1" },
      missing: null,
    });
  });

  it("keeps the github and test-coverage sources of it-kinds/both apart, each under its own key", async () => {
    const base = { repo: "it-kinds/both", kbId: "kb-1" };

    await saveKindSource(
      pool,
      { ...base, kind: "github" },
      {
        id: "src-g",
        key: "utp_g",
      },
    );
    await saveKindSource(
      pool,
      { ...base, kind: "test-coverage" },
      {
        id: "src-t",
        key: "utp_t",
      },
    );

    expect({
      github: await kindSourceFor(pool, "it-kinds/both", "github"),
      coverage: await kindSourceFor(pool, "it-kinds/both", "test-coverage"),
      commits: await kindSourceFor(pool, "it-kinds/both", "git-history"),
    }).toEqual({
      github: { id: "src-g", key: "utp_g", kbId: "kb-1" },
      coverage: { id: "src-t", key: "utp_t", kbId: "kb-1" },
      commits: null,
    });
  });

  it("refuses a kind outside docs, test-coverage, git-history and github", async () => {
    await expect(
      pool.query(
        `INSERT INTO lore.utopia_kind_sources (repo, kind, kb_id, source_id, source_key)
         VALUES ('it-kinds/bad', 'code', 'kb-1', 'src-1', 'utp_k')`,
      ),
    ).rejects.toThrow(/utopia_kind_sources_kind_check/);
  });

  it("grants lore every privilege and lore_ui none", async () => {
    const { rows } = await pool.query<{ lore: boolean; ui: boolean | null }>(
      `SELECT has_table_privilege('lore', 'lore.utopia_kind_sources', 'SELECT') AS lore,
              (SELECT has_table_privilege('lore_ui', 'lore.utopia_kind_sources', 'SELECT')
                 WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui')) AS ui`,
    );

    expect(rows[0]).toMatchObject({ lore: true, ui: false });
  });
});
