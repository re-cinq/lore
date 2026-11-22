import { describe, it, expect, vi, afterEach } from "vitest";
import type { Pool } from "pg";
import { redeemRoute } from "./redeem.js";
import { serve, testDeps } from "./auth-test-server.js";

const grant = {
  githubId: 4242,
  login: "gedaiu",
  name: "Bogdan",
  avatarUrl: "https://a/1",
  scopes: ["read", "write", "task"],
  repos: ["re-cinq/lore"],
};

function redeemWith(code: string, server: ReturnType<typeof serve>) {
  return server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });
}

describe("POST /api/auth/redeem", () => {
  afterEach(() => vi.useRealTimers());

  it("redeems a code once and answers 401 the second time", async () => {
    const deps = testDeps();

    deps.query.mockResolvedValue({
      rows: [{ id: "t-1", name: "n", scopes: [], created_at: "now" }],
    });
    const code = await deps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 0,
    });
    const server = serve([redeemRoute(deps)]);

    const first = await redeemWith(code, server);
    const second = await redeemWith(code, server);

    expect({ first: first.statusCode, second: second.statusCode }).toEqual({
      first: 200,
      second: 401,
    });
  });

  it("answers the session token and the person it belongs to", async () => {
    const deps = testDeps();

    deps.query.mockResolvedValue({
      rows: [{ id: "t-1", name: "n", scopes: [], created_at: "now" }],
    });
    const code = await deps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 0,
    });
    const res = await redeemWith(code, serve([redeemRoute(deps)]));
    const body = JSON.parse(res.payload);

    expect({ token: body.token, user: body.user }).toEqual({
      token: expect.stringMatching(/^lore_[0-9a-f]{64}$/),
      user: { login: "gedaiu", name: "Bogdan", avatar_url: "https://a/1" },
    });
  });

  const HOUR_MS = 60 * 60 * 1000;

  async function queriesOfSignInWith(saved: { value: string }[]) {
    vi.useFakeTimers({
      now: new Date("2026-10-28T10:00:00Z"),
      toFake: ["Date"],
    });
    const deps = testDeps();

    deps.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: saved })
      .mockResolvedValue({
        rows: [{ id: "t-1", name: "n", scopes: [], created_at: "now" }],
      });
    const code = await deps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 0,
    });

    await redeemWith(code, serve([redeemRoute(deps)]));

    return deps.query.mock.calls;
  }

  it("stores a user token that expires in 8 hours with the person's repos when no length is saved", async () => {
    const calls = await queriesOfSignInWith([]);

    expect({ asked: calls[2][1], minted: calls[3][1] }).toEqual({
      asked: ["session_length_hours"],
      minted: [
        "web-ui session gedaiu",
        expect.any(String),
        ["read", "write", "task"],
        "gedaiu",
        new Date(Date.now() + 8 * HOUR_MS),
        "user",
        "gedaiu",
        "Bogdan",
        "https://a/1",
        ["re-cinq/lore"],
        4242,
        0,
        null,
      ],
    });
  });

  it("stores a user token that expires in 168 hours when session_length_hours is 168", async () => {
    const calls = await queriesOfSignInWith([{ value: "168" }]);

    expect(calls[3][1][4]).toEqual(new Date(Date.now() + 168 * HOUR_MS));
  });

  it("answers 401 for a state code used as a redeem code", async () => {
    const deps = testDeps();
    const state = await deps.handoffs.put("state", {
      returnUrl: "http://localhost:3000/x",
      grant: null,
    });
    const res = await redeemWith(state, serve([redeemRoute(deps)]));

    expect(res.statusCode).toBe(401);
  });

  it("stores the encrypted session token row keyed by the minted session id in one transaction when the handoff carries encrypted tokens", async () => {
    const deps = testDeps();
    const { pool, txQueries, release } = transactionalPool(deps.query);
    const txDeps = { ...deps, getPool: () => pool };
    const code = await txDeps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 0,
      encryptedTokens: "v1.iv.tag.cipher",
    });

    const res = await redeemWith(code, serve([redeemRoute(txDeps)]));

    expect({
      statusCode: res.statusCode,
      sqls: txQueries.map((q) => q.sql.trim()),
      tokenInsertParams: txQueries[5]?.params,
      released: release.mock.calls.length,
    }).toEqual({
      statusCode: 200,
      sqls: [
        "BEGIN",
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("FROM pipeline.person_generations"),
        expect.stringContaining("FROM lore.settings"),
        expect.stringContaining("INSERT INTO pipeline.api_tokens"),
        expect.stringContaining("INSERT INTO pipeline.user_session_tokens"),
        "COMMIT",
      ],
      tokenInsertParams: ["t-1", "v1.iv.tag.cipher"],
      released: 1,
    });
  });

  it("stores the GitHub numeric user id on the session row it creates on redeem", async () => {
    const calls = await queriesOfSignInWith([]);

    expect(calls[3][1][10]).toBe(4242);
  });

  it("takes the advisory lock keyed by the person's GitHub numeric user id before it creates the session", async () => {
    const deps = testDeps();
    const { pool, txQueries } = transactionalPool(deps.query);
    const txDeps = { ...deps, getPool: () => pool };
    const code = await txDeps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 0,
    });

    await redeemWith(code, serve([redeemRoute(txDeps)]));

    const lockAt = txQueries.findIndex((q) =>
      q.sql.includes("pg_advisory_xact_lock"),
    );
    const insertAt = txQueries.findIndex((q) =>
      q.sql.includes("INSERT INTO pipeline.api_tokens"),
    );

    expect({
      lockParams: txQueries[lockAt]?.params,
      lockedBeforeInsert: lockAt >= 0 && lockAt < insertAt,
    }).toEqual({ lockParams: [4242], lockedBeforeInsert: true });
  });

  it("answers 401 and writes no session or token row for a code whose grant carries no GitHub numeric user id", async () => {
    const deps = testDeps();
    const { pool, txQueries } = transactionalPool(deps.query);
    const txDeps = { ...deps, getPool: () => pool };
    const { githubId: _omitted, ...grantWithoutId } = grant;
    const code = await txDeps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant: grantWithoutId as never,
      generation: 0,
      encryptedTokens: "v1.iv.tag.cipher",
    });

    const res = await redeemWith(code, serve([redeemRoute(txDeps)]));

    expect({
      statusCode: res.statusCode,
      writes: txQueries.filter((q) => /INSERT|UPDATE/.test(q.sql)),
    }).toEqual({ statusCode: 401, writes: [] });
  });

  it("answers 401 and writes no session or token row when the person's generation is 1 and the code's row carries 0", async () => {
    const deps = testDeps();
    const { pool, txQueries } = transactionalPool(deps.query, [
      { generation: 1 },
    ]);
    const txDeps = { ...deps, getPool: () => pool };
    const code = await txDeps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 0,
      encryptedTokens: "v1.iv.tag.cipher",
    });

    const res = await redeemWith(code, serve([redeemRoute(txDeps)]));

    expect({
      statusCode: res.statusCode,
      locked: txQueries.some((q) => q.sql.includes("pg_advisory_xact_lock")),
      writes: txQueries.filter((q) => /INSERT|UPDATE/.test(q.sql)),
    }).toEqual({ statusCode: 401, locked: true, writes: [] });
  });

  it("answers 401 and writes no session or token row for a code whose row carries no generation", async () => {
    const deps = testDeps();
    const { pool, txQueries } = transactionalPool(deps.query);
    const txDeps = { ...deps, getPool: () => pool };
    const code = await txDeps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
    });

    const res = await redeemWith(code, serve([redeemRoute(txDeps)]));

    expect({
      statusCode: res.statusCode,
      writes: txQueries.filter((q) => /INSERT|UPDATE/.test(q.sql)),
    }).toEqual({ statusCode: 401, writes: [] });
  });

  it("records the generation 2 the code's row carries on the session row it creates when the person's generation is 2", async () => {
    const deps = testDeps();
    const { pool, txQueries } = transactionalPool(deps.query, [
      { generation: 2 },
    ]);
    const txDeps = { ...deps, getPool: () => pool };
    const code = await txDeps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 2,
    });

    const res = await redeemWith(code, serve([redeemRoute(txDeps)]));
    const insert = txQueries.find((q) =>
      q.sql.includes("INSERT INTO pipeline.api_tokens"),
    );

    expect({
      statusCode: res.statusCode,
      generationParam: insert?.params[11],
    }).toEqual({ statusCode: 200, generationParam: 2 });
  });

  it("mints the session and writes no user_session_tokens row when the handoff carries no encrypted tokens", async () => {
    const deps = testDeps();
    const { pool, txQueries } = transactionalPool(deps.query);
    const txDeps = { ...deps, getPool: () => pool };
    const code = await txDeps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
      generation: 0,
    });

    const res = await redeemWith(code, serve([redeemRoute(txDeps)]));

    expect({
      statusCode: res.statusCode,
      sqls: txQueries.map((q) => q.sql.trim()),
    }).toEqual({
      statusCode: 200,
      sqls: [
        "BEGIN",
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("FROM pipeline.person_generations"),
        expect.stringContaining("FROM lore.settings"),
        expect.stringContaining("INSERT INTO pipeline.api_tokens"),
        "COMMIT",
      ],
    });
  });
});

function transactionalPool(
  query: ReturnType<typeof testDeps>["query"],
  personGenerationRows: Array<{ generation: number }> = [],
) {
  const txQueries: Array<{ sql: string; params: unknown[] }> = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      txQueries.push({ sql, params });

      if (sql.includes("INSERT INTO pipeline.api_tokens")) {
        return {
          rows: [{ id: "t-1", name: "n", scopes: [], created_at: "now" }],
        };
      }

      if (sql.includes("FROM pipeline.person_generations")) {
        return { rows: personGenerationRows };
      }

      return { rows: [] };
    }),
    release,
  };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;

  return { pool, txQueries, release };
}
