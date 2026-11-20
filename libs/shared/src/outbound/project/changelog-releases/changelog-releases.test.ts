import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { InMemoryChangelogReleases } from "./changelog-releases-memory.js";
import { PgChangelogReleases } from "./changelog-releases-pg.js";
import type {
  ChangelogReleasesPort,
  ChangelogReleaseWrite,
} from "./changelog-releases-port.js";

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
      `SELECT to_regclass('lore.changelog_releases') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : {
          ok: false,
          why: "lore.changelog_releases is absent, migrations not applied",
        };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();

describe("the changelog releases Postgres adapter is actually exercised", () => {
  it(
    pg.ok
      ? "runs against a migrated Postgres"
      : `SKIPPED, ${pg.why} (the double alone proves nothing about the SQL)`,
    () => {
      expect(pg.ok || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(true);
    },
  );
});

const release = (
  version: string,
  overrides: Partial<ChangelogReleaseWrite> = {},
): ChangelogReleaseWrite => ({
  repo: "re-cinq/lore",
  version,
  previousTag: null,
  sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  bump: "minor",
  rangeFrom: null,
  rangeTo: new Date("2026-11-20T09:30:15.123Z"),
  summary: "Adds the release store.",
  changes: [],
  releaseUrl: null,
  publishedTo: null,
  ...overrides,
});

const endOf = (day: string) => new Date(`2026-11-${day}T09:30:15.123Z`);

interface Subject {
  port: ChangelogReleasesPort;
  repo: string;
}

const pool = pg.ok ? new Pool(PG_CONFIG) : null;
const pgRepos: string[] = [];

afterAll(async () => {
  if (pool) {
    await pool.query(
      `DELETE FROM lore.changelog_releases WHERE repo = ANY($1)`,
      [pgRepos],
    );
    await pool.end();
  }
});

const IMPLEMENTATIONS: Array<[string, () => Subject]> = [
  [
    "in-memory",
    () => {
      let tick = Date.parse("2026-11-20T10:00:00Z");

      return {
        port: new InMemoryChangelogReleases(() => new Date((tick += 1000))),
        repo: "re-cinq/lore",
      };
    },
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
  "ChangelogReleasesPort contract (%s)",
  (_name, make) => {
    it("reads back v1.3.0 with its change, bump and no announcement", async () => {
      const { port, repo } = make();
      const changes = [
        {
          kind: "pr" as const,
          number: 4999,
          title: "Add the release store",
          url: "https://github.com/re-cinq/lore/pull/4999",
          people: ["gedaiu"],
          at: "2026-11-19T09:00:00.000Z",
        },
      ];

      await port.upsert(
        release("v1.3.0", {
          repo,
          previousTag: "v1.2.4",
          bump: "minor",
          rangeFrom: new Date("2026-11-13T09:30:15.456Z"),
          changes,
          releaseUrl: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
          publishedTo: "re-cinq/lore-public",
        }),
      );

      expect(await port.latest(repo)).toEqual({
        ...release("v1.3.0", {
          repo,
          previousTag: "v1.2.4",
          rangeFrom: new Date("2026-11-13T09:30:15.456Z"),
          changes,
          releaseUrl: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
          publishedTo: "re-cinq/lore-public",
        }),
        announcedAt: null,
        slackTs: null,
        writtenAt: expect.any(Date),
      });
    });

    it("answers null as the latest release of a repo with none", async () => {
      const { port, repo } = make();

      expect(await port.latest(repo)).toBeNull();
    });

    it("keeps one row for v1.3.0 written twice, the last summary winning", async () => {
      const { port, repo } = make();

      await port.upsert(release("v1.3.0", { repo, summary: "first" }));
      await port.upsert(release("v1.3.0", { repo, summary: "second" }));

      expect(
        (await port.page(repo, { limit: 10 })).map((row) => row.summary),
      ).toEqual(["second"]);
    });

    it("answers v1.2.1, whose range ends 2026-11-20, as the latest over v1.3.0 ending 2026-11-17 and v1.2.0 ending 2026-11-10", async () => {
      const { port, repo } = make();

      await port.upsert(release("v1.2.0", { repo, rangeTo: endOf("10") }));
      await port.upsert(release("v1.3.0", { repo, rangeTo: endOf("17") }));
      await port.upsert(release("v1.2.1", { repo, rangeTo: endOf("20") }));

      expect((await port.latest(repo))?.version).toBe("v1.2.1");
    });

    it("pages by the end of the range, before v1.3.0's end 2026-11-17 giving v1.2.0 then v1.1.0", async () => {
      const { port, repo } = make();
      const days = {
        "v1.0.0": "03",
        "v1.1.0": "10",
        "v1.2.0": "13",
        "v1.3.0": "17",
      };

      for (const [version, day] of Object.entries(days).reverse()) {
        await port.upsert(release(version, { repo, rangeTo: endOf(day) }));
      }

      expect(
        (await port.page(repo, { before: endOf("17"), limit: 2 })).map(
          (row) => row.version,
        ),
      ).toEqual(["v1.2.0", "v1.1.0"]);
    });

    it("keeps the repos apart, v1.0.0 of another repo not appearing in this one's page", async () => {
      const { port, repo } = make();
      const other = make();

      await port.upsert(release("v1.0.0", { repo }));
      await other.port.upsert(release("v2.0.0", { repo: other.repo }));

      expect(
        (await port.page(repo, { limit: 10 })).map((row) => row.version),
      ).toEqual(["v1.0.0"]);
    });

    it("claims the announcement of v1.3.0 once and answers false the second time", async () => {
      const { port, repo } = make();

      await port.upsert(release("v1.3.0", { repo }));

      expect([
        await port.claimAnnouncement(repo, "v1.3.0"),
        await port.claimAnnouncement(repo, "v1.3.0"),
      ]).toEqual([true, false]);
    });

    it("stamps announcedAt on v1.3.0 once claimed", async () => {
      const { port, repo } = make();

      await port.upsert(release("v1.3.0", { repo }));
      await port.claimAnnouncement(repo, "v1.3.0");

      expect((await port.latest(repo))?.announcedAt).toEqual(expect.any(Date));
    });

    it("answers false when claiming the announcement of v9.9.9, which was never written", async () => {
      const { port, repo } = make();

      expect(await port.claimAnnouncement(repo, "v9.9.9")).toBe(false);
    });

    it("keeps the claim when v1.3.0 is written again after being announced", async () => {
      const { port, repo } = make();

      await port.upsert(release("v1.3.0", { repo }));
      await port.claimAnnouncement(repo, "v1.3.0");
      await port.upsert(release("v1.3.0", { repo, summary: "rerun" }));

      expect(await port.claimAnnouncement(repo, "v1.3.0")).toBe(false);
    });

    it("answers v1.3.0, v1.2.0 and v1.1.0 in version order descending when all three end 2026-11-20", async () => {
      const { port, repo } = make();

      for (const version of ["v1.1.0", "v1.3.0", "v1.2.0"]) {
        await port.upsert(release(version, { repo, rangeTo: endOf("20") }));
      }

      expect(
        (await port.page(repo, { limit: 10 })).map((row) => row.version),
      ).toEqual(["v1.3.0", "v1.2.0", "v1.1.0"]);
    });

    it("keeps the first write time of v1.3.0 when it is written again", async () => {
      const { port, repo } = make();

      await port.upsert(release("v1.3.0", { repo, summary: "first" }));
      const firstWrite = (await port.latest(repo))?.writtenAt;

      await port.upsert(release("v1.3.0", { repo, summary: "second" }));

      expect(await port.latest(repo)).toMatchObject({
        summary: "second",
        writtenAt: firstWrite,
      });
    });
  },
);
