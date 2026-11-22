import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { bearerScope, registerBearerScope } from "./bearer-scope.js";
import { enforceRepoOpen, registerRepoGuard, repoLevel } from "./repo-guard.js";

const LEGACY = "legacy-service-token";

function lore() {
  const pool = makePool();
  const server = Hapi.server();
  const asked: string[] = [];
  const reached: string[] = [];
  const handler = (name: string) => () => (reached.push(name), { ok: true });

  process.env.LORE_INGEST_TOKEN = LEGACY;
  pool.query.mockResolvedValue({
    rows: [
      {
        scopes: ["admin"],
        kind: "user",
        github_id: "4242",
        login: "ben",
        repos: [],
        startedAt: new Date("2026-11-18T10:00:00Z"),
        expiresAt: null,
      },
    ],
  });
  registerBearerScope(server, () => pool as never);
  registerRepoGuard(server, {
    canOpen: async (principal, repo) => {
      asked.push(repo);

      return principal.user === null || repo === "acme/app";
    },
  });
  server.route([
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/commit",
      options: bearerScope("write"),
      handler: handler("commit"),
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/webhook/secret",
      options: bearerScope("admin"),
      handler: handler("secret"),
    },
    {
      method: "GET",
      path: "/api/tasks/by-pr/{owner}/{repo}/{number}",
      options: bearerScope("read"),
      handler: handler("by-pr"),
    },
    {
      method: "GET",
      path: "/api/repos",
      options: bearerScope("read"),
      handler: handler("list"),
    },
    {
      method: "POST",
      path: "/api/webhook/{owner}/{repo}",
      handler: handler("anonymous"),
    },
    {
      method: "POST",
      path: "/api/onboard",
      options: bearerScope("admin"),
      handler: async (request) => {
        await enforceRepoOpen(
          request,
          (request.payload as { repo: string }).repo,
        );

        return handler("onboard")();
      },
    },
  ]);

  return {
    asked,
    reached,
    call: (method: string, url: string, token?: string, payload?: object) =>
      server.inject({
        method,
        url,
        payload,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
  };
}

describe("the repo guard", () => {
  it.each([
    ["POST", "/api/repos/other/secret/commit", "commit"],
    ["GET", "/api/repos/other/secret/webhook/secret", "secret"],
    ["GET", "/api/tasks/by-pr/other/secret/7", "by-pr"],
  ])(
    "refuses a person %s %s of a repo they cannot open with 403, before the route runs",
    async (method, url) => {
      const { call, reached } = lore();
      const res = await call(method, url, "ben-session");

      expect({
        status: res.statusCode,
        body: JSON.parse(res.payload),
        reached,
      }).toEqual({
        status: 403,
        body: { error: "repository not allowed" },
        reached: [],
      });
    },
  );

  it("lets a person through to a route of a repo they can open, asked by its owner/name", async () => {
    const { call, asked, reached } = lore();
    const res = await call("POST", "/api/repos/acme/app/commit", "ben-session");

    expect({ status: res.statusCode, asked, reached }).toEqual({
      status: 200,
      asked: ["acme/app"],
      reached: ["commit"],
    });
  });

  it("lets a service token reach any repo's route", async () => {
    const { call, reached } = lore();
    const res = await call("POST", "/api/repos/other/secret/commit", LEGACY);

    expect({ status: res.statusCode, reached }).toEqual({
      status: 200,
      reached: ["commit"],
    });
  });

  it("asks nothing for a route that names no repo", async () => {
    const { call, asked } = lore();
    const res = await call("GET", "/api/repos", "ben-session");

    expect({ status: res.statusCode, asked }).toEqual({
      status: 200,
      asked: [],
    });
  });

  it("leaves a route with no sign-in to its own check, as a signed webhook is", async () => {
    const { call, asked, reached } = lore();
    const res = await call("POST", "/api/webhook/other/secret");

    expect({ status: res.statusCode, asked, reached }).toEqual({
      status: 200,
      asked: [],
      reached: ["anonymous"],
    });
  });

  it("refuses a person the repo a route names in its body with 403", async () => {
    const { call, reached } = lore();
    const res = await call("POST", "/api/onboard", "ben-session", {
      repo: "other/secret",
    });

    expect({ status: res.statusCode, reached }).toEqual({
      status: 403,
      reached: [],
    });
  });

  it("lets a person onboard a repo they can open", async () => {
    const { call, reached } = lore();
    const res = await call("POST", "/api/onboard", "ben-session", {
      repo: "acme/app",
    });

    expect({ status: res.statusCode, reached }).toEqual({
      status: 200,
      reached: ["onboard"],
    });
  });
});

describe("the repo guard on declared levels", () => {
  it("answers a person 403 before the route runs when their level on the repo is below the route's declared level", async () => {
    const readCaller = leveledLore("read");
    const writeCaller = leveledLore("write");
    const readOnWrite = await readCaller.call("/api/repos/acme/app/commit");
    const writeOnWrite = await writeCaller.call("/api/repos/acme/app/commit");
    const writeOnAdmin = await writeCaller.call(
      "/api/repos/acme/app/mirror/move",
    );

    expect({
      readOnWrite: [readOnWrite.statusCode, JSON.parse(readOnWrite.payload)],
      readReached: readCaller.reached,
      writeOnWrite: writeOnWrite.statusCode,
      writeOnAdmin: [writeOnAdmin.statusCode, JSON.parse(writeOnAdmin.payload)],
      writeAskedLevels: writeCaller.askedLevels,
      writeReached: writeCaller.reached,
    }).toEqual({
      readOnWrite: [403, { error: "repository not allowed" }],
      readReached: [],
      writeOnWrite: 200,
      writeOnAdmin: [403, { error: "repository not allowed" }],
      writeAskedLevels: [
        ["acme/app", "write"],
        ["acme/app", "admin"],
      ],
      writeReached: ["commit"],
    });
  });
});

type DeclaredLevel = Parameters<typeof repoLevel>[0];

const RANK: Record<DeclaredLevel, number> = { read: 1, write: 2, admin: 3 };

function leveledLore(grantedOnAcme: DeclaredLevel) {
  const askedLevels: Array<[string, DeclaredLevel]> = [];
  const pool = makePool();
  const server = Hapi.server();

  process.env.LORE_INGEST_TOKEN = LEGACY;
  pool.query.mockResolvedValue({
    rows: [
      {
        scopes: ["admin"],
        kind: "user",
        github_id: "4242",
        login: "ben",
        repos: [],
        startedAt: new Date("2026-11-18T10:00:00Z"),
        expiresAt: null,
      },
    ],
  });
  registerBearerScope(server, () => pool as never);
  registerRepoGuard(server, {
    canOpen: async (principal, repo, level = "read") => {
      askedLevels.push([repo, level]);

      return (
        principal.user === null ||
        (repo === "acme/app" && RANK[grantedOnAcme] >= RANK[level])
      );
    },
  });
  const reached: string[] = [];
  const handler = (name: string) => () => (reached.push(name), { ok: true });

  server.route([
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/commit",
      options: { ...bearerScope("write"), ...repoLevel("write") },
      handler: handler("commit"),
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/mirror/move",
      options: { ...bearerScope("admin"), ...repoLevel("admin") },
      handler: handler("mirror-move"),
    },
  ]);

  return {
    askedLevels,
    reached,
    call: (url: string) =>
      server.inject({
        method: "POST",
        url,
        headers: { authorization: "Bearer ben-session" },
      }),
  };
}

describe("enforceRepoOpen", () => {
  it("asks for the level the route declares when a handler checks the repo it names in its body", async () => {
    const asked: Array<[string, string]> = [];
    const pool = makePool();
    const server = Hapi.server();

    pool.query.mockResolvedValue({
      rows: [
        {
          scopes: ["admin"],
          kind: "user",
          github_id: "4242",
          login: "ben",
          repos: [],
          startedAt: new Date("2026-11-18T10:00:00Z"),
          expiresAt: null,
        },
      ],
    });
    registerBearerScope(server, () => pool as never);
    registerRepoGuard(server, {
      canOpen: async (_principal, repo, level = "read") => {
        asked.push([repo, level]);

        return true;
      },
    });
    server.route({
      method: "POST",
      path: "/api/declared-write",
      options: {
        ...bearerScope("write"),
        ...repoLevel("write", { from: "payload", name: "repo" }),
      },
      handler: async (request) => {
        await enforceRepoOpen(request, "acme/app");
        await enforceRepoOpen(request, "acme/other", "admin");

        return { ok: true };
      },
    });
    await server.inject({
      method: "POST",
      url: "/api/declared-write",
      headers: { authorization: "Bearer ben-session" },
      payload: { repo: "acme/app" },
    });

    expect(asked).toEqual(
      expect.arrayContaining([
        ["acme/app", "write"],
        ["acme/other", "admin"],
      ]),
    );
  });
});
