import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  definitionHash,
  parseAssemblyLine,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { ResumeRefusedError } from "@re-cinq/lore-shared/project/assembly-runs/resume.js";
import { startRunRoute } from "./start-run.js";

const implementationLoopLike: AssemblyLine = parseAssemblyLine(`
name: implementation-loop
description: implement then validate
version: 1
entry: implement
exit: done
nodes:
  - id: implement
    type: agent
    prompt_ref: implementation-tdd
  - id: done
    type: retrospective
edges:
  - from: implement
    to: done
    on: success
  - from: implement
    to: done
    on: failed
  - from: implement
    to: done
    on: changes_requested
`);

interface Started {
  calls: AssemblyRunStartInput[];
  server: Hapi.Server;
}

async function serverWith(
  start: (input: AssemblyRunStartInput) => Promise<string>,
  definitions: Map<string, AssemblyLine> = new Map([
    ["implementation-loop", implementationLoopLike],
  ]),
): Promise<Started> {
  const calls: AssemblyRunStartInput[] = [];
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    startRunRoute(
      async (input) => {
        calls.push(input);

        return start(input);
      },
      async () => definitions,
    ),
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
        blueprintHash: definitionHash(implementationLoopLike),
        resumeFrom: { lineId: "run-abc", nodeId: "tdd-round" },
      },
    });
  });

  it("fills blueprintHash from the current definition, so the drift guard has its left-hand side", async () => {
    const { server, calls } = await serverWith(async () => "run-fork");

    await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "implement" },
      }),
    );

    expect(calls[0]?.blueprintHash).toBe(
      definitionHash(implementationLoopLike),
    );
  });

  it("returns 400 for a resume_from naming a definition that does not exist", async () => {
    const { server, calls } = await serverWith(
      async () => "run-fork",
      new Map(),
    );
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "implement" },
      }),
    );

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload),
      started: calls.length,
    }).toEqual({
      status: 400,
      body: { error: 'unknown definition "implementation-loop"' },
      started: 0,
    });
  });

  it("returns 409 carrying the port's refusal instead of an opaque 500", async () => {
    const { server } = await serverWith(async () => {
      throw new ResumeRefusedError(
        'resume-from source line "run-abc": definition "implementation-loop" has changed since that run (aaaaaaaaaaaa ≠ bbbbbbbbbbbb)',
      );
    });
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "implement" },
      }),
    );

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 409,
      body: {
        error:
          'resume-from source line "run-abc": definition "implementation-loop" has changed since that run (aaaaaaaaaaaa ≠ bbbbbbbbbbbb)',
      },
    });
  });

  it("lets an unexpected start failure surface as the 500 it is, never a 409", async () => {
    const { server } = await serverWith(async () => {
      throw new Error("connection terminated unexpectedly");
    });
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "implement" },
      }),
    );

    expect(res.statusCode).toBe(500);
  });

  it("passes resume_from.iteration through, naming the exact visit on a looping line", async () => {
    const { server, calls } = await serverWith(async () => "run-fork");
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "implement", iteration: 1 },
      }),
    );

    expect({ status: res.statusCode, started: calls[0] }).toEqual({
      status: 201,
      started: {
        blueprintName: "implementation-loop",
        repo: "re-cinq/lore",
        blueprintHash: definitionHash(implementationLoopLike),
        resumeFrom: { lineId: "run-abc", nodeId: "implement", iteration: 1 },
      },
    });
  });

  it("returns 400 for a resume_from iteration of 0 — visits count from 1", async () => {
    const { server, calls } = await serverWith(async () => "run-fork");
    const res = await server.inject(
      POST({
        definition: "implementation-loop",
        repo: "re-cinq/lore",
        resume_from: { run_id: "run-abc", node_id: "implement", iteration: 0 },
      }),
    );

    expect({ status: res.statusCode, started: calls.length }).toEqual({
      status: 400,
      started: 0,
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

  it("returns 400 when branch rides alongside resume_from (the port inherits the source's branch)", async () => {
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
