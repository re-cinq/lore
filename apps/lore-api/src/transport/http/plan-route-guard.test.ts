import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import Hapi from "@hapi/hapi";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import type { RepoAccess, RepoLevel } from "../../work/auth/repo-access.js";
import { guardAppClient } from "@re-cinq/lore-shared/project/lib/app-client-guard.js";
import { principalOf, registerBearerScope } from "./bearer-scope.js";
import { registerPersonAppClientGuard } from "./person-request-context.js";
import { planRouteGuard } from "./plan-route-guard.js";
import { registerRepoGuard } from "./repo-guard.js";

const LEGACY = "legacy-service-token";
const READ_ONLY = "read-only-service-token";
const PLAN = "11111111-2222-4333-8444-555555555555";
const UNKNOWN_PLAN = "99999999-2222-4333-8444-555555555555";

const LEVELS: RepoLevel[] = ["read", "write", "admin"];

const GITHUB_SAYS: Record<string, Record<string, RepoLevel>> = {
  ana: { "re-cinq/lore": "write" },
  rita: { "re-cinq/lore": "read" },
  wim: { "re-cinq/lore": "write" },
  ben: { "x/y": "write" },
};

const SESSION_SCOPES: Record<string, string[]> = { wim: ["read"] };

const github: RepoAccess = {
  canOpen: async (principal, repo, level = "read") => {
    if (principal.user === null) {
      return true;
    }
    const granted = GITHUB_SAYS[principal.user.login]?.[repo];

    return (
      granted !== undefined && LEVELS.indexOf(granted) >= LEVELS.indexOf(level)
    );
  },
};

const hashOf = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const PEOPLE = new Map(
  ["ana", "rita", "wim", "ben"].map((login) => [
    hashOf(`${login}-session`),
    login,
  ]),
);

function lore() {
  const pool = makePool();
  const server = Hapi.server();
  const asked: string[] = [];

  process.env.LORE_INGEST_TOKEN = LEGACY;
  pool.query.mockImplementation(async (_sql: string, [hash]: string[]) => ({
    rows: rowsFor(hash),
  }));
  registerBearerScope(server, () => pool as never);
  registerRepoGuard(server, github);
  registerPersonAppClientGuard(server);
  server.ext(
    "onPreHandler",
    planRouteGuard(server, async (planId) => {
      asked.push(planId);

      return planId === PLAN ? "re-cinq/lore" : null;
    }),
  );
  server.route([
    { method: "GET", path: "/api/plans/{planId}", handler: () => ({ ok: 1 }) },
    {
      method: "POST",
      path: "/api/plans/{planId}/approve",
      handler: () => ({ ok: 1 }),
    },
    {
      method: "GET",
      path: "/api/plans/{id}/story",
      handler: () => ({ ok: 1 }),
    },
    { method: "POST", path: "/api/plans", handler: () => ({ ok: 1 }) },
    {
      method: "GET",
      path: "/api/plans/{planId}/who",
      handler: (request) => ({ login: principalOf(request).user?.login }),
    },
    {
      method: "POST",
      path: "/api/plans/{planId}/branch",
      handler: () => writeThroughTheAppsClient(),
    },
    { method: "GET", path: "/api/other", handler: () => ({ ok: 1 }) },
  ]);

  return {
    asked,
    call: (method: string, url: string, token: string, payload?: object) =>
      server.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        payload: payload ? JSON.stringify(payload) : undefined,
      }),
  };
}

function writeThroughTheAppsClient() {
  const befores: ((options: { method?: string; url?: string }) => void)[] = [];

  guardAppClient({
    hook: {
      before: (_name: string, run: (typeof befores)[number]) =>
        befores.push(run),
    },
  } as never);
  befores.forEach((run) =>
    run({ method: "POST", url: "/repos/re-cinq/lore/git/refs" }),
  );

  return { created: true };
}

function rowsFor(hash: string) {
  if (hash === hashOf(READ_ONLY)) {
    return [readOnlyServiceRow()];
  }

  return PEOPLE.has(hash) ? [sessionRow(PEOPLE.get(hash) ?? "")] : [];
}

function readOnlyServiceRow() {
  return {
    scopes: ["read"],
    kind: "service",
    github_id: null,
    login: null,
    repos: null,
    startedAt: new Date("2026-11-23T08:00:00Z"),
    expiresAt: null,
  };
}

function sessionRow(login: string) {
  return {
    scopes: SESSION_SCOPES[login] ?? ["admin"],
    kind: "user",
    github_id: "4242",
    login,
    repos: Object.keys(GITHUB_SAYS[login] ?? {}),
    startedAt: new Date("2026-11-23T08:00:00Z"),
    expiresAt: null,
  };
}

describe("the plan route guard", () => {
  it("refuses Ben a plan of a repository he cannot open with 403", async () => {
    const res = await lore().call("GET", `/api/plans/${PLAN}`, "ben-session");

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 403,
      body: { error: "repository not allowed" },
    });
  });

  it("refuses Ben the story of that plan on lore's own plan route with 403", async () => {
    const res = await lore().call(
      "GET",
      `/api/plans/${PLAN}/story`,
      "ben-session",
    );

    expect(res.statusCode).toBe(403);
  });

  it("answers Rita, who can read re-cinq/lore, its plan", async () => {
    const res = await lore().call("GET", `/api/plans/${PLAN}`, "rita-session");

    expect(res.statusCode).toBe(200);
  });

  it("refuses Rita approving that plan with only read on its repository", async () => {
    const res = await lore().call(
      "POST",
      `/api/plans/${PLAN}/approve`,
      "rita-session",
    );

    expect(res.statusCode).toBe(403);
  });

  it("lets Ana, who can write to re-cinq/lore, approve its plan", async () => {
    const res = await lore().call(
      "POST",
      `/api/plans/${PLAN}/approve`,
      "ana-session",
    );

    expect(res.statusCode).toBe(200);
  });

  it("refuses Ben a new plan in a repository he cannot write to, and lets Ana make it", async () => {
    const plan = { repo: "re-cinq/lore", title: "A plan" };
    const { call } = lore();

    expect([
      (await call("POST", "/api/plans", "ben-session", plan)).statusCode,
      (await call("POST", "/api/plans", "ana-session", plan)).statusCode,
    ]).toEqual([403, 200]);
  });

  it("answers 404 to a person asking for a plan that does not exist", async () => {
    const res = await lore().call(
      "GET",
      `/api/plans/${UNKNOWN_PLAN}`,
      "ana-session",
    );

    expect(res.statusCode).toBe(404);
  });

  it("lets a service token reach every plan without asking for its repository", async () => {
    const { call, asked } = lore();
    const res = await call("POST", `/api/plans/${PLAN}/approve`, LEGACY);

    expect({ status: res.statusCode, asked }).toEqual({
      status: 200,
      asked: [],
    });
  });

  it("leaves routes outside /api/plans alone", async () => {
    const { call, asked } = lore();
    const res = await call("GET", "/api/other", "ben-session");

    expect({ status: res.statusCode, asked }).toEqual({
      status: 200,
      asked: [],
    });
  });

  it("lets Wim, whose session carries only read but whom GitHub lets write to re-cinq/lore, approve its plan", async () => {
    const res = await lore().call(
      "POST",
      `/api/plans/${PLAN}/approve`,
      "wim-session",
    );

    expect(res.statusCode).toBe(200);
  });

  it("answers Rita's HEAD of the plan she can read like her GET", async () => {
    const res = await lore().call("HEAD", `/api/plans/${PLAN}`, "rita-session");

    expect(res.statusCode).toBe(200);
  });

  it("hands the handler of a plan route the person who called it", async () => {
    const res = await lore().call(
      "GET",
      `/api/plans/${PLAN}/who`,
      "ana-session",
    );

    expect(JSON.parse(res.payload)).toEqual({ login: "ana" });
  });

  it("refuses a GitHub write through the App's client while a plan route serves a person, and lets a service token make it", async () => {
    const { call } = lore();

    expect([
      (await call("POST", `/api/plans/${PLAN}/branch`, "ana-session"))
        .statusCode,
      (await call("POST", `/api/plans/${PLAN}/branch`, LEGACY)).statusCode,
    ]).toEqual([500, 200]);
  });

  it("falls back to the session's scope when a new plan names no repository, refusing Wim, whose session carries only read", async () => {
    const { call, asked } = lore();
    const res = await call("POST", "/api/plans", "wim-session", {
      title: "A plan",
    });

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload),
      asked,
    }).toEqual({
      status: 403,
      body: { error: "insufficient scope" },
      asked: [],
    });
  });

  it("holds a read-only service token to its scope: it reads a plan and is refused approving it, without its repository being looked up", async () => {
    const { call, asked } = lore();
    const read = await call("GET", `/api/plans/${PLAN}`, READ_ONLY);
    const change = await call("POST", `/api/plans/${PLAN}/approve`, READ_ONLY);

    expect({
      read: read.statusCode,
      change: change.statusCode,
      body: JSON.parse(change.payload),
      asked,
    }).toEqual({
      read: 200,
      change: 403,
      body: { error: "insufficient scope" },
      asked: [],
    });
  });
});
