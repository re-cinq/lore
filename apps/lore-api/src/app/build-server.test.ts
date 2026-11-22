import pg from "pg";
import { describe, it, expect, vi } from "vitest";
import {
  cookieOf,
  queuedClient,
} from "../work/assembly-line-station/live-socket.fixtures.js";
import {
  announceSessionEnded,
  onSessionEnded,
} from "../work/auth/session-ended.js";
import { buildServer } from "./build-server.js";

describe("lore-api request-error logging (#1324)", () => {
  it("names an unexpected route throw on the console instead of 500ing anonymously", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = buildServer(() => null);

    server.route({
      method: "GET",
      path: "/boom",
      handler: () => {
        throw new Error("pool exhausted");
      },
    });

    try {
      const res = await server.inject({ method: "GET", url: "/boom" });

      expect(res.statusCode).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[http\] GET \/boom 500 .*pool exhausted/s),
      );
    } finally {
      errorSpy.mockRestore();
      await server.stop();
    }
  });
});

describe("buildServer without a mirror lookup", () => {
  it("hands PUT /probe naming acme/public to its handler unchanged", async () => {
    const server = buildServer(() => null);
    const seen: unknown[] = [];

    server.route({
      method: "PUT",
      path: "/probe",
      options: { auth: false },
      handler: (request) => (seen.push(request.payload), { ok: true }),
    });
    const res = await server.inject({
      method: "PUT",
      url: "/probe",
      payload: { repo: "acme/public" },
    });

    await server.stop();

    expect({ status: res.statusCode, seen }).toEqual({
      status: 200,
      seen: [{ repo: "acme/public" }],
    });
  });
});

describe("buildServer session-end wiring", () => {
  it("closes a session's live socket when that session ends", async () => {
    const fixedNow = new Date("2026-11-22T10:00:00.000Z");

    vi.useFakeTimers({ now: fixedNow, toFake: ["Date"] });
    const pool = sessionPool("row-1", fixedNow);
    const server = buildServer(() => pool);

    try {
      await server.start();
      const client = queuedClient(
        Number(server.info.port),
        "/api/ws",
        cookieOf("tok-1"),
      );

      await client.open();
      const closed = client.closed();

      announceSessionEnded("row-1");

      expect(await closed).toBe(4401);
    } finally {
      await server.stop();
      await pool.end();
      vi.useRealTimers();
    }
  });

  it("stops listening for ended sessions and upgrades once the server stops", async () => {
    const server = buildServer(() => null);
    const before = server.listener.listenerCount("upgrade");
    const heard = vi.fn();
    const probe = onSessionEnded(heard);

    await server.stop();
    announceSessionEnded("row-1");
    probe();

    expect({
      removedUpgrades: before - server.listener.listenerCount("upgrade"),
      heard: heard.mock.calls,
    }).toEqual({
      removedUpgrades: 1,
      heard: [["row-1"]],
    });
  });
});

function sessionPool(sessionId: string, now: Date): pg.Pool {
  const pool = new pg.Pool();

  vi.spyOn(pool, "query").mockImplementation(async () => ({
    command: "UPDATE",
    rowCount: 1,
    oid: 0,
    fields: [],
    rows: [
      {
        id: sessionId,
        scopes: ["read"],
        kind: "user",
        login: "ana",
        displayName: "Ana",
        avatarUrl: null,
        repos: [],
        github_id: 42,
        githubRepoId: null,
        membership_checked_at: now,
        reposRefreshedAt: now,
        encryptedTokens: null,
        startedAt: now,
        expiresAt: null,
      },
    ],
  }));

  return pool;
}
