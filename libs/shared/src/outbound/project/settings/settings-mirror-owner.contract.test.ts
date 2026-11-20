import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { InMemorySettings } from "./settings-memory.js";
import { PgSettings } from "./settings-pg.js";
import type { SettingsPort } from "./settings-port.js";

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
      `SELECT to_regclass('lore.repos') IS NOT NULL AS present`,
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
const pools: Pool[] = [];

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));

  if (!pg) {
    return;
  }
  const cleanup = new Pool(PG_CONFIG);

  await cleanup.query("DELETE FROM lore.repos WHERE owner = 'test-mirror'");
  await cleanup.end();
});

describe("the mirror lookup Postgres adapter is actually exercised", () => {
  it(
    pg
      ? "runs against a migrated Postgres"
      : `SKIPPED, ${pgProbe.why} (the double alone proves nothing about the SQL)`,
    () => {
      expect(pg || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(true);
    },
  );
});

type Seed = (repo: string, settings: Record<string, unknown>) => Promise<void>;

function contract(
  name: string,
  make: () => { port: SettingsPort; seed: Seed },
) {
  describe(`SettingsPort.mirrorOwner (${name})`, () => {
    const suffix = () => randomUUID().slice(0, 8);

    it("returns the private repo for its exact mirror name", async () => {
      const { port, seed } = make();
      const id = suffix();

      await seed(`test-mirror/private-${id}`, {
        public_mirror: `test-mirror-public/open-${id}`,
      });

      expect(await port.mirrorOwner(`test-mirror-public/open-${id}`)).toBe(
        `test-mirror/private-${id}`,
      );
    });

    it("returns the private repo for the mirror name in another case", async () => {
      const { port, seed } = make();
      const id = suffix();

      await seed(`test-mirror/private-${id}`, {
        public_mirror: `Test-Mirror-Public/Open-${id}`,
      });

      expect(await port.mirrorOwner(`TEST-MIRROR-PUBLIC/OPEN-${id}`)).toBe(
        `test-mirror/private-${id}`,
      );
    });

    it("returns null for a name no repo names as its mirror", async () => {
      const { port, seed } = make();
      const id = suffix();

      await seed(`test-mirror/plain-${id}`, { auto_review: true });

      expect(
        await port.mirrorOwner(`test-mirror-public/none-${id}`),
      ).toBeNull();
    });

    it("returns null for a repo whose settings are null", async () => {
      const { port, seed } = make();
      const id = suffix();

      await seed(`test-mirror/bare-${id}`, {});
      await port.updateSettings(
        `test-mirror/bare-${id}`,
        null as unknown as Record<string, unknown>,
      );

      expect(await port.mirrorOwner(`test-mirror/bare-${id}`)).toBeNull();
    });
  });
}

contract("in-memory", () => {
  const port = new InMemorySettings();

  return {
    port,
    seed: async (repo, settings) => {
      port.repos.push({ full_name: repo, settings });
    },
  };
});

if (pg) {
  contract("postgres", () => {
    const pool = new Pool(PG_CONFIG);

    pools.push(pool);

    return {
      port: new PgSettings(pool),
      seed: async (repo, settings) => {
        const [owner, name] = repo.split("/");

        await pool.query(
          "INSERT INTO lore.repos (owner, name, full_name, settings) VALUES ($1, $2, $3, $4)",
          [owner, name, repo, settings],
        );
      },
    };
  });
}

describe.skipIf(!pg)("lore.repos public_mirror unique index", () => {
  it("rejects with 23505 a second repo naming the mirror in another letter case and leaves the first as its owner", async () => {
    const pool = new Pool(PG_CONFIG);
    const id = randomUUID().slice(0, 8);
    const insert = (name: string, mirror: string) =>
      pool.query(
        "INSERT INTO lore.repos (owner, name, full_name, settings) VALUES ('test-mirror', $1, $2, $3)",
        [name, `test-mirror/${name}`, { public_mirror: mirror }],
      );

    await insert(`first-${id}`, `test-mirror-public/open-${id}`);
    const second = await insert(
      `second-${id}`,
      `TEST-MIRROR-PUBLIC/OPEN-${id}`,
    ).then(
      () => null,
      (error: { code?: string }) => error.code,
    );
    const owner = await new PgSettings(pool).mirrorOwner(
      `test-mirror-public/open-${id}`,
    );

    await pool.end();

    expect({ second, owner }).toEqual({
      second: "23505",
      owner: `test-mirror/first-${id}`,
    });
  });
});
