import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgSettings } from "./settings-pg.js";
import { listChunkSchemas } from "../chunks/chunk-schema.js";
import { moveRepoKnowledge, type KnowledgeMoveCount } from "./repo-move.js";
import {
  NOT_A_REPO_NAME_COLUMNS,
  REPO_KEYED_TABLES,
} from "./repo-move-registry.js";

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
};

async function pgAvailable(): Promise<{ ok: boolean; why: string }> {
  const probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });

  try {
    const { rows } = await probe.query<{ present: boolean }>(
      `SELECT to_regclass('lore.repos') IS NOT NULL AND to_regclass('lore.utopia_bases') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : { ok: false, why: "lore.repos is absent, schema not applied" };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe.end();
  }
}

const pgProbe = await pgAvailable();
const pg = pgProbe.ok;
const pool = new Pool(PG_CONFIG);
const scenes: Scene[] = [];

interface Scene {
  mirror: string;
  target: string;
  teamSchema: string;
  others: string[];
}

afterEach(async () => {
  if (!pg) {
    return;
  }
  await Promise.all(scenes.splice(0).map(deleteScene));
});

afterAll(async () => {
  await pool.end();
});

async function deleteScene(scene: Scene): Promise<void> {
  const names = [scene.mirror, scene.target, ...scene.others];
  const schemas = await listChunkSchemas(pool);

  await Promise.all(
    schemas.map((schema) =>
      pool.query(`DELETE FROM ${schema}.chunks WHERE repo = ANY($1)`, [names]),
    ),
  );
  await Promise.all(
    REPO_KEYED_TABLES.filter((entry) => entry.policy !== "chunks").map(
      (entry) =>
        entry.policy === "row" || entry.table === "api_tokens"
          ? Promise.resolve()
          : pool.query(
              `DELETE FROM ${entry.schema}.${entry.table} WHERE ${entry.repoColumn}::text = ANY($1)`,
              [names],
            ),
    ),
  );
  await pool.query("DELETE FROM lore.repos WHERE full_name = ANY($1)", [names]);
}

async function newScene(): Promise<Scene> {
  const suffix = randomBytes(4).toString("hex");
  const schemas = await listChunkSchemas(pool);
  const scene: Scene = {
    mirror: `acme-${suffix}/public`,
    target: `acme-${suffix}/private`,
    others: [],
    teamSchema:
      schemas.find((schema) => schema !== "org_shared") ?? "org_shared",
  };

  scenes.push(scene);
  await pool.query(
    `INSERT INTO lore.repos (owner, name, full_name, team, settings) VALUES
       ($1, 'public', $2, $4, '{}'), ($1, 'private', $3, $4, $5)`,
    [
      `acme-${suffix}`,
      scene.mirror,
      scene.target,
      scene.teamSchema,
      JSON.stringify({ public_mirror: scene.mirror }),
    ],
  );

  return scene;
}

async function addChunks(
  schema: string,
  repo: string,
  files: string[],
): Promise<void> {
  await Promise.all(
    files.map((file) =>
      pool.query(
        `INSERT INTO ${schema}.chunks (content, repo, file_path, team) VALUES ($1, $2, $3, $4)`,
        [`content of ${file}`, repo, file, schema],
      ),
    ),
  );
}

async function chunkFilesOf(schema: string, repo: string): Promise<string[]> {
  const { rows } = await pool.query<{ file_path: string }>(
    `SELECT file_path FROM ${schema}.chunks WHERE repo = $1 ORDER BY file_path`,
    [repo],
  );

  return rows.map((row) => row.file_path);
}

async function rowCount(
  qualifiedTable: string,
  column: string,
  repo: string,
): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM ${qualifiedTable} WHERE ${column} = $1`,
    [repo],
  );

  return Number(rows[0].total);
}

async function rowsPerTableUnder(
  repo: string,
): Promise<Record<string, number>> {
  const schemas = await listChunkSchemas(pool);
  const tables = REPO_KEYED_TABLES.filter(
    (entry) => entry.policy !== "chunks" && entry.policy !== "row",
  ).filter((entry) => entry.table !== "api_tokens");
  const counts = await Promise.all([
    ...schemas.map(async (schema) => [
      `${schema}.chunks`,
      await rowCount(`${schema}.chunks`, "repo", repo),
    ]),
    ...tables.map(async (entry) => [
      `${entry.schema}.${entry.table}`,
      await rowCount(
        `${entry.schema}.${entry.table}`,
        `"${entry.repoColumn}"`,
        repo,
      ),
    ]),
  ]);

  return Object.fromEntries(counts);
}

function movedOrKept(counts: KnowledgeMoveCount[]): KnowledgeMoveCount[] {
  return counts.filter((count) => count.moved + count.kept_conflict > 0);
}

describe("moving a mirror's knowledge is actually exercised against Postgres", () => {
  it(
    pg
      ? "runs against a migrated Postgres"
      : `SKIPPED, ${pgProbe.why} (the double alone proves nothing about the SQL)`,
    () => {
      expect(pg || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(true);
    },
  );
});

describe.skipIf(!pg)("moveRepoKnowledge", () => {
  it("moves 3 chunks from the mirror to the private repo's team schema and keeps the 1 chunk both hold", async () => {
    const scene = await newScene();

    await addChunks(scene.teamSchema, scene.mirror, [
      "a.md",
      "b.md",
      "c.md",
      "d.md",
    ]);
    await addChunks(scene.teamSchema, scene.target, ["d.md"]);

    const counts = await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: false,
    });

    expect({
      counts: movedOrKept(counts),
      underTarget: await chunkFilesOf(scene.teamSchema, scene.target),
      underMirror: await chunkFilesOf(scene.teamSchema, scene.mirror),
    }).toEqual({
      counts: [
        { table: `${scene.teamSchema}.chunks`, moved: 3, kept_conflict: 1 },
      ],
      underTarget: ["a.md", "b.md", "c.md", "d.md"],
      underMirror: ["d.md"],
    });
  });

  it("moves 2 chunks held in org_shared onto the private repo's team schema and stamps the team on them", async () => {
    const scene = await newScene();

    await addChunks("org_shared", scene.mirror, ["x.md", "y.md"]);

    const counts = await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: false,
    });
    const { rows } = await pool.query<{ team: string }>(
      `SELECT DISTINCT team FROM ${scene.teamSchema}.chunks WHERE repo = $1`,
      [scene.target],
    );

    expect({
      counts: movedOrKept(counts),
      underTarget: await chunkFilesOf(scene.teamSchema, scene.target),
      left: await chunkFilesOf("org_shared", scene.mirror),
      teams: rows,
    }).toEqual({
      counts: [{ table: "org_shared.chunks", moved: 2, kept_conflict: 0 }],
      underTarget: ["x.md", "y.md"],
      left: [],
      teams: [{ team: scene.teamSchema }],
    });
  });

  it("moves 1 changelog week and keeps the week both repos hold", async () => {
    const scene = await newScene();

    await pool.query(
      `INSERT INTO lore.changelog_weeks (repo, week_key, intro, changes) VALUES
         ($1, '2026-W44', 'one', '[]'), ($1, '2026-W45', 'two', '[]'), ($2, '2026-W45', 'own', '[]')`,
      [scene.mirror, scene.target],
    );

    const counts = await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: false,
    });
    const { rows } = await pool.query(
      `SELECT repo, week_key, intro FROM lore.changelog_weeks WHERE repo = ANY($1) ORDER BY week_key, intro`,
      [[scene.mirror, scene.target]],
    );

    expect({ counts: movedOrKept(counts), rows }).toEqual({
      counts: [{ table: "lore.changelog_weeks", moved: 1, kept_conflict: 1 }],
      rows: [
        { repo: scene.target, week_key: "2026-W44", intro: "one" },
        { repo: scene.target, week_key: "2026-W45", intro: "own" },
        { repo: scene.mirror, week_key: "2026-W45", intro: "two" },
      ],
    });
  });

  it("moves one row of each of the 11 keyed tables, skipping none, and leaves the mirror's 2 pipeline.tasks where they are", async () => {
    const scene = await newScene();
    const planId = randomUUID();

    await seedOneRowOfEveryMovedTable(scene.mirror, planId);
    await pool.query(
      `INSERT INTO pipeline.tasks (description, target_repo) VALUES ('t1', $1), ('t2', $1)`,
      [scene.mirror],
    );

    const counts = await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: false,
    });

    expect({
      counts: movedOrKept(counts).map(({ table, moved }) => [table, moved]),
      tasksUnderMirror: await rowCount(
        "pipeline.tasks",
        "target_repo",
        scene.mirror,
      ),
      tasksUnderTarget: await rowCount(
        "pipeline.tasks",
        "target_repo",
        scene.target,
      ),
    }).toEqual({
      counts: [
        ["memory.memories", 1],
        ["memory.entities", 1],
        ["lore.plans", 1],
        ["lore.plan_collab_tokens", 1],
        ["lore.changelog_weeks", 1],
        ["lore.digest_posts", 1],
        ["lore.utopia_bases", 1],
        ["lore.utopia_kind_sources", 1],
        ["lore.utopia_pushed_items", 1],
        ["pipeline.ingest_state", 1],
        ["pipeline.test_reports", 1],
      ],
      tasksUnderMirror: 2,
      tasksUnderTarget: 0,
    });
  });

  it("reports for a dry run the 3 moved and 1 kept chunks a real run then produces, and changes nothing", async () => {
    const scene = await newScene();

    await addChunks(scene.teamSchema, scene.mirror, [
      "a.md",
      "b.md",
      "c.md",
      "d.md",
    ]);
    await addChunks(scene.teamSchema, scene.target, ["d.md"]);
    await seedOneRowOfEveryMovedTable(scene.mirror, randomUUID());

    const before = {
      mirror: await rowsPerTableUnder(scene.mirror),
      target: await rowsPerTableUnder(scene.target),
    };
    const dryRun = await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: true,
    });
    const after = {
      mirror: await rowsPerTableUnder(scene.mirror),
      target: await rowsPerTableUnder(scene.target),
    };
    const real = await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: false,
    });

    expect({ unchanged: after, dryRun }).toEqual({
      unchanged: before,
      dryRun: real,
    });
  });

  it("moves 0 rows in a second real run after the first moved 3 chunks", async () => {
    const scene = await newScene();

    await addChunks(scene.teamSchema, scene.mirror, ["a.md", "b.md", "c.md"]);
    await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: false,
    });

    const second = await moveRepoKnowledge(pool, scene.mirror, scene.target, {
      dryRun: false,
    });

    expect(second.filter((count) => count.moved > 0)).toEqual([]);
  });
});

async function seedOneRowOfEveryMovedTable(
  repo: string,
  planId: string,
): Promise<void> {
  const statements: Array<[string, unknown[]]> = [
    [
      "INSERT INTO memory.memories (agent_id, key, value, repo) VALUES ('agent-t06', 'k', 'v', $1)",
      [repo],
    ],
    [
      "INSERT INTO memory.entities (name, entity_type, repo) VALUES ($2, 'service', $1)",
      [repo, `entity-${planId}`],
    ],
    [
      "INSERT INTO lore.plans (id, repo, title, type, created_by) VALUES ($2, $1, 't', 'feature', 'u')",
      [repo, planId],
    ],
    [
      `INSERT INTO lore.plan_collab_tokens (token_hash, plan_id, repo, user_id, user_name, role, expires_at)
       VALUES ($3, $2, $1, 'u', 'U', 'write', now() + interval '1 hour')`,
      [repo, planId, `hash-${planId}`],
    ],
    [
      "INSERT INTO lore.changelog_weeks (repo, week_key, intro, changes) VALUES ($1, '2026-W40', 'i', '[]')",
      [repo],
    ],
    [
      "INSERT INTO lore.digest_posts (run_id, repo, channel_id, week_key) VALUES ($2, $1, 'C1', '2026-W40')",
      [repo, randomUUID()],
    ],
    ["INSERT INTO lore.utopia_bases (name, kb_id) VALUES ($1, 'kb-1')", [repo]],
    [
      "INSERT INTO lore.utopia_kind_sources (repo, kind, kb_id, source_id, source_key) VALUES ($1, 'docs', 'kb', 's', 'k')",
      [repo],
    ],
    [
      "INSERT INTO lore.utopia_pushed_items (repo, path, external_ids) VALUES ($1, 'specs/a/spec.md', '{}')",
      [repo],
    ],
    [
      "INSERT INTO pipeline.ingest_state (repo, kind, commit_sha) VALUES ($1, 'specs', 'abc')",
      [repo],
    ],
    [
      `INSERT INTO pipeline.test_reports (repo, "commit", branch, tests, outcomes) VALUES ($1, 'abc', 'main', '[]', '{}')`,
      [repo],
    ],
  ];

  for (const [sql, params] of statements) {
    await pool.query(sql, params);
  }
}

describe.skipIf(!pg)("REPO_KEYED_TABLES", () => {
  it("covers every column of lore, pipeline, memory and team schemas that stores a repository's full name", async () => {
    const { rows } = await pool.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>(
      `SELECT c.table_schema, c.table_name, c.column_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE t.table_type = 'BASE TABLE'
          AND (c.table_schema IN ('lore', 'pipeline', 'memory')
               OR EXISTS (SELECT 1 FROM information_schema.tables ct
                           WHERE ct.table_schema = c.table_schema AND ct.table_name = 'chunks'))
          AND (c.column_name IN ('repo', 'repos', 'repo_full_name', 'repository', 'full_name', 'target_repo')
               OR c.column_name LIKE '%repo%')`,
    );
    const registered = new Set(
      REPO_KEYED_TABLES.flatMap((entry) =>
        entry.policy === "chunks"
          ? [`*.chunks.${entry.repoColumn}`]
          : [`${entry.schema}.${entry.table}.${entry.repoColumn}`],
      ),
    );
    const uncovered = rows
      .map((row) => `${row.table_schema}.${row.table_name}.${row.column_name}`)
      .filter(
        (column) =>
          !registered.has(column) &&
          !registered.has(`*.${column.split(".").slice(1).join(".")}`) &&
          !NOT_A_REPO_NAME_COLUMNS.includes(column),
      );

    expect(uncovered).toEqual([]);
  });
});

describe.skipIf(!pg)("absorbMirrorRow", () => {
  it("keeps the private repo's own release block, adds the mirror's slack_channel_id, drops the mirror's public_mirror and deletes the mirror row", async () => {
    const scene = await newScene();
    const settings = new PgSettings(pool);

    await pool.query(
      "UPDATE lore.repos SET settings = $2 WHERE full_name = $1",
      [
        scene.target,
        JSON.stringify({
          public_mirror: scene.mirror,
          release: { schedule: "weekly" },
        }),
      ],
    );
    await pool.query(
      "UPDATE lore.repos SET settings = $2 WHERE full_name = $1",
      [
        scene.mirror,
        JSON.stringify({
          public_mirror: "acme/other",
          release: { schedule: "daily" },
          slack_channel_id: "C99",
          auto_review: true,
        }),
      ],
    );

    await settings.absorbMirrorRow(scene.mirror, scene.target);

    expect({
      target: await settings.rawSettings(scene.target),
      mirrorRow: await settings.record(scene.mirror),
    }).toEqual({
      target: {
        public_mirror: scene.mirror,
        release: { schedule: "weekly" },
        slack_channel_id: "C99",
      },
      mirrorRow: null,
    });
  });
});

async function addLinkingRepo(
  scene: Scene,
  name: string,
  links: string[],
): Promise<string> {
  const fullName = `${scene.target.split("/")[0]}/${name}`;

  scene.others.push(fullName);
  await pool.query(
    "INSERT INTO lore.repos (owner, name, full_name, settings) VALUES ($1, $2, $3, $4)",
    [
      scene.target.split("/")[0],
      name,
      fullName,
      JSON.stringify({ cross_repo_repos: links }),
    ],
  );

  return fullName;
}

async function linksOf(repo: string): Promise<string[]> {
  const settings = new PgSettings(pool);
  const links = (await settings.rawSettings(repo))?.cross_repo_repos;

  return (links as string[]).toSorted();
}

describe.skipIf(!pg)("absorbMirrorRow cross-repo links", () => {
  it("points the links of acme-x/third at the private repo once, and drops the private repo's own link to the mirror", async () => {
    const scene = await newScene();
    const third = await addLinkingRepo(scene, "third", [
      "acme/other",
      scene.mirror,
    ]);
    const both = await addLinkingRepo(scene, "both", [
      scene.mirror,
      scene.target,
    ]);

    await pool.query(
      "UPDATE lore.repos SET settings = settings || $2 WHERE full_name = $1",
      [
        scene.target,
        JSON.stringify({ cross_repo_repos: ["acme/kept", scene.mirror] }),
      ],
    );
    await new PgSettings(pool).absorbMirrorRow(scene.mirror, scene.target);

    expect({
      third: await linksOf(third),
      both: await linksOf(both),
      private: await linksOf(scene.target),
    }).toEqual({
      third: ["acme/other", scene.target].toSorted(),
      both: [scene.target],
      private: ["acme/kept"],
    });
  });

  it("carries the mirror's links onto a private repo with none, minus the private repo's own name", async () => {
    const scene = await newScene();

    await pool.query(
      "UPDATE lore.repos SET settings = $2 WHERE full_name = $1",
      [
        scene.mirror,
        JSON.stringify({ cross_repo_repos: ["acme/linked", scene.target] }),
      ],
    );
    await new PgSettings(pool).absorbMirrorRow(scene.mirror, scene.target);

    expect(await linksOf(scene.target)).toEqual(["acme/linked"]);
  });
});
