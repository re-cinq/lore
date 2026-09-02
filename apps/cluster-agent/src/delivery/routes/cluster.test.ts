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
      listRunning: async () => [
        {
          name: "agent-job-run1-tdd-round-abc",
          phase: "Running",
          startedAt: "2026-09-02T10:00:00.000Z",
          requests: { cpu: "1", memory: "16Gi" },
          labels: { "lore.re-cinq.com/station-run-id": "sr-1" },
        },
      ],
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

describe("auth", () => {
  it("refuses every route without a bearer token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents/known",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("routes the Floor needs but the tests above do not reach", () => {
  it("lists the running pods with their requests — the live compute-cost read", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/pods",
      headers: auth,
    });

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 200,
      body: {
        pods: [
          {
            name: "agent-job-run1-tdd-round-abc",
            phase: "Running",
            startedAt: "2026-09-02T10:00:00.000Z",
            requests: { cpu: "1", memory: "16Gi" },
            labels: { "lore.re-cinq.com/station-run-id": "sr-1" },
          },
        ],
      },
    });
  });

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

  it("serves the probe without a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cluster/agents?limit=0",
      headers: auth,
    });

    expect(res.statusCode).toBe(400);
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
