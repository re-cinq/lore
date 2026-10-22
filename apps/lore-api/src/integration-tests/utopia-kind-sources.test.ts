import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
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
      "DELETE FROM lore.utopia_sources WHERE repo LIKE 'it-kinds/%'",
    );
    await pool?.query(
      "DELETE FROM lore.utopia_kind_sources WHERE repo LIKE 'it-kinds/%'",
    );
    await pool?.query("DELETE FROM lore.repos WHERE owner = 'it-kinds'");
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

  it("names the docs source in the settings of a repo set up before, leaves other settings and a repo with no utopia block alone, and does so again unchanged", async () => {
    await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged, settings) VALUES
         ('it-kinds', 'set', 'it-kinds/set', true, '{"auto_review": true, "utopia": {"kb_id": "kb-1", "source_id": "src-1"}}'),
         ('it-kinds', 'bare', 'it-kinds/bare', true, '{"auto_review": true}')`,
    );

    for (const repo of ["it-kinds/Set", "it-kinds/bare"]) {
      await saveKindSource(
        pool,
        { repo, kind: "docs", kbId: "kb-1" },
        { id: "src-docs", key: "utp_d" },
      );
    }
    const migration = readFileSync(
      new URL(
        "../../../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0115_utopia_docs_source_id.sql",
        import.meta.url,
      ),
      "utf-8",
    );

    await pool.query(migration);
    await pool.query(migration);
    const { rows } = await pool.query<{ full_name: string; settings: unknown }>(
      "SELECT full_name, settings FROM lore.repos WHERE owner = 'it-kinds' ORDER BY full_name",
    );

    expect(rows).toEqual([
      { full_name: "it-kinds/bare", settings: { auto_review: true } },
      {
        full_name: "it-kinds/set",
        settings: {
          auto_review: true,
          utopia: {
            kb_id: "kb-1",
            source_id: "src-1",
            docs_source_id: "src-docs",
          },
        },
      },
    ]);
  });

  it("makes the old lore source the test-coverage source of every repo set up under it, replacing a newer test-coverage source and leaving its docs source alone, and again changes nothing", async () => {
    await pool.query(
      `INSERT INTO lore.utopia_sources (repo, kb_id, source_id, source_key) VALUES
         ('it-kinds/old', 'kb-1', 'src-old', 'utp_old'),
         ('it-kinds/newer', 'kb-2', 'src-lore', 'utp_lore')`,
    );
    await saveKindSource(
      pool,
      { repo: "it-kinds/newer", kind: "test-coverage", kbId: "kb-2" },
      { id: "src-new-cov", key: "utp_new_cov" },
    );
    await saveKindSource(
      pool,
      { repo: "it-kinds/newer", kind: "docs", kbId: "kb-2" },
      { id: "src-docs", key: "utp_docs" },
    );
    const migration = readFileSync(
      new URL(
        "../../../../infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0116_utopia_test_coverage_is_the_lore_source.sql",
        import.meta.url,
      ),
      "utf-8",
    );

    await pool.query(migration);
    await pool.query(migration);
    const { rows } = await pool.query(
      `SELECT repo, kind, kb_id AS "kbId", source_id AS id, source_key AS key
         FROM lore.utopia_kind_sources WHERE repo LIKE 'it-kinds/%' ORDER BY repo, kind`,
    );

    expect(
      rows.filter((row) =>
        ["it-kinds/old", "it-kinds/newer"].includes(row.repo),
      ),
    ).toEqual([
      {
        repo: "it-kinds/newer",
        kind: "docs",
        kbId: "kb-2",
        id: "src-docs",
        key: "utp_docs",
      },
      {
        repo: "it-kinds/newer",
        kind: "test-coverage",
        kbId: "kb-2",
        id: "src-lore",
        key: "utp_lore",
      },
      {
        repo: "it-kinds/old",
        kind: "test-coverage",
        kbId: "kb-1",
        id: "src-old",
        key: "utp_old",
      },
    ]);
  });
});
