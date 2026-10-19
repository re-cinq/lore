import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { enforceTrue } from "../../../lib/enforce.js";
import { hybridChunkSearch } from "./context-assembly-chunk-search.js";

const SCHEMA = `hybrid_leg_${randomBytes(4).toString("hex")}`;
const DIMS = 768;
const CODE_CHUNKS = 3000;
const ADR_CHUNKS = 6;

vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: vi.fn(async () => Array(DIMS).fill(1)),
}));

vi.mock("../chunks/chunk-schema.js", () => ({
  resolveChunkSchemaForRepo: vi.fn(async () => SCHEMA),
}));

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
};

const literal = (v: number[]) => `[${v.join(",")}]`;

async function pgAvailable(): Promise<{ ok: boolean; why: string }> {
  let probe: Pool | undefined;

  try {
    probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });

    await probe.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    return { ok: true, why: "" };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();
const pool = new Pool({
  ...PG_CONFIG,
  options: "-c enable_seqscan=off -c enable_bitmapscan=off",
});

async function seed(): Promise<void> {
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE ${SCHEMA}.chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content TEXT NOT NULL,
      embedding VECTOR(${DIMS}),
      content_type TEXT,
      repo TEXT,
      file_path TEXT,
      ingested_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB,
      search_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
    )`);

  const rand = seeded(2386);
  const code = Array.from({ length: CODE_CHUNKS }, () =>
    literal(noisy(rand, 0.3)),
  );
  const adr = Array.from({ length: ADR_CHUNKS }, () => literal(noisy(rand, 1)));

  await pool.query(
    `INSERT INTO ${SCHEMA}.chunks (content, embedding, content_type, repo, file_path)
     SELECT 'alpha bravo', e::vector, 'code', 'octo/big', 'src/f' || n
     FROM unnest($1::text[]) WITH ORDINALITY AS t(e, n)`,
    [code],
  );
  await pool.query(
    `INSERT INTO ${SCHEMA}.chunks (content, embedding, content_type, repo, file_path)
     SELECT 'charlie delta', e::vector, 'adr', 'octo/big', 'adrs/' || n || '.md'
     FROM unnest($1::text[]) WITH ORDINALITY AS t(e, n)`,
    [adr],
  );
  await pool.query(
    `CREATE INDEX ON ${SCHEMA}.chunks USING hnsw (embedding vector_cosine_ops)`,
  );
  await pool.query(`ANALYZE ${SCHEMA}.chunks`);
}

function noisy(rand: () => number, spread: number): number[] {
  return Array.from({ length: DIMS }, () => 1 + spread * (rand() - 0.5));
}

function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(async () => {
  enforceTrue(
    !(!pg.ok && process.env.LORE_REQUIRE_PG_CONTRACT === "1"),
    Error,
    `Postgres contract required but ${pg.why}`,
  );

  if (pg.ok) {
    await seed();
  }
});

afterAll(async () => {
  if (pg.ok) {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  }

  await pool.end();
});

describe.skipIf(!pg.ok)("hybrid chunk search against real pgvector", () => {
  it("the vector leg returns the few adr chunks among thousands of nearer code chunks", async () => {
    const { items: chunks, vectorLegRows } = await hybridChunkSearch(
      pool as never,
      "unrelated phrasing",
      "octo/big",
      { contentTypes: ["adr"], limit: 10 },
    );

    expect(vectorLegRows).toBe(ADR_CHUNKS);
    expect(chunks.map((i) => i.content_type)).toEqual(
      Array(ADR_CHUNKS).fill("adr"),
    );
  });

  it("scopes the wide scan to the search's own transaction", async () => {
    await hybridChunkSearch(pool as never, "unrelated phrasing", "octo/big", {
      contentTypes: ["adr"],
      limit: 10,
    });

    const { rows } = await pool.query<{ ef: string | null }>(
      `SELECT current_setting('hnsw.ef_search', true) AS ef`,
    );

    expect(rows[0].ef).not.toBe("200");
  });
});
