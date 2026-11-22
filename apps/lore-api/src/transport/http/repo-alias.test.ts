import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { InMemorySettings } from "@re-cinq/lore-shared/project/settings/settings-memory.js";
import { bearerScope, registerBearerScope } from "./bearer-scope.js";
import { registerRepoGuard, repoLevel } from "./repo-guard.js";
import {
  aliasDecision,
  cachedOwnerOf,
  mirrorWritable,
  registerRepoAlias,
} from "./repo-alias.js";

const LEGACY = "legacy-service-token";
const MIRROR = "acme/public";
const PRIVATE = "acme/private";

describe("the alias decision", () => {
  it("decides rewrite for get, head and an opted-in post, refuse for put and a plain post, and pass for a name nobody mirrors", () => {
    const decide = (method: string, owner: string | null) =>
      aliasDecision({ method, writable: false, owner });
    const decideOptedIn = (method: string, owner: string | null) =>
      aliasDecision({ method, writable: true, owner });

    expect({
      get: decide("get", PRIVATE),
      head: decide("head", PRIVATE),
      put: decide("put", PRIVATE),
      post: decide("post", PRIVATE),
      optedInPost: decideOptedIn("post", PRIVATE),
      getNobodyMirrors: decide("get", null),
      optedInPostNobodyMirrors: decideOptedIn("post", null),
    }).toEqual({
      get: "rewrite",
      head: "rewrite",
      put: "refuse",
      post: "refuse",
      optedInPost: "rewrite",
      getNobodyMirrors: "pass",
      optedInPostNobodyMirrors: "pass",
    });
  });
});

describe("mirrorWritable", () => {
  it("keeps the repo declaration of the options it is given", () => {
    expect(
      mirrorWritable(repoLevel("read", { from: "payload", name: "repo" })),
    ).toEqual({
      app: {
        repoGuard: { level: "read", source: { from: "payload", name: "repo" } },
        mirrorWritable: true,
      },
    });
  });
});

describe("the cached mirror lookup", () => {
  it("asks once for a name inside the window and again after it", async () => {
    const asked: string[] = [];
    let now = 0;
    const lookup = cachedOwnerOf(async (name) => (asked.push(name), null), {
      ttlMs: 1000,
      now: () => now,
    });

    await lookup("acme/app");
    await lookup("acme/app");
    now = 1001;
    await lookup("acme/app");

    expect(asked).toEqual(["acme/app", "acme/app"]);
  });
});

function aliasServer(access: string[] = [PRIVATE]) {
  const settings = new InMemorySettings([
    { full_name: PRIVATE, settings: { public_mirror: MIRROR } },
  ]);
  const server = Hapi.server();
  const pool = makePool();
  const seen: Array<Record<string, unknown>> = [];
  const record = (request: Hapi.Request) => (
    seen.push({
      params: { ...request.params },
      query: { ...request.query },
      payload: request.payload,
    }),
    { ok: true }
  );

  process.env.LORE_INGEST_TOKEN = LEGACY;
  pool.query.mockResolvedValue({
    rows: [
      {
        scopes: ["admin"],
        kind: "user",
        github_id: "4242",
        login: "ben",
        repos: access,
        startedAt: new Date("2026-11-18T10:00:00Z"),
        expiresAt: null,
      },
    ],
  });
  registerBearerScope(server, () => pool as never);
  registerRepoAlias(server, (name) => settings.mirrorOwner(name));
  registerRepoGuard(server, {
    canOpen: async (principal, repo) =>
      principal.user === null || (principal.user.repos ?? []).includes(repo),
  });
  server.route([
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/rows",
      options: bearerScope("read"),
      handler: record,
    },
    {
      method: "PUT",
      path: "/api/repos/{owner}/{repo}/loops/{key}",
      options: bearerScope("write"),
      handler: record,
    },
    {
      method: "GET",
      path: "/api/things",
      options: bearerScope("read"),
      handler: record,
    },
    {
      method: "POST",
      path: "/api/notes",
      options: { ...bearerScope("write"), ...mirrorWritable() },
      handler: record,
    },
    {
      method: "POST",
      path: "/api/review/start",
      options: bearerScope("write"),
      handler: record,
    },
  ]);

  return {
    seen,
    call: (method: string, url: string, payload?: object) =>
      server.inject({
        method,
        url,
        payload,
        headers: { authorization: `Bearer ${"ben-session"}` },
      }),
  };
}

describe("the alias hook", () => {
  it("answers GET /api/repos/acme/public/rows with the path of acme/private", async () => {
    const { call, seen } = aliasServer();
    const res = await call("GET", "/api/repos/acme/public/rows");

    expect({ status: res.statusCode, params: seen[0]?.params }).toEqual({
      status: 200,
      params: { owner: "acme", repo: "private" },
    });
  });

  it("rewrites ?repo=acme/PUBLIC on GET /api/things to acme/private", async () => {
    const { call, seen } = aliasServer();
    const res = await call("GET", "/api/things?repo=acme/PUBLIC");

    expect({ status: res.statusCode, query: seen[0]?.query }).toEqual({
      status: 200,
      query: { repo: PRIVATE },
    });
  });

  it("answers 409 to PUT /api/repos/acme/public/loops/review when acme/public mirrors acme/private", async () => {
    const { call, seen } = aliasServer();
    const res = await call("PUT", "/api/repos/acme/public/loops/review");

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload),
      seen,
    }).toEqual({
      status: 409,
      body: {
        error:
          "acme/public is the public mirror of acme/private; use acme/private",
      },
      seen: [],
    });
  });

  it("answers 409 to POST /api/review/start naming acme/public in its repo", async () => {
    const { call, seen } = aliasServer();
    const res = await call("POST", "/api/review/start", { repo: MIRROR });

    expect({ status: res.statusCode, seen }).toEqual({ status: 409, seen: [] });
  });

  it("rewrites the repo of an opted-in POST /api/notes from acme/public to acme/private", async () => {
    const { call, seen } = aliasServer();
    const res = await call("POST", "/api/notes", { repo: MIRROR, text: "hi" });

    expect({ status: res.statusCode, payload: seen[0]?.payload }).toEqual({
      status: 200,
      payload: { repo: PRIVATE, text: "hi" },
    });
  });

  it("leaves params, query and payload of a repo that is not a mirror untouched", async () => {
    const { call, seen } = aliasServer(["acme/app"]);

    await call("GET", "/api/repos/acme/app/rows");
    await call("GET", "/api/things?repo=acme/app");
    await call("POST", "/api/notes", { repo: "acme/app", text: "hi" });

    expect(seen).toEqual([
      { params: { owner: "acme", repo: "app" }, query: {}, payload: undefined },
      { params: {}, query: { repo: "acme/app" }, payload: undefined },
      { params: {}, query: {}, payload: { repo: "acme/app", text: "hi" } },
    ]);
  });

  it("refuses GET /api/repos/acme/public/rows with 403 for a person who can open only acme/public", async () => {
    const { call, seen } = aliasServer([MIRROR]);
    const res = await call("GET", "/api/repos/acme/public/rows");

    expect({ status: res.statusCode, seen }).toEqual({ status: 403, seen: [] });
  });

  it("answers GET /api/repos/acme/public/rows with the rows of acme/private for a person who can open acme/private", async () => {
    const { call, seen } = aliasServer([PRIVATE]);
    const res = await call("GET", "/api/repos/acme/public/rows");

    expect({ status: res.statusCode, params: seen[0]?.params }).toEqual({
      status: 200,
      params: { owner: "acme", repo: "private" },
    });
  });
});

describe("the cached mirror lookup across spellings and at its cap", () => {
  const recordingLookup = () => {
    const asked: string[] = [];
    const lookup = cachedOwnerOf(async (name) => (asked.push(name), null), {
      ttlMs: 1000,
      now: () => 0,
    });

    return { asked, lookup };
  };

  it("answers ACME/app from the answer held for acme/App inside the window", async () => {
    const { asked, lookup } = recordingLookup();

    await lookup("acme/App");
    await lookup("ACME/app");

    expect(asked).toEqual(["acme/App"]);
  });

  it("asks again for acme/app-0 once 500 other names were held", async () => {
    const { asked, lookup } = recordingLookup();
    const names = Array.from(
      { length: 501 },
      (_, index) => `acme/app-${index}`,
    );

    await names.reduce(
      (earlier, name) => earlier.then(() => lookup(name)),
      Promise.resolve<string | null>(null),
    );
    await lookup("acme/app-0");

    expect(asked.filter((name) => name === "acme/app-0")).toEqual([
      "acme/app-0",
      "acme/app-0",
    ]);
  });
});

describe("the alias hook at its edges", () => {
  const edgeServer = (owner: string, source: "spans" | "record") => {
    const server = Hapi.server();
    const ran: string[] = [];

    registerRepoAlias(server, async () => owner);
    server.route({
      method: "GET",
      path: "/api/repos/{owner}/{repo}/rows",
      handler: (request) => (ran.push(request.path), { ok: true }),
    });
    server.route({
      method: "PUT",
      path: "/api/all",
      options: repoLevel(
        "read",
        source === "spans"
          ? { from: "spans" }
          : { from: "record", find: () => MIRROR },
      ),
      handler: (request) => (ran.push(request.path), request.payload ?? {}),
    });

    return { server, ran };
  };

  it("answers 500 to GET /api/repos/acme/public/rows and runs no handler when the mirror's owner is the bare name private", async () => {
    const { server, ran } = edgeServer("private", "spans");
    const res = await server.inject("/api/repos/acme/public/rows");

    expect({ status: res.statusCode, ran }).toEqual({ status: 500, ran: [] });
  });

  it("leaves PUT /api/all naming acme/public untouched on a route that spans repositories and on one that finds its repository in a record", async () => {
    const put = async (source: "spans" | "record") => {
      const { server } = edgeServer(PRIVATE, source);
      const res = await server.inject({
        method: "PUT",
        url: "/api/all",
        payload: { repo: MIRROR },
      });

      return { status: res.statusCode, body: res.result };
    };

    expect({ spans: await put("spans"), record: await put("record") }).toEqual({
      spans: { status: 200, body: { repo: MIRROR } },
      record: { status: 200, body: { repo: MIRROR } },
    });
  });
});

describe("the cached mirror lookup with its default window", () => {
  it("holds the answer for acme/public for 29999 ms and asks again at 30000 ms", async () => {
    const asked: number[] = [];
    const clock = { at: 0 };
    const lookup = cachedOwnerOf(async () => (asked.push(clock.at), null), {
      now: () => clock.at,
    });

    await lookup(MIRROR);
    clock.at = 29_999;
    await lookup(MIRROR);
    clock.at = 30_000;
    await lookup(MIRROR);

    expect(asked).toEqual([0, 30_000]);
  });
});
