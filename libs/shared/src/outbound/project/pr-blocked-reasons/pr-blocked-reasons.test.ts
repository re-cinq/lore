import { describe, it, expect } from "vitest";
import { InMemoryPrBlockedReasons } from "./pr-blocked-reasons-memory.js";
import { PgPrBlockedReasons } from "./pr-blocked-reasons-pg.js";
import type { PgPool } from "../../memory-store.js";

const REPO = "re-cinq/lore";
const WAITING = { reason: "waiting_on_ci", detail: null } as const;
const CONFLICT = { reason: "merge_conflict", detail: "main" } as const;

function clockAt(iso: string) {
  const clock = { now: new Date(iso) };

  return { clock, now: () => clock.now };
}

describe("InMemoryPrBlockedReasons", () => {
  it("answers null for PR 7 when nothing was recorded", async () => {
    expect(await new InMemoryPrBlockedReasons().current(REPO, 7)).toBe(null);
  });

  it("answers merge_conflict on main once recorded for PR 7", async () => {
    const reasons = new InMemoryPrBlockedReasons();

    await reasons.record(REPO, 7, CONFLICT);

    expect(await reasons.current(REPO, 7)).toEqual(CONFLICT);
  });

  it("keeps since at 10:00 when waiting_on_ci is recorded again at 11:00", async () => {
    const { clock, now } = clockAt("2026-10-14T10:00:00Z");
    const reasons = new InMemoryPrBlockedReasons(now);

    await reasons.record(REPO, 7, WAITING);
    clock.now = new Date("2026-10-14T11:00:00Z");
    await reasons.record(REPO, 7, WAITING);

    expect(reasons.rows.get(`${REPO}#7`)).toMatchObject({
      since: new Date("2026-10-14T10:00:00Z"),
      updatedAt: new Date("2026-10-14T11:00:00Z"),
    });
  });

  it("resets since to 11:00 when the reason changes from waiting_on_ci to merge_conflict", async () => {
    const { clock, now } = clockAt("2026-10-14T10:00:00Z");
    const reasons = new InMemoryPrBlockedReasons(now);

    await reasons.record(REPO, 7, WAITING);
    clock.now = new Date("2026-10-14T11:00:00Z");
    await reasons.record(REPO, 7, CONFLICT);

    expect(reasons.rows.get(`${REPO}#7`)?.since).toEqual(
      new Date("2026-10-14T11:00:00Z"),
    );
  });

  it("answers null for PR 7 after its reason is cleared", async () => {
    const reasons = new InMemoryPrBlockedReasons();

    await reasons.record(REPO, 7, WAITING);
    await reasons.clear(REPO, 7);

    expect(await reasons.current(REPO, 7)).toBe(null);
  });

  it("answers null for PR 7 once closed, keeping the row with its closed_at", async () => {
    const { now } = clockAt("2026-10-14T12:00:00Z");
    const reasons = new InMemoryPrBlockedReasons(now);

    await reasons.record(REPO, 7, WAITING);
    await reasons.close(REPO, 7);

    expect({
      current: await reasons.current(REPO, 7),
      closedAt: reasons.rows.get(`${REPO}#7`)?.closedAt,
    }).toEqual({ current: null, closedAt: new Date("2026-10-14T12:00:00Z") });
  });

  it("reopens a closed row for PR 7 when a reason is recorded after reopening", async () => {
    const reasons = new InMemoryPrBlockedReasons();

    await reasons.record(REPO, 7, WAITING);
    await reasons.close(REPO, 7);
    await reasons.record(REPO, 7, WAITING);

    expect(await reasons.current(REPO, 7)).toEqual(WAITING);
  });
});

function fakePool(rowsByCall: unknown[][] = []) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: (rowsByCall[calls.length - 1] ?? []) as T[] };
    },
  };

  return { pool, calls };
}

describe("PgPrBlockedReasons", () => {
  it("reads the open row of PR 7 as merge_conflict on main", async () => {
    const { pool, calls } = fakePool([
      [{ reason: "merge_conflict", detail: "main" }],
    ]);

    const current = await new PgPrBlockedReasons(pool).current(REPO, 7);

    expect({ current, sql: calls[0]?.text, params: calls[0]?.params }).toEqual({
      current: CONFLICT,
      sql: expect.stringContaining("closed_at IS NULL"),
      params: [REPO, 7],
    });
  });

  it("answers null when PR 7 has no open row", async () => {
    const { pool } = fakePool([[]]);

    expect(await new PgPrBlockedReasons(pool).current(REPO, 7)).toBe(null);
  });

  it("upserts PR 7 keeping since only while the reason is unchanged and clearing closed_at", async () => {
    const { pool, calls } = fakePool();

    await new PgPrBlockedReasons(pool).record(REPO, 7, CONFLICT);

    expect({ sql: calls[0]?.text, params: calls[0]?.params }).toEqual({
      sql: expect.stringMatching(
        /ON CONFLICT \(repo, pr_number\) DO UPDATE[\s\S]*IS DISTINCT FROM[\s\S]*closed_at = NULL/,
      ),
      params: [REPO, 7, "merge_conflict", "main"],
    });
  });

  it("deletes only the open row of PR 7 when its reason is cleared", async () => {
    const { pool, calls } = fakePool();

    await new PgPrBlockedReasons(pool).clear(REPO, 7);

    expect({ sql: calls[0]?.text, params: calls[0]?.params }).toEqual({
      sql: expect.stringMatching(/DELETE FROM[\s\S]*closed_at IS NULL/),
      params: [REPO, 7],
    });
  });

  it("stamps closed_at on the open row of PR 7 when it closes", async () => {
    const { pool, calls } = fakePool();

    await new PgPrBlockedReasons(pool).close(REPO, 7);

    expect({ sql: calls[0]?.text, params: calls[0]?.params }).toEqual({
      sql: expect.stringMatching(
        /SET closed_at = now\(\)[\s\S]*closed_at IS NULL/,
      ),
      params: [REPO, 7],
    });
  });
});
