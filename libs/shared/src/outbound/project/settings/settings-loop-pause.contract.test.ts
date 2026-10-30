import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { enforceTrue } from "../../../lib/enforce.js";
import { loopPause } from "../../../domain/loops/loop-pause.js";
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
  let probe: Pool | undefined;

  try {
    probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });

    const { rows } = await probe.query<{ present: boolean }>(
      `SELECT to_regclass('lore.repos') IS NOT NULL AS present`,
    );

    return rows[0]?.present
      ? { ok: true, why: "" }
      : { ok: false, why: "lore.repos is absent — schema not applied" };
  } catch (err) {
    return { ok: false, why: `unreachable: ${(err as Error).message}` };
  } finally {
    await probe?.end();
  }
}

const pg = await pgAvailable();
const pools: Pool[] = [];

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
});

describe("the Postgres loop pause contract is actually exercised", () => {
  it("runs the Postgres contract, or explains why it is skipped", () => {
    enforceTrue(
      !(!pg.ok && process.env.LORE_REQUIRE_PG_CONTRACT === "1"),
      Error,
      `Postgres contract required but ${pg.why}`,
    );

    expect(pg.ok || pg.why.length > 0).toBe(true);
  });
});

const creditPause = {
  reason: "model credit exhausted",
  run_id: "run-1",
  at: "2026-10-30T10:00:00.000Z",
  until: null,
};

type Seed = (repo: string, settings: Record<string, unknown>) => Promise<void>;

function contract(
  name: string,
  make: () => { port: SettingsPort; seed: Seed },
) {
  describe(`SettingsPort loop pauses (${name})`, () => {
    const newRepo = () => `test-pause/${randomUUID().slice(0, 8)}`;

    it("stores the implementation pause and keeps the switch and other settings", async () => {
      const { port, seed } = make();
      const repo = newRepo();

      await seed(repo, { implementation_loop: { enabled: true }, trust: "x" });
      await port.pauseLoop(repo, "implementation", creditPause);

      expect(await port.rawSettings(repo)).toMatchObject({
        implementation_loop: { enabled: true },
        trust: "x",
        loop_pauses: { implementation: creditPause },
      });
    });

    it("keeps the review pause when the triage loop pauses too", async () => {
      const { port, seed } = make();
      const repo = newRepo();

      await seed(repo, {});
      await port.pauseLoop(repo, "review", creditPause);
      await port.pauseLoop(repo, "triage", { ...creditPause, run_id: "run-2" });

      const settings = await port.rawSettings(repo);

      expect(loopPause("review", settings)).toEqual(creditPause);
      expect(loopPause("triage", settings)?.run_id).toBe("run-2");
    });

    it("forgets only the resumed loop's pause", async () => {
      const { port, seed } = make();
      const repo = newRepo();

      await seed(repo, {});
      await port.pauseLoop(repo, "review", creditPause);
      await port.pauseLoop(repo, "triage", creditPause);
      await port.resumeLoop(repo, "review");

      const settings = await port.rawSettings(repo);

      expect(loopPause("review", settings)).toBeNull();
      expect(loopPause("triage", settings)).toEqual(creditPause);
    });

    it("pauses a repo whose settings column is null", async () => {
      const { port, seed } = make();
      const repo = newRepo();

      await seed(repo, {});
      await port.updateSettings(
        repo,
        null as unknown as Record<string, unknown>,
      );
      await port.pauseLoop(repo, "digest", creditPause);

      expect(loopPause("digest", await port.rawSettings(repo))).toEqual(
        creditPause,
      );
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

if (pg.ok) {
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

afterAll(async () => {
  if (!pg.ok) {
    return;
  }
  const pool = new Pool(PG_CONFIG);

  await pool.query("DELETE FROM lore.repos WHERE owner = 'test-pause'");
  await pool.end();
});
