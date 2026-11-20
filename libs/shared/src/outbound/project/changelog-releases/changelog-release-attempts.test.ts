import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemoryChangelogReleases } from "./changelog-releases-memory.js";
import { PgChangelogReleases } from "./changelog-releases-pg.js";
import type { ChangelogReleasesPort } from "./changelog-releases-port.js";

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
      `SELECT to_regclass('lore.release_schedule_attempts') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : {
          ok: false,
          why: "lore.release_schedule_attempts is absent, migrations not applied",
        };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();

describe("the release schedule attempts Postgres adapter is actually exercised", () => {
  it(
    pg.ok
      ? "runs against a migrated Postgres"
      : `SKIPPED, ${pg.why} (the double alone proves nothing about the SQL)`,
    () => {
      expect(pg.ok || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(true);
    },
  );
});

interface Subject {
  port: ChangelogReleasesPort;
  repo: string;
}

const pool = pg.ok ? new Pool(PG_CONFIG) : null;
const pgRepos: string[] = [];

afterAll(async () => {
  if (pool) {
    await pool.query(
      `DELETE FROM lore.release_schedule_attempts WHERE repo = ANY($1)`,
      [pgRepos],
    );
    await pool.end();
  }
});

const IMPLEMENTATIONS: Array<[string, () => Subject]> = [
  [
    "in-memory",
    () => ({ port: new InMemoryChangelogReleases(), repo: "re-cinq/lore" }),
  ],
];

if (pool) {
  IMPLEMENTATIONS.push([
    "postgres",
    () => {
      const repo = `re-cinq/contract-${randomUUID()}`;

      pgRepos.push(repo);

      return { port: new PgChangelogReleases(pool), repo };
    },
  ]);
}

describe.each(IMPLEMENTATIONS)(
  "ChangelogReleasesPort scheduled attempts (%s)",
  (_name, make) => {
    it("answers null as the last scheduled attempt of a repo never attempted", async () => {
      const { port, repo } = make();

      expect(await port.lastScheduledAttempt(repo)).toBeNull();
    });

    it("answers 2026-11-20T09:15:00.123Z after that instant was marked", async () => {
      const { port, repo } = make();

      await port.markScheduledAttempt(
        repo,
        new Date("2026-11-20T09:15:00.123Z"),
      );

      expect(await port.lastScheduledAttempt(repo)).toEqual(
        new Date("2026-11-20T09:15:00.123Z"),
      );
    });

    it("answers 2026-11-21T09:00:00.000Z after 2026-11-20 and then 2026-11-21 were marked", async () => {
      const { port, repo } = make();

      await port.markScheduledAttempt(
        repo,
        new Date("2026-11-20T09:15:00.000Z"),
      );
      await port.markScheduledAttempt(
        repo,
        new Date("2026-11-21T09:00:00.000Z"),
      );

      expect(await port.lastScheduledAttempt(repo)).toEqual(
        new Date("2026-11-21T09:00:00.000Z"),
      );
    });

    it("answers null for a second repo when only the first was marked", async () => {
      const { port, repo } = make();

      await port.markScheduledAttempt(
        repo,
        new Date("2026-11-20T09:15:00.000Z"),
      );

      expect(await port.lastScheduledAttempt(`${repo}-other`)).toBeNull();
    });
  },
);
