import { describe, it, expect, afterAll } from "vitest";
import { randomInt } from "node:crypto";
import { Pool } from "pg";
import { InMemoryGithubInstallations } from "./github-installations-memory.js";
import { PgGithubInstallations } from "./github-installations-pg.js";
import type {
  GithubInstallationsRepository,
  UpsertGithubInstallationInput,
} from "./github-installations-port.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");
const WIDENED_AT = new Date("2026-09-11T09:30:00.000Z");

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
};

async function pgAvailable(): Promise<{ ok: boolean; why: string }> {
  let probe: Pool | undefined;

  try {
    probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });
    const { rows } = await probe.query<{ present: boolean }>(
      `SELECT to_regclass('lore.github_installations') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : {
          ok: false,
          why: "lore.github_installations is absent — migrations not applied",
        };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();
const pool = pg.ok ? new Pool(PG_CONFIG) : undefined;
const pgInstallationIds: string[] = [];

afterAll(async () => {
  await pool?.query(
    "DELETE FROM lore.github_installations WHERE installation_id = ANY($1::bigint[])",
    [pgInstallationIds],
  );
  await pool?.end();
});

describe("the Postgres implementation is actually exercised", () => {
  it(
    pg.ok
      ? "runs against a migrated Postgres"
      : `SKIPPED — ${pg.why} (in-memory alone proves nothing about the SQL)`,
    () => {
      expect(pg.ok || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(true);
    },
  );
});

interface Scope {
  port: GithubInstallationsRepository;
  clock: { now: Date };
  suffix: string;
  account: (base: string) => UpsertGithubInstallationInput;
}

function scope(
  build: (now: () => Date) => GithubInstallationsRepository,
  created: string[],
): Scope {
  const clock = { now: INSTALLED_AT };
  const suffix = randomInt(1e9).toString(36);

  return {
    port: build(() => clock.now),
    clock,
    suffix,
    account: (base) => {
      const installationId = String(randomInt(1e9, 2 ** 47));

      created.push(installationId);

      return {
        installationId,
        accountLogin: `${base}-${suffix}`,
        accountType: "Organization",
        repositorySelection: "selected",
        suspendedAt: null,
      };
    },
  };
}

const IMPLEMENTATIONS: Array<[string, () => Scope]> = [
  ["in-memory", () => scope((now) => new InMemoryGithubInstallations(now), [])],
];

if (pool) {
  IMPLEMENTATIONS.push([
    "postgres",
    () =>
      scope((now) => new PgGithubInstallations(pool, now), pgInstallationIds),
  ]);
}

describe.each(IMPLEMENTATIONS)(
  "GithubInstallationsRepository contract (%s)",
  (_name, make) => {
    it("finds the re-cinq installation by its account login in any case", async () => {
      const { port, account } = make();
      const reCinq = account("re-cinq");

      await port.upsert(reCinq);

      expect(
        await port.findByAccount(reCinq.accountLogin.toUpperCase()),
      ).toEqual({
        ...reCinq,
        installedAt: INSTALLED_AT,
        updatedAt: INSTALLED_AT,
      });
    });

    it("keeps when re-cinq was installed when the installation widens to all repos", async () => {
      const { port, clock, account } = make();
      const reCinq = account("re-cinq");

      await port.upsert(reCinq);
      clock.now = WIDENED_AT;
      await port.upsert({ ...reCinq, repositorySelection: "all" });

      expect(await port.findByAccount(reCinq.accountLogin)).toEqual({
        ...reCinq,
        repositorySelection: "all",
        installedAt: INSTALLED_AT,
        updatedAt: WIDENED_AT,
      });
    });

    it("forgets the re-cinq installation once the App is uninstalled there", async () => {
      const { port, account } = make();
      const reCinq = account("re-cinq");

      await port.upsert(reCinq);
      await port.remove(reCinq.installationId);

      expect(await port.findByAccount(reCinq.accountLogin)).toBeNull();
    });

    it("lists acme-corp before re-cinq, ordered by account login", async () => {
      const { port, suffix, account } = make();

      await port.upsert(account("re-cinq"));
      await port.upsert(account("acme-corp"));

      expect(
        (await port.list())
          .map((installation) => installation.accountLogin)
          .filter((login) => login.endsWith(`-${suffix}`)),
      ).toEqual([`acme-corp-${suffix}`, `re-cinq-${suffix}`]);
    });
  },
);
