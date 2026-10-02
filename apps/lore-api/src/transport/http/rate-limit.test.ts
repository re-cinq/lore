import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "../../app/build-server.js";
import {
  useRateLimitSafeClock,
  makePool,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/platform/db.js", () => ({
  getHealthStatus: vi.fn().mockResolvedValue({ connected: true }),
  isDbAvailable: vi.fn(),
  getQueryEmbedding: vi.fn(),
}));

const originalEnv = { ...process.env };

describe("rate-limit ext", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("routes /api/embeddings to its own 1200/min bucket — the station's embedding burst must not starve (or be starved by) the 200/min default", async () => {
    const { bucketFor } = await import("./rate-limit.js");
    const { rateLimit } = await import("./auth.js");

    expect(bucketFor("/api/embeddings")).toBe("embed");

    for (let i = 0; i < 1200; i++) {
      expect(rateLimit("embed")).toBe(true);
    }
    expect(rateLimit("embed")).toBe(false);
    expect(rateLimit("default")).toBe(true);
  });

  it("routes /api/webhook/github and /api/task-turns/x to webhook and turns buckets", async () => {
    const { bucketFor } = await import("./rate-limit.js");

    expect(bucketFor("/api/webhook/github")).toBe("webhook");
    expect(bucketFor("/api/task-turns/abc-123")).toBe("turns");
    expect(bucketFor("/api/task")).toBe("task");
    expect(bucketFor("/api/task/abc-123")).toBe("task");
    expect(bucketFor("/api/tasks")).toBe("task");
    expect(bucketFor("/api/repo-status")).toBe("default");
  });

  it("trips the default bucket at the 201st request on a native route (/dist)", async () => {
    const server = buildServer(() => null);
    const hit = () =>
      server.inject({
        method: "GET",
        url: "/dist/lore-code-trace/linux-amd64",
      });

    for (let i = 0; i < 200; i++) {
      await hit();
    }
    const last = await hit();

    expect(last.statusCode).toBe(429);
    expect(last.result).toEqual({ error: "rate limit exceeded" });
    expect(last.headers["retry-after"]).toBe("60");
  });

  it("trips the task bucket at the 61st POST to a native route (/api/task)", async () => {
    const server = buildServer(() => null);
    const hit = () =>
      server.inject({
        method: "POST",
        url: "/api/task",
        headers: AUTH,
        payload: "{}",
      });

    for (let i = 0; i < 60; i++) {
      await hit();
    }
    const last = await hit();

    expect(last.statusCode).toBe(429);
  });

  it("counts each request once — the 200th passes and the 201st trips", async () => {
    const server = buildServer(() => null);
    const hit = () =>
      server.inject({
        method: "GET",
        url: "/api/repo-status?repo=o/r",
        headers: AUTH,
      });
    let secondToLast;

    for (let i = 0; i < 200; i++) {
      secondToLast = await hit();
    }
    const last = await hit();

    expect(secondToLast!.statusCode).not.toBe(429);
    expect(last.statusCode).toBe(429);
  });

  it("exempts /healthz from rate limiting", async () => {
    const server = buildServer(() => null);
    const hit = () => server.inject({ method: "GET", url: "/healthz" });

    for (let i = 0; i < 249; i++) {
      await hit();
    }
    const last = await hit();

    expect(last.statusCode).not.toBe(429);
  });

  describe("per principal", () => {
    const statusUrl = "/api/repo-status?repo=o/r";
    const spend = async (
      server: ReturnType<typeof buildServer>,
      count: number,
      options: {
        url?: string;
        method?: "GET" | "POST";
        headers?: Record<string, string>;
        remoteAddress?: string;
      } = {},
    ) => {
      let last;

      for (let i = 0; i < count; i++) {
        last = await server.inject({
          method: options.method ?? "GET",
          url: options.url ?? statusUrl,
          headers: options.headers,
          remoteAddress: options.remoteAddress,
        });
      }

      return last!.statusCode;
    };
    const dist = "/dist/lore-code-trace/linux-amd64";

    it("lets an anonymous flood spend only its own address's budget, never an authenticated caller's", async () => {
      const server = buildServer(() => null);
      const flood = await spend(server, 250, { remoteAddress: "10.1.1.1" });
      const caller = await spend(server, 1, { headers: AUTH });

      expect({ flood, caller: caller === 429 }).toEqual({
        flood: 429,
        caller: false,
      });
    });

    it("keeps two authenticated principals in separate buckets", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ scopes: ["admin"] }] });
      const server = buildServer(() => pool as never);
      const first = await spend(server, 201, { headers: AUTH });
      const second = await spend(server, 1, {
        headers: { authorization: "Bearer second-principal" },
      });

      expect({ first, second: second === 429 }).toEqual({
        first: 429,
        second: false,
      });
    });

    it("keeps two anonymous addresses in separate buckets", async () => {
      const server = buildServer(() => null);
      const first = await spend(server, 201, {
        url: dist,
        remoteAddress: "10.2.2.1",
      });
      const second = await spend(server, 1, {
        url: dist,
        remoteAddress: "10.2.2.2",
      });

      expect({ first, second: second === 429 }).toEqual({
        first: 429,
        second: false,
      });
    });

    it("still enforces each class limit per principal: webhooks 30, task ops 60", async () => {
      const server = buildServer(() => null);
      const webhook = (count: number, remoteAddress: string) =>
        spend(server, count, {
          method: "POST",
          url: "/api/webhook/incident",
          remoteAddress,
        });
      const task = (count: number) =>
        spend(server, count, {
          method: "POST",
          url: "/api/task",
          headers: AUTH,
        });
      const statuses = {
        webhook30: await webhook(30, "10.3.3.1"),
        webhook31: await webhook(1, "10.3.3.1"),
        otherAddress: await webhook(1, "10.3.3.2"),
        task60: await task(60),
        task61: await task(1),
      };

      expect({
        webhook30: statuses.webhook30 === 429,
        webhook31: statuses.webhook31,
        otherAddress: statuses.otherAddress === 429,
        task60: statuses.task60 === 429,
        task61: statuses.task61,
      }).toEqual({
        webhook30: false,
        webhook31: 429,
        otherAddress: false,
        task60: false,
        task61: 429,
      });
    });

    it("does not let forged bearers mint fresh buckets: unverifiable credentials spend their address's budget", async () => {
      const server = buildServer(() => null);
      let last;

      for (let i = 0; i < 250; i++) {
        last = await server.inject({
          method: "GET",
          url: statusUrl,
          headers: { authorization: `Bearer forged-${i}` },
          remoteAddress: "10.4.4.1",
        });
      }

      expect(last!.statusCode).toBe(429);
    });

    it("gives cluster-agent claims their own larger bucket, keyed by address and agent", async () => {
      const { bucketFor } = await import("./rate-limit.js");
      const server = buildServer(() => null);
      const claim = (id: string, count: number) =>
        spend(server, count, {
          method: "POST",
          url: `/api/cluster-agents/${id}/claim`,
          remoteAddress: "10.5.5.1",
        });

      expect({
        claim: bucketFor("/api/cluster-agents/a1/claim"),
        register: bucketFor("/api/cluster-agents/register"),
        burst: (await claim("a1", 250)) === 429,
        otherAgent: (await claim("a2", 1)) === 429,
        authenticated: (await spend(server, 1, { headers: AUTH })) === 429,
      }).toEqual({
        claim: "agent",
        register: "default",
        burst: false,
        otherAgent: false,
        authenticated: false,
      });
    });

    it("ignores X-Forwarded-For unless proxy hops are declared", async () => {
      const server = buildServer(() => null);
      let last;

      for (let i = 0; i < 201; i++) {
        last = await server.inject({
          method: "GET",
          url: statusUrl,
          headers: { "x-forwarded-for": `192.0.2.${i % 250}` },
          remoteAddress: "10.6.6.1",
        });
      }

      expect(last!.statusCode).toBe(429);
    });

    it("reads the client from X-Forwarded-For when one proxy hop is declared, taking the entry that proxy appended", async () => {
      process.env.LORE_TRUSTED_PROXY_HOPS = "1";
      const server = buildServer(() => null);
      const hit = (client: string) =>
        server.inject({
          method: "GET",
          url: statusUrl,
          headers: { "x-forwarded-for": `spoofed-by-client, ${client}` },
          remoteAddress: "10.7.7.1",
        });

      for (let i = 0; i < 200; i++) {
        await hit("192.0.2.10");
      }

      expect({
        spent: (await hit("192.0.2.10")).statusCode,
        other: (await hit("192.0.2.11")).statusCode === 429,
      }).toEqual({ spent: 429, other: false });
    });

    it("exempts /healthz from every principal's budget", async () => {
      const server = buildServer(() => null);

      expect(
        await spend(server, 250, {
          url: "/healthz",
          remoteAddress: "10.8.8.1",
        }),
      ).not.toBe(429);
    });
  });

  describe("on the live socket", () => {
    let server: ReturnType<typeof buildServer>;

    beforeEach(async () => {
      server = buildServer(() => null);
      await server.start();
    });
    afterEach(async () => {
      await server.stop({ timeout: 100 });
    });

    const upgrade = (): Promise<number> =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.info.port}/api/ws`);

        ws.once("open", () => {
          ws.close();
          resolve(101);
        });
        ws.once("unexpected-response", (_, res) =>
          resolve(res.statusCode ?? 0),
        );
        ws.once("error", () => {});
      });

    it("refuses upgrades from an address past 30 attempts a minute with 429", async () => {
      const statuses: number[] = [];

      for (let i = 0; i < 31; i++) {
        statuses.push(await upgrade());
      }

      expect({
        accepted: statuses.filter((status) => status === 101).length,
        last: statuses.at(-1),
      }).toEqual({ accepted: 30, last: 429 });
    });

    it("answers an open past 30 a minute on one socket with rate_limited", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.info.port}/api/ws`);
      const codes: string[] = [];

      await new Promise<void>((resolve) => ws.once("open", () => resolve()));
      ws.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { code?: string };

        codes.push(message.code ?? "");
      });

      for (let i = 0; i < 31; i++) {
        ws.send(
          JSON.stringify({
            type: "open",
            channel: "r",
            kind: "run",
            subject: "run-1",
            token: "none",
          }),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      ws.close();

      expect(codes.filter((code) => code === "rate_limited")).toHaveLength(1);
    });
  });
});
