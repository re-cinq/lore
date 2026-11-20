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

  await cleanup.query("DELETE FROM lore.repos WHERE owner = 'test-mirror-rn'");
  await cleanup.end();
});

describe("the mirror rename Postgres adapter is actually exercised", () => {
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
  describe(`SettingsPort.renameRepo repoints public_mirror (${name})`, () => {
    const suffix = () => randomUUID().slice(0, 8);

    it("points the private repo's public_mirror at the new name when the public repo is renamed, matching the old name in another letter case", async () => {
      const { port, seed } = make();
      const id = suffix();

      await seed(`test-mirror-rn/private-${id}`, {
        public_mirror: `Test-Mirror-Rn-Public/Open-${id}`,
        auto_review: true,
      });

      const outcome = await port.renameRepo(
        `test-mirror-rn-public/open-${id}`,
        `test-mirror-rn-public/renamed-${id}`,
      );

      expect({
        outcome,
        settings: await port.rawSettings(`test-mirror-rn/private-${id}`),
      }).toEqual({
        outcome: "absent",
        settings: {
          public_mirror: `test-mirror-rn-public/renamed-${id}`,
          auto_review: true,
        },
      });
    });

    it("leaves public_mirror as it is when an unrelated repo is renamed", async () => {
      const { port, seed } = make();
      const id = suffix();

      await seed(`test-mirror-rn/private-${id}`, {
        public_mirror: `test-mirror-rn-public/open-${id}`,
      });
      await seed(`test-mirror-rn/other-${id}`, {});

      await port.renameRepo(
        `test-mirror-rn/other-${id}`,
        `test-mirror-rn/other-renamed-${id}`,
      );

      expect(await port.rawSettings(`test-mirror-rn/private-${id}`)).toEqual({
        public_mirror: `test-mirror-rn-public/open-${id}`,
      });
    });

    it("leaves a repo with no public_mirror without one when the public repo is renamed", async () => {
      const { port, seed } = make();
      const id = suffix();

      await seed(`test-mirror-rn/plain-${id}`, { auto_review: true });

      await port.renameRepo(
        `test-mirror-rn-public/open-${id}`,
        `test-mirror-rn-public/renamed-${id}`,
      );

      expect(await port.rawSettings(`test-mirror-rn/plain-${id}`)).toEqual({
        auto_review: true,
      });
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
