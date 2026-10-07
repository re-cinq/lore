import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import {
  planMeta,
  planWith,
  textBlock,
} from "@re-cinq/planning-document/testing";
import type { PlanFilePorts } from "../../../work/plans/plan-file.js";
import { planFileRoutes } from "./plan-file.js";

function serve() {
  const failed: unknown[] = [];
  const closedPresence: unknown[] = [];
  const ports: PlanFilePorts = {
    livePlan: async () => {
      throw new Error("no live plan in this test");
    },
    refineAsks: {
      pending: () => Promise.resolve(null),
      clear: () => Promise.resolve(),
    },
    writer: {
      applyOps: async () => [],
      proposeChanges: async () => [],
      finishRefine: () => Promise.resolve(),
      failRefine: async (request) => {
        failed.push(request);
      },
      closePresence: async (request) => {
        closedPresence.push(request);
      },
    },
  };
  const server = Hapi.server();

  server.route(planFileRoutes(ports));

  return { server, failed, closedPresence };
}

describe("POST /api/plans/{id}/refine-failed", () => {
  it("marks plan p1's Refine of scope failed with the reason the pass stopped", async () => {
    const { server, failed } = serve();
    const res = await server.inject({
      method: "POST",
      url: "/api/plans/p1/refine-failed",
      payload: {
        slot: "scope",
        reason:
          "the planning agent stopped with exit code 42 before it answered",
      },
    });

    expect({ status: res.statusCode, body: res.result, failed }).toEqual({
      status: 200,
      body: { slot: "scope" },
      failed: [
        {
          planId: "p1",
          slot: "scope",
          reason:
            "the planning agent stopped with exit code 42 before it answered",
        },
      ],
    });
  });

  it("answers 400 to a failure that names no section, and marks nothing", async () => {
    const { server, failed } = serve();
    const res = await server.inject({
      method: "POST",
      url: "/api/plans/p1/refine-failed",
      payload: { reason: "stopped" },
    });

    expect({ status: res.statusCode, failed }).toEqual({
      status: 400,
      failed: [],
    });
  });
});

describe("POST /api/plans/{id}/refine-settled", () => {
  it("closes the agent's presence for a first draft, which no one asked to refine", async () => {
    const { server, closedPresence } = serve();
    const res = await server.inject({
      method: "POST",
      url: "/api/plans/p1/refine-settled",
      payload: { outcome: "success" },
    });

    expect({
      status: res.statusCode,
      body: res.result,
      closedPresence,
    }).toEqual({
      status: 200,
      body: { settled: false },
      closedPresence: [{ planId: "p1" }],
    });
  });

  it("closes the agent's presence for a failed pass too, before failing its Refine", async () => {
    const { server, closedPresence } = serve();
    const res = await server.inject({
      method: "POST",
      url: "/api/plans/p1/refine-settled",
      payload: { outcome: "failed", reason: "the pod died" },
    });

    expect({ status: res.statusCode, closedPresence }).toEqual({
      status: 200,
      closedPresence: [{ planId: "p1" }],
    });
  });
});

describe("GET /api/plans/{id}/agent-view", () => {
  it("answers the intent section as one paragraph block with its hash", async () => {
    const meta = { ...planMeta("feature", "Faster checkout"), id: "p1" };
    const blocks = planWith("feature", {
      intent: [textBlock("paragraph", {}, "Checkout is slow.")],
    });
    const server = Hapi.server();

    server.route(
      planFileRoutes({
        livePlan: async () => ({ meta, blocks }),
        refineAsks: {
          pending: () => Promise.resolve(null),
          clear: () => Promise.resolve(),
        },
        writer: {
          applyOps: async () => [],
          proposeChanges: async () => [],
          finishRefine: () => Promise.resolve(),
          failRefine: async () => {},
          closePresence: async () => {},
        },
      }),
    );

    const res = await server.inject({
      method: "GET",
      url: "/api/plans/p1/agent-view",
    });
    const body = res.result as { sections: Array<Record<string, unknown>> };

    expect(body.sections[0]).toEqual({
      slot: "intent",
      title: expect.any(String),
      blocks: [
        {
          id: expect.any(String),
          type: "paragraph",
          hash: expect.stringMatching(/^[0-9a-z]+$/),
          text: "Checkout is slow.",
        },
      ],
    });
  });
});
