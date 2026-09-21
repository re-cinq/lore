import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { pgPlanStore } from "../outbound/plans/plan-store-pg.js";
import {
  collabAuthenticator,
  mintCollabToken,
} from "../work/plans/collab-tokens.js";

const REPO = "acme/collab";
const ANA = { id: "ana", name: "Ana" };
const EXPIRED = new Date("2026-01-01T00:00:00Z");

describe("plan collab tokens", () => {
  let pool: pg.Pool;
  let planId: string;
  let otherPlanId: string;

  const create = async () =>
    (
      await pgPlanStore(() => pool).createPlan({
        repo: REPO,
        title: "Faster checkout",
        type: "feature",
        createdBy: "ana",
      })
    ).id;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    planId = await create();
    otherPlanId = await create();
  });

  afterAll(async () => {
    await pool.query("DELETE FROM lore.plans WHERE repo = $1", [REPO]);
    await pool.end();
  });

  it("opens the plan it was minted for as Ana with write access", async () => {
    const token = await mintCollabToken(() => pool, {
      planId,
      repo: REPO,
      user: ANA,
      role: "write",
    });

    expect(
      await collabAuthenticator(() => pool).authenticate(token, {
        repo: REPO,
        planId,
      }),
    ).toEqual({
      id: "ana",
      name: "Ana",
      role: "write",
    });
  });

  it("opens no other plan than the one it was minted for", async () => {
    const token = await mintCollabToken(() => pool, {
      planId,
      repo: REPO,
      user: ANA,
      role: "write",
    });

    expect(
      await collabAuthenticator(() => pool).authenticate(token, {
        repo: REPO,
        planId: otherPlanId,
      }),
    ).toBeNull();
  });

  it("opens nothing once it has expired", async () => {
    const token = await mintCollabToken(
      () => pool,
      { planId, repo: REPO, user: ANA, role: "read" },
      EXPIRED,
    );

    expect(
      await collabAuthenticator(() => pool).authenticate(token, {
        repo: REPO,
        planId,
      }),
    ).toBeNull();
  });
});
