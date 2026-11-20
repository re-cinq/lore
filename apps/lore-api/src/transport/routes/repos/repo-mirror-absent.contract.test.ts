import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
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
import { getOnboardedReposWithCounts } from "../../../work/repo/repo-onboard.js";
import {
  handleFloorGitCredential,
  isOnboarded,
} from "../floor/git-credential.js";

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
const OWNER = "test-mirror-absent-api";

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
    await pool.query("DELETE FROM pipeline.tasks WHERE target_repo LIKE $1", [
      `${OWNER}/%`,
    ]);
    await pool.query("DELETE FROM lore.repos WHERE owner = $1", [OWNER]);
  }
  await pool.end();
});

describe("the mirror-absent API readers are actually exercised", () => {
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

const LOOPS_ON = {
  auto_review: true,
  implementation_loop: { enabled: true },
};

describe.skipIf(!pgReady)("a mirror is absent from API repo readers", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  interface RepoRow {
    fullName: string;
    settings: Record<string, unknown>;
    onboardingMerged: boolean;
    onboardingPrUrl?: string;
  }

  const insertRepo = ({
    fullName,
    settings,
    onboardingMerged,
    onboardingPrUrl,
  }: RepoRow) =>
    pool.query(
      "INSERT INTO lore.repos (owner, name, full_name, settings, onboarding_pr_merged, onboarding_pr_url) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        OWNER,
        fullName.split("/")[1],
        fullName,
        settings,
        onboardingMerged,
        onboardingPrUrl ?? null,
      ],
    );

  async function seedPair({ named }: { named: boolean }) {
    const id = randomUUID().slice(0, 8);
    const privateRepo = `${OWNER}/private-${id}`;
    const mirror = `${OWNER}/public-${id}`;

    await insertRepo({
      fullName: privateRepo,
      settings: named ? { ...LOOPS_ON, public_mirror: mirror } : LOOPS_ON,
      onboardingMerged: true,
    });
    await insertRepo({
      fullName: mirror,
      settings: LOOPS_ON,
      onboardingMerged: true,
    });

    return { id, privateRepo, mirror };
  }

  const namesWith = (id: string, names: string[]) =>
    names.filter((name) => name.endsWith(`-${id}`)).sort();

  async function listedRepos(id: string): Promise<string[]> {
    const { repos } = await getOnboardedReposWithCounts(pool, 10000, 0);

    return namesWith(
      id,
      repos.map((repo) => repo.fullName),
    );
  }

  it("lists only the private repo in the repo list when its mirror is fully onboarded", async () => {
    const { id, privateRepo } = await seedPair({ named: true });

    expect(await listedRepos(id)).toEqual([privateRepo]);
  });

  it("lists both repos in the repo list when no repo names the second as its mirror", async () => {
    const { id, privateRepo, mirror } = await seedPair({ named: false });

    expect(await listedRepos(id)).toEqual([privateRepo, mirror].sort());
  });

  it("counts one fewer repo in the repo list total once a repo names a mirror", async () => {
    const before = (await getOnboardedReposWithCounts(pool, 1, 0)).total;

    await seedPair({ named: true });
    const after = (await getOnboardedReposWithCounts(pool, 1, 0)).total;

    expect(after - before).toBe(1);
  });

  it("answers 403 repo-not-onboarded and mints nothing for a fully onboarded mirror", async () => {
    const { mirror } = await seedPair({ named: true });
    const minted: string[] = [];
    const result = await handleFloorGitCredential(
      {
        tokens: ["floor-token"],
        mint: async (repo) => {
          minted.push(repo);

          return "ghs_fresh";
        },
        isOnboarded: (repo) => isOnboarded(pool, repo),
        audit: async () => undefined,
      },
      "floor-token",
      { repoUrl: `https://github.com/${mirror}`, access: "write" },
    );

    expect({ result, minted }).toEqual({
      result: { code: 403, body: { error: "repo-not-onboarded" } },
      minted: [],
    });
  });

  it("answers 200 for the same repo when no repo names it as its mirror", async () => {
    const { mirror } = await seedPair({ named: false });
    const result = await handleFloorGitCredential(
      {
        tokens: ["floor-token"],
        mint: async () => "ghs_fresh",
        isOnboarded: (repo) => isOnboarded(pool, repo),
        audit: async () => undefined,
      },
      "floor-token",
      { repoUrl: `https://github.com/${mirror}`, access: "write" },
    );

    expect(result.code).toBe(200);
  });

  it("answers 400 and writes no row and no task for POST /api/onboard of a mirror with no row", async () => {
    const id = randomUUID().slice(0, 8);
    const mirror = `${OWNER}/never-${id}`;

    await insertRepo({
      fullName: `${OWNER}/holder-${id}`,
      settings: { public_mirror: mirror },
      onboardingMerged: true,
    });
    const res = await buildServer(() => pool as never).inject({
      method: "POST",
      url: "/api/onboard",
      headers: AUTH,
      payload: JSON.stringify({ repo: mirror }),
    });
    const repoRows = await pool.query(
      "SELECT id FROM lore.repos WHERE full_name = $1",
      [mirror],
    );
    const taskRows = await pool.query(
      "SELECT id FROM pipeline.tasks WHERE target_repo = $1",
      [mirror],
    );

    expect(res.statusCode).toBe(400);
    expect(repoRows.rows).toHaveLength(0);
    expect(taskRows.rows).toHaveLength(0);
  });

  it("answers 400 and leaves onboarded_at and tasks alone for POST /api/onboard of an onboarded mirror", async () => {
    const { mirror } = await seedPair({ named: true });
    const stamp = async () =>
      (
        await pool.query(
          "SELECT onboarded_at::text AS at FROM lore.repos WHERE full_name = $1",
          [mirror],
        )
      ).rows[0];
    const before = await stamp();
    const res = await buildServer(() => pool as never).inject({
      method: "POST",
      url: "/api/onboard",
      headers: AUTH,
      payload: JSON.stringify({ repo: mirror, reonboard: true }),
    });

    const taskRows = await pool.query(
      "SELECT id FROM pipeline.tasks WHERE target_repo = $1",
      [mirror],
    );

    expect(res.statusCode).toBe(400);
    expect(taskRows.rows).toHaveLength(0);
    expect(await stamp()).toEqual(before);
  });

  it("leaves a mirror's open onboarding PR out of GET /api/inbox and keeps one nobody names", async () => {
    const id = randomUUID().slice(0, 8);
    const mirror = `${OWNER}/inbox-public-${id}`;
    const open = `${OWNER}/inbox-open-${id}`;
    const pendingPrUrl = (fullName: string) =>
      `https://example.test/${fullName}/pull/1`;

    await insertRepo({
      fullName: mirror,
      settings: {},
      onboardingMerged: false,
      onboardingPrUrl: pendingPrUrl(mirror),
    });
    await insertRepo({
      fullName: open,
      settings: {},
      onboardingMerged: false,
      onboardingPrUrl: pendingPrUrl(open),
    });
    await insertRepo({
      fullName: `${OWNER}/inbox-holder-${id}`,
      settings: { public_mirror: mirror },
      onboardingMerged: true,
    });
    const res = await buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/inbox",
      headers: AUTH,
    });
    const cards = (res.result as { items: { repo: string }[] }).items;

    expect(
      namesWith(
        id,
        cards.map((card) => card.repo),
      ),
    ).toEqual([open]);
  });
});
