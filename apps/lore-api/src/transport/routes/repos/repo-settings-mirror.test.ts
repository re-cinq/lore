import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Pool } from "pg";
import { buildServer } from "../../../app/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({
    repo: { defaultBranch: async () => "main" },
    pulls: { getBranchRule: async () => null },
  })),
}));

vi.mock("../../../outbound/github-client.js", () => ({
  getOctokit: vi.fn(),
  isAppConfigured: vi.fn().mockReturnValue(true),
}));

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "lore",
  user: process.env.PGUSER ?? "lore",
  password: process.env.PGPASSWORD ?? "lore",
};
const OWNER = "test-mirror-route";

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
const pgReady = pgProbe.ok;
const pool = new Pool(PG_CONFIG);
const originalEnv = { ...process.env };

afterAll(async () => {
  if (pgReady) {
    await pool.query("DELETE FROM lore.repos WHERE owner = $1", [OWNER]);
  }
  await pool.end();
});

describe("the settings route mirror checks are actually exercised", () => {
  it(
    pgReady
      ? "runs against a migrated Postgres"
      : `SKIPPED, ${pgProbe.why} (a mocked pool proves nothing about the SQL)`,
    () => {
      expect(pgReady || process.env.LORE_REQUIRE_PG_CONTRACT !== "1").toBe(
        true,
      );
    },
  );
});

describe.skipIf(!pgReady)(
  "PUT /api/repos/{owner}/{repo}/settings mirror and release",
  () => {
    useRateLimitSafeClock();
    beforeEach(() => {
      process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    });
    afterEach(() => {
      process.env = { ...originalEnv };
    });

    const server = () => buildServer(() => pool as never);

    async function seed(
      settings: Record<string, unknown> = {},
    ): Promise<string> {
      const name = `repo-${randomUUID().slice(0, 8)}`;

      await pool.query(
        "INSERT INTO lore.repos (owner, name, full_name, settings) VALUES ($1, $2, $3, $4)",
        [OWNER, name, `${OWNER}/${name}`, settings],
      );

      return `${OWNER}/${name}`;
    }

    async function put(repo: string, settings: Record<string, unknown>) {
      const before = await storedSettings(repo);
      const res = await server().inject({
        method: "PUT",
        url: `/api/repos/${repo}/settings`,
        headers: AUTH,
        payload: JSON.stringify({ settings }),
      });
      const stored = await storedSettings(repo);

      return {
        status: res.statusCode,
        error: (res.result as { error?: string }).error,
        stored,
        changedKeys: Object.keys({ ...before, ...stored }).filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(stored[key]),
        ),
      };
    }

    async function storedSettings(
      repo: string,
    ): Promise<Record<string, unknown>> {
      const { rows } = await pool.query(
        "SELECT settings FROM lore.repos WHERE full_name = $1",
        [repo],
      );

      return rows[0].settings;
    }

    it("stores public_mirror re-cinq/lore-public for a repo with no mirror and no chain", async () => {
      const repo = await seed();
      const mirror = `${OWNER}-public/open-${randomUUID().slice(0, 8)}`;

      expect(await put(repo, { public_mirror: mirror })).toMatchObject({
        status: 200,
        stored: { public_mirror: mirror },
      });
    });

    it("returns 400 for a repo naming itself in another case as its mirror", async () => {
      const repo = await seed();

      expect(
        await put(repo, { public_mirror: repo.toUpperCase() }),
      ).toMatchObject({
        status: 400,
        error: "public_mirror cannot be the repo itself",
        changedKeys: [],
      });
    });

    it("returns 400 for a mirror that is not owner/name", async () => {
      const repo = await seed();

      expect(await put(repo, { public_mirror: "lore" })).toMatchObject({
        status: 400,
        error: "public_mirror must be owner/name",
        changedKeys: [],
      });
    });

    it("returns 400 for a repo that is already the mirror of another", async () => {
      const repo = await seed();
      const privateRepo = await seed({ public_mirror: repo });

      expect(
        await put(repo, {
          public_mirror: `${OWNER}-public/x-${randomUUID().slice(0, 8)}`,
        }),
      ).toMatchObject({
        status: 400,
        error: `${repo} is already the public mirror of ${privateRepo}`,
        changedKeys: [],
      });
    });

    it("returns 400 for a mirror that has a public_mirror of its own", async () => {
      const mirror = await seed({
        public_mirror: `${OWNER}-public/y-${randomUUID().slice(0, 8)}`,
      });
      const repo = await seed();

      expect(await put(repo, { public_mirror: mirror })).toMatchObject({
        status: 400,
        error: `${mirror} has a public mirror of its own`,
        changedKeys: [],
      });
    });

    it("returns 400 for a mirror that another repo already publishes to", async () => {
      const mirror = `${OWNER}-public/z-${randomUUID().slice(0, 8)}`;
      const firstOwner = await seed({ public_mirror: mirror });
      const repo = await seed();

      expect(
        await put(repo, { public_mirror: mirror.toUpperCase() }),
      ).toMatchObject({
        status: 400,
        error: `${mirror.toUpperCase()} is already the public mirror of ${firstOwner}`,
        changedKeys: [],
      });
    });

    it("returns 200 when a repo saves the mirror it already has", async () => {
      const mirror = `${OWNER}-public/w-${randomUUID().slice(0, 8)}`;
      const repo = await seed({ public_mirror: mirror });

      expect((await put(repo, { public_mirror: mirror })).status).toBe(200);
    });

    it("clears public_mirror when null is sent", async () => {
      const repo = await seed({
        public_mirror: `${OWNER}-public/v-${randomUUID().slice(0, 8)}`,
      });

      expect(await put(repo, { public_mirror: null })).toMatchObject({
        status: 200,
        stored: { public_mirror: null },
      });
    });

    it("returns 400 for a release block with the timezone Mars/Olympus_Mons", async () => {
      const repo = await seed();

      expect(
        await put(repo, {
          release: { enabled: true, timezone: "Mars/Olympus_Mons" },
        }),
      ).toMatchObject({
        status: 400,
        error: "invalid release settings: timezone not an IANA timezone",
        changedKeys: [],
      });
    });

    it("returns 400 for a release block with a weekday of 8", async () => {
      const repo = await seed();

      expect(await put(repo, { release: { days: [8] } })).toMatchObject({
        status: 400,
        changedKeys: [],
      });
    });

    it("merges the release block key by key, keeping enabled when time is saved", async () => {
      const repo = await seed({ release: { enabled: true, days: [5] } });

      expect(await put(repo, { release: { time: "17:00" } })).toMatchObject({
        status: 200,
        stored: { release: { enabled: true, days: [5], time: "17:00" } },
      });
    });

    it("leaves a repo with neither block exactly as saved before", async () => {
      const repo = await seed({ auto_review: true });

      expect(await put(repo, { trust: { level: "tests" } })).toMatchObject({
        status: 200,
        stored: { auto_review: true, trust: { level: "tests" } },
        changedKeys: ["trust"],
      });
    });
  },
);
