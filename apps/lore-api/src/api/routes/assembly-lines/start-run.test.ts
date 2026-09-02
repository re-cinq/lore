import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { startRunRoute } from "./start-run.js";

interface Started {
  calls: AssemblyRunStartInput[];
  server: Hapi.Server;
}

async function serverWith(
  start: (input: AssemblyRunStartInput) => Promise<string>,
): Promise<Started> {
  const calls: AssemblyRunStartInput[] = [];
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    startRunRoute(async (input) => {
      calls.push(input);

      return start(input);
    }),
  );

  return { calls, server };
}

const POST = (payload: Record<string, unknown>) => ({
  method: "POST" as const,
  url: "/api/assembly-runs",
  payload,
});

describe("POST /api/assembly-runs", () => {
  it("returns 201 and the run id for a valid start", async () => {
    const { server } = await serverWith(async () => "run-abc");
    const res = await server.inject(
      POST({ definition: "memory-consolidation", repo: "re-cinq/lore" }),
    );

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 201,
      body: { id: "run-abc" },
    });
  });

  it("passes definition, repo, branch and args through to start", async () => {
    const { server, calls } = await serverWith(async () => "run-abc");

    await server.inject(
      POST({
        definition: "memory-consolidation",
        repo: "re-cinq/lore",
        branch: "cron/memory-consolidation",
        args: { window_days: 7 },
      }),
    );

    expect(calls[0]).toEqual({
      blueprintName: "memory-consolidation",
      repo: "re-cinq/lore",
      branch: "cron/memory-consolidation",
      args: { window_days: 7 },
    });
  });

  it("omits branch and args from the start input when the body has neither", async () => {
    const { server, calls } = await serverWith(async () => "run-abc");

    await server.inject(
      POST({ definition: "memory-consolidation", repo: "re-cinq/lore" }),
    );

    expect(calls[0]).toEqual({
      blueprintName: "memory-consolidation",
      repo: "re-cinq/lore",
    });
  });

  it("returns 400 when definition is missing", async () => {
    const { server, calls } = await serverWith(async () => "run-abc");
    const res = await server.inject(POST({ repo: "re-cinq/lore" }));

    expect({ status: res.statusCode, started: calls.length }).toEqual({
      status: 400,
      started: 0,
    });
  });

  it("returns 400 when repo is not owner/name", async () => {
    const { server, calls } = await serverWith(async () => "run-abc");
    const res = await server.inject(
      POST({ definition: "memory-consolidation", repo: "lore" }),
    );

    expect({ status: res.statusCode, started: calls.length }).toEqual({
      status: 400,
      started: 0,
    });
  });
});

describe("wiring", () => {
  it("is registered on the built server and rejects an unauthenticated post", async () => {
    const { buildServer } = await import("../../../server/build-server.js");
    const { makePool } =
      await import("@re-cinq/lore-server-core/test-helpers/http-mock.js");
    const res = await buildServer(() => makePool() as never).inject({
      method: "POST",
      url: "/api/assembly-runs",
      payload: {
        definition: "memory-consolidation",
        repo: "re-cinq/lore",
      } as Record<string, unknown>,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("resume_from (fork-and-rerun)", () => {
  it("passes resume_from through to start as resumeFrom", async () => {
    const { server, calls } = await serverWith(async () => "run-fork");
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "tdd-round" },
      }),
    );

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload),
      started: calls[0],
    }).toEqual({
      status: 201,
      body: { id: "run-fork" },
      started: {
        blueprintName: "implementation-loop",
        repo: "re-cinq/lore",
        resumeFrom: { lineId: "run-abc", nodeId: "tdd-round" },
      },
    });
  });

  it("returns 400 for a resume_from with an empty node_id", async () => {
    const { server, calls } = await serverWith(async () => "run-fork");
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "" },
      }),
    );

    expect({ status: res.statusCode, started: calls.length }).toEqual({
      status: 400,
      started: 0,
    });
  });

  it("returns 400 when branch rides alongside resume_from", async () => {
    // The port inherits the source's branch; the route refuses the override
    // up front rather than letting the port throw a 500-shaped error.
    const { server, calls } = await serverWith(async () => "run-fork");
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        branch: "feat/override",
        resume_from: { run_id: "run-abc", node_id: "tdd-round" },
      }),
    );

    expect({ status: res.statusCode, started: calls.length }).toEqual({
      status: 400,
      started: 0,
    });
  });
});
