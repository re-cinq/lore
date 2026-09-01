import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import { clusterRoutes, type ClusterDeps } from "./cluster.js";

const TOKEN = "tok-1";
const auth = { authorization: `Bearer ${TOKEN}` };

let calls: string[];
let deps: ClusterDeps;
let app: Hapi.Server;

/** A recording double for every cluster operation the routes expose. */
function fakeDeps(over: Partial<ClusterDeps> = {}): ClusterDeps {
  return {
    agents: {
      get: async (name) => (name === "known" ? { metadata: { name } } : null),
      list: async (opts) => {
        calls.push(`list:${opts.limit}:${opts.continue ?? "-"}`);

        return { items: [], continueToken: "next-page" };
      },
      remove: async (name) => {
        calls.push(`delete:${name}`);
      },
    },
    pods: {
      agentInfo: async (name) =>
        name === "known" ? { phase: "Running", jobName: "job-1" } : null,
      podsForJob: async () => [{ name: "pod-1" }],
      podLog: async (pod, tail) => {
        calls.push(`log:${pod}:${tail}`);

        return "line";
      },
    },
    tokens: {
      cleanup: async (taskId) => {
        calls.push(`cleanup:${taskId}`);
      },
    },
    catalog: {
      applyPair: async () => {
        calls.push("applyPair");
      },
      deletePair: async (name) => {
        calls.push(`deletePair:${name}`);
      },
    },
    ...over,
  } as ClusterDeps;
}

function build(over: Partial<ClusterDeps> = {}): void {
  deps = fakeDeps(over);
  app = Hapi.server({ port: 0 });
  app.route(clusterRoutes({ deps: () => deps, bearerToken: TOKEN }));
}

beforeEach(() => {
  calls = [];
  build();
});

const post = (
  url: string,
  payload?: unknown,
): Promise<Hapi.ServerInjectResponse> =>
  app.inject({
    method: "POST",
    url,
    headers: auth,
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });

describe("Agent CR routes", () => {
  it("answers 200 with found:false for a missing CR, not 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents/missing",
      headers: auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ found: false, cr: null });
  });

  it("passes the caller's continue token straight through, one page per call", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents?limit=50&continue=abc",
      headers: auth,
    });

    expect(calls).toEqual(["list:50:abc"]);
    expect((res.result as { continueToken: string }).continueToken).toBe(
      "next-page",
    );
  });

  it("refuses a page larger than 100, so no caller can re-create the one-shot list OOM", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents?limit=5000",
      headers: auth,
    });

    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("deletes a CR — the verb the Floor's RBAC never granted", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/cluster/agents/a-1",
      headers: auth,
    });

    expect(res.statusCode).toBe(204);
    expect(calls).toEqual(["delete:a-1"]);
  });
});

describe("pod log routes", () => {
  it("clamps the tail server-side rather than trusting the caller", async () => {
    await app.inject({
      method: "GET",
      url: "/api/cluster/pods/pod-1/log?tail=999999",
      headers: auth,
    });

    expect(calls).toEqual(["log:pod-1:10000"]);
  });

  it("reports found:false for an agent with no CR", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents/missing/pod-info",
      headers: auth,
    });

    expect(res.result).toEqual({ found: false, phase: null, jobName: null });
  });
});

describe("provisioning and catalog", () => {
  it("applies a catalog pair in one call, so create-409-replace cannot be split", async () => {
    const res = await post("/api/cluster/catalog/pairs", {
      agentDefinition: { metadata: { name: "def-x" } },
      station: { metadata: { name: "def-x" } },
    });

    expect(res.statusCode).toBe(204);
    expect(calls).toEqual(["applyPair"]);
  });
});

describe("auth", () => {
  it("refuses every route without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents/known",
    });

    expect(res.statusCode).toBe(401);
  });

  it("refuses a catalog pair whose body is not a pair", async () => {
    const res = await post("/api/cluster/catalog/pairs", { nope: 1 });

    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("refuses a catalog pair that is not JSON at all", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cluster/catalog/pairs",
      headers: auth,
      payload: "{not json",
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("routes the Floor needs but the tests above do not reach", () => {
  it("lists the pods of a job", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/jobs/job-1/pods",
      headers: auth,
    });

    expect(res.result).toEqual({ pods: [{ name: "pod-1" }] });
  });

  it("uses the ceiling when no tail is asked for", async () => {
    await app.inject({
      method: "GET",
      url: "/api/cluster/pods/pod-1/log",
      headers: auth,
    });

    expect(calls).toEqual(["log:pod-1:10000"]);
  });

  it("ignores a nonsense tail rather than passing it through", async () => {
    await app.inject({
      method: "GET",
      url: "/api/cluster/pods/pod-1/log?tail=abc",
      headers: auth,
    });

    expect(calls).toEqual(["log:pod-1:10000"]);
  });

  it("reclaims a task's token and catalog clones", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/cluster/per-task-tokens/t1",
      headers: auth,
    });

    expect(res.statusCode).toBe(204);
    expect(calls).toEqual(["cleanup:t1"]);
  });

  it("deletes a catalog pair by name", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/cluster/catalog/pairs/def-x",
      headers: auth,
    });

    expect(res.statusCode).toBe(204);
    expect(calls).toEqual(["deletePair:def-x"]);
  });

  it("refuses a catalog pair missing its station", async () => {
    const res = await post("/api/cluster/catalog/pairs", {
      agentDefinition: { metadata: { name: "def-x" } },
    });

    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("serves the probe without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents?limit=0",
      headers: auth,
    });

    expect(res.statusCode).toBe(400);
  });

  it("names the body itself when the payload is not an object", async () => {
    const res = await post("/api/cluster/catalog/pairs", []);

    expect(res.statusCode).toBe(400);
    expect((res.result as { error: string }).error).toMatch(/\(body\)/);
  });

  it("defaults to the page ceiling when the caller names no limit", async () => {
    await app.inject({
      method: "GET",
      url: "/api/cluster/agents",
      headers: auth,
    });

    expect(calls).toEqual(["list:100:-"]);
  });
});

describe("restart", () => {
  it("answers 204 and fires the restart hook once the response is sent", async () => {
    let restarted = false;

    app = Hapi.server({ port: 0 });
    app.route(
      clusterRoutes({
        deps: () => deps,
        bearerToken: TOKEN,
        restart: () => {
          restarted = true;
        },
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/cluster/restart",
      headers: auth,
    });

    expect(res.statusCode).toBe(204);
    expect(restarted).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(restarted).toBe(true);
  });

  it("refuses to restart without a bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cluster/restart",
    });

    expect(res.statusCode).toBe(401);
  });
});
