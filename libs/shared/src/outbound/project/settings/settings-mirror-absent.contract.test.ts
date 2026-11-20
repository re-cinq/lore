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
const OWNER = "test-mirror-absent";

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

  await cleanup.query("DELETE FROM lore.repos WHERE owner = $1", [OWNER]);
  await cleanup.end();
});

describe("the mirror-absent readers Postgres adapter is actually exercised", () => {
  it(
    pg
      ? "runs against a migrated Postgres"
      : `SKIPPED, ${pgProbe.why} (the double alone proves nothing about the SQL)`,
    () => {
      expect(pg || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(true);
    },
  );
});

interface SeedRow {
  fullName: string;
  settings: Record<string, unknown>;
  merged: boolean;
  prUrl?: string;
}

type Seed = (row: SeedRow) => Promise<void>;

const LOOPS_ON = {
  auto_review: true,
  implementation_loop: { enabled: true },
  digest: { enabled: true },
};

function contract(
  name: string,
  make: () => { port: SettingsPort; seed: Seed },
) {
  describe(`readers that list or admit repos (${name})`, () => {
    async function seedPair(
      seed: Seed,
      { named }: { named: boolean },
    ): Promise<{ privateRepo: string; mirror: string; id: string }> {
      const id = randomUUID().slice(0, 8);
      const privateRepo = `${OWNER}/private-${id}`;
      const mirror = `${OWNER}/public-${id}`;

      await seed({
        fullName: privateRepo,
        merged: true,
        settings: named ? { ...LOOPS_ON, public_mirror: mirror } : LOOPS_ON,
      });
      await seed({
        fullName: mirror,
        merged: true,
        settings: LOOPS_ON,
      });

      return { privateRepo, mirror, id };
    }

    const ours = (names: string[], id: string) =>
      names.filter((candidate) => candidate.endsWith(`-${id}`)).sort();

    it("onboardedRepos lists only the private repo of a fully onboarded mirror pair", async () => {
      const { port, seed } = make();
      const { privateRepo, id } = await seedPair(seed, { named: true });

      expect(
        ours(
          (await port.onboardedRepos()).map((repo) => repo.full_name),
          id,
        ),
      ).toEqual([privateRepo]);
    });

    it("onboardedRepos lists both repos when no repo names the second as its mirror", async () => {
      const { port, seed } = make();
      const { privateRepo, mirror, id } = await seedPair(seed, {
        named: false,
      });

      expect(
        ours(
          (await port.onboardedRepos()).map((repo) => repo.full_name),
          id,
        ),
      ).toEqual([privateRepo, mirror].sort());
    });

    it("onboardedRepoSettings lists only the private repo of a fully onboarded mirror pair", async () => {
      const { port, seed } = make();
      const { privateRepo, id } = await seedPair(seed, { named: true });

      expect(
        ours(
          (await port.onboardedRepoSettings()).map((repo) => repo.full_name),
          id,
        ),
      ).toEqual([privateRepo]);
    });

    it("onboardedRepoSettings lists both repos when no repo names the second as its mirror", async () => {
      const { port, seed } = make();
      const { privateRepo, mirror, id } = await seedPair(seed, {
        named: false,
      });

      expect(
        ours(
          (await port.onboardedRepoSettings()).map((repo) => repo.full_name),
          id,
        ),
      ).toEqual([privateRepo, mirror].sort());
    });

    it("allRepos lists only the private repo of a mirror pair", async () => {
      const { port, seed } = make();
      const { privateRepo, id } = await seedPair(seed, { named: true });

      expect(ours(await port.allRepos(), id)).toEqual([privateRepo]);
    });

    it("allRepos lists both repos when no repo names the second as its mirror", async () => {
      const { port, seed } = make();
      const { privateRepo, mirror, id } = await seedPair(seed, {
        named: false,
      });

      expect(ours(await port.allRepos(), id)).toEqual(
        [privateRepo, mirror].sort(),
      );
    });

    it("isOnboarded is false for the mirror and true for its private repo", async () => {
      const { port, seed } = make();
      const { privateRepo, mirror } = await seedPair(seed, { named: true });

      expect({
        privateRepo: await port.isOnboarded(privateRepo),
        mirror: await port.isOnboarded(mirror),
      }).toEqual({ privateRepo: true, mirror: false });
    });

    it("isOnboarded is true for a repo no other repo names as its mirror", async () => {
      const { port, seed } = make();
      const { mirror } = await seedPair(seed, { named: false });

      expect(await port.isOnboarded(mirror)).toBe(true);
    });

    it("pendingOnboardingRepos leaves out a mirror whose onboarding PR is open", async () => {
      const { port, seed } = make();
      const id = randomUUID().slice(0, 8);
      const mirror = `${OWNER}/pending-public-${id}`;

      await seed({
        fullName: `${OWNER}/pending-private-${id}`,
        merged: true,
        settings: { public_mirror: mirror },
      });
      await seed({
        fullName: mirror,
        merged: false,
        settings: {},
        prUrl: `https://example.test/${id}/pull/1`,
      });

      expect(
        ours(
          (await port.pendingOnboardingRepos()).map((repo) => repo.full_name),
          id,
        ),
      ).toEqual([]);
    });

    it("pendingOnboardingRepos lists a repo with an open onboarding PR that no repo names as its mirror", async () => {
      const { port, seed } = make();
      const id = randomUUID().slice(0, 8);
      const open = `${OWNER}/pending-open-${id}`;

      await seed({
        fullName: open,
        merged: false,
        settings: {},
        prUrl: `https://example.test/${id}/pull/1`,
      });

      expect(
        ours(
          (await port.pendingOnboardingRepos()).map((repo) => repo.full_name),
          id,
        ),
      ).toEqual([open]);
    });

    it("record, rawSettings and mirrorOwner still see the mirror's own row", async () => {
      const { port, seed } = make();
      const { privateRepo, mirror } = await seedPair(seed, { named: true });

      expect({
        record: (await port.record(mirror))?.fullName,
        rawSettings: await port.rawSettings(mirror),
        mirrorOwner: await port.mirrorOwner(mirror),
      }).toEqual({
        record: mirror,
        rawSettings: LOOPS_ON,
        mirrorOwner: privateRepo,
      });
    });

    it("lists a mirror again once its owner stops naming it", async () => {
      const { port, seed } = make();
      const { privateRepo, mirror, id } = await seedPair(seed, { named: true });

      await port.updateSettings(privateRepo, LOOPS_ON);

      expect(ours(await port.allRepos(), id)).toEqual(
        [privateRepo, mirror].sort(),
      );
    });
  });
}

contract("in-memory", () => {
  const port = new InMemorySettings();

  return {
    port,
    seed: async ({ fullName, settings, merged, prUrl }) => {
      port.repos.push({
        full_name: fullName,
        settings,
        onboarding_pr_merged: merged,
        onboarding_pr_url: prUrl ?? null,
      });
    },
  };
});

if (pg) {
  contract("postgres", () => {
    const pool = new Pool(PG_CONFIG);

    pools.push(pool);

    return {
      port: new PgSettings(pool),
      seed: async ({ fullName, settings, merged, prUrl }) => {
        const [owner, name] = fullName.split("/");

        await pool.query(
          "INSERT INTO lore.repos (owner, name, full_name, settings, onboarding_pr_merged, onboarding_pr_url) VALUES ($1, $2, $3, $4, $5, $6)",
          [owner, name, fullName, settings, merged, prUrl ?? null],
        );
      },
    };
  });
}
